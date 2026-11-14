import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Msg, Role } from './protocol';

/**
 * RoomLink — one side of a paired room.
 *
 * Transport, in two layers:
 *  1. A Supabase Realtime channel (WebSocket) per room code. It handles
 *     presence, pairing and acts as an always-available relay.
 *  2. Once both sides are present, the same channel is used as signalling to
 *     upgrade to a direct WebRTC data channel (unordered, no retransmits) so
 *     tilt data takes the shortest path. If that fails we simply stay on relay.
 */
export type LinkStatus = 'connecting' | 'waiting' | 'relay' | 'direct' | 'error';

interface Handlers {
  onMessage(m: Msg): void;
  onStatus(s: LinkStatus): void;
}

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const MAX_RTC_ATTEMPTS = 4;

export class RoomLink {
  readonly id = Math.random().toString(36).slice(2, 10);
  private ch: RealtimeChannel;
  private subscribed = false;
  private peer = false;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private status: LinkStatus = 'connecting';
  private attempts = 0;
  private retryTimer: number | undefined;
  private closed = false;
  readonly code: string;
  readonly role: Role;
  private h: Handlers;

  constructor(code: string, role: Role, handlers: Handlers) {
    this.code = code;
    this.role = role;
    this.h = handlers;
    this.ch = supabase.channel(`tilt-isles:${code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    this.ch
      .on('broadcast', { event: 'm' }, ({ payload }) => this.onRelay(payload as Msg))
      .on('presence', { event: 'sync' }, () => this.onPresence())
      .subscribe((st) => {
        if (this.closed) return;
        if (st === 'SUBSCRIBED') {
          this.subscribed = true;
          void this.ch.track({ role: this.role, id: this.id });
          this.relay({ k: 'hello', role: this.role, id: this.id });
          this.refresh();
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
          this.subscribed = false;
          this.setStatus('error');
        } else if (st === 'CLOSED') {
          this.subscribed = false;
        }
      });
  }

  /** Hot-path messages prefer the direct channel; `reliable` forces the relay. */
  send(m: Msg, reliable = false) {
    if (!reliable && this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(m));
        return;
      } catch {
        /* fall through to relay */
      }
    }
    this.relay(m);
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    this.teardownRtc();
    void supabase.removeChannel(this.ch);
  }

  // ---------------------------------------------------------------- internals

  private relay(m: Msg) {
    if (!this.subscribed || this.closed) return;
    void this.ch.send({ type: 'broadcast', event: 'm', payload: m });
  }

  private setStatus(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.h.onStatus(s);
  }

  private refresh() {
    if (!this.subscribed) return;
    if (!this.peer) this.setStatus('waiting');
    else this.setStatus(this.dc && this.dc.readyState === 'open' ? 'direct' : 'relay');
  }

  private onPresence() {
    const state = this.ch.presenceState<{ role: Role; id: string }>();
    const has = Object.values(state).some((list) => list.some((p) => p.role !== this.role));
    if (has !== this.peer) {
      this.peer = has;
      if (has && this.role === 'controller') {
        this.attempts = 0;
        void this.startRtc();
      }
      if (!has) this.teardownRtc();
    }
    this.refresh();
  }

  private onRelay(m: Msg) {
    if (this.closed || !m) return;
    if (m.k === 'rtc') {
      void this.onSignal(m);
      return;
    }
    if (m.k === 'hello' && m.role !== this.role) {
      // The other side (re)joined — treat as present even before presence syncs.
      if (!this.peer) {
        this.peer = true;
        this.refresh();
      }
      if (this.role === 'controller' && !(this.dc && this.dc.readyState === 'open')) {
        this.attempts = 0;
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => void this.startRtc(), 250);
      }
    }
    this.h.onMessage(m);
  }

  // ------------------------------------------------------------------ WebRTC

  private teardownRtc() {
    const { pc, dc } = this;
    this.pc = null;
    this.dc = null;
    this.pendingIce = [];
    try {
      if (dc) dc.onclose = null;
      dc?.close();
      pc?.close();
    } catch {
      /* ignore */
    }
  }

  private scheduleRetry() {
    if (this.role !== 'controller' || this.closed) return;
    window.clearTimeout(this.retryTimer);
    if (this.attempts >= MAX_RTC_ATTEMPTS) return;
    this.retryTimer = window.setTimeout(() => {
      if (this.peer && !(this.dc && this.dc.readyState === 'open')) void this.startRtc();
    }, 4000);
  }

  private newPeer(): RTCPeerConnection | null {
    if (typeof RTCPeerConnection === 'undefined') return null;
    this.teardownRtc();
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.relay({ k: 'rtc', kind: 'ice', data: e.candidate.toJSON(), from: this.id });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.teardownRtc();
        this.refresh();
        this.scheduleRetry();
      }
    };
    return pc;
  }

  private hookChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => this.refresh();
    dc.onclose = () => {
      if (this.dc === dc) {
        this.dc = null;
        this.refresh();
        this.scheduleRetry();
      }
    };
    dc.onmessage = (e) => {
      try {
        this.h.onMessage(JSON.parse(e.data as string) as Msg);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  /** Controller side: create the offer. */
  private async startRtc() {
    if (this.closed || !this.subscribed) return;
    this.attempts++;
    try {
      const pc = this.newPeer();
      if (!pc) return;
      this.hookChannel(pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.relay({ k: 'rtc', kind: 'offer', data: offer, from: this.id });
      this.scheduleRetry();
    } catch (err) {
      console.warn('[room] WebRTC offer failed, staying on relay', err);
    }
  }

  private async onSignal(m: Extract<Msg, { k: 'rtc' }>) {
    try {
      if (m.kind === 'offer' && this.role === 'viewer') {
        const pc = this.newPeer();
        if (!pc) return;
        pc.ondatachannel = (e) => this.hookChannel(e.channel);
        await pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
        await this.flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.relay({ k: 'rtc', kind: 'answer', data: answer, from: this.id });
      } else if (m.kind === 'answer' && this.role === 'controller' && this.pc) {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
          await this.flushIce();
        }
      } else if (m.kind === 'ice') {
        const cand = m.data as RTCIceCandidateInit;
        if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(cand);
        else this.pendingIce.push(cand);
      }
    } catch (err) {
      console.warn('[room] WebRTC signalling error, staying on relay', err);
    }
  }

  private async flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch {
        /* ignore bad candidates */
      }
    }
  }
}
