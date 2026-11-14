import { useCallback, useEffect, useState } from 'react';
import { api, type Board } from './api';

/** Fetches the best-times board from the API, with loading / error state. */
export function useBoard(limit = 25) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await api.getBoard(limit));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { board, loading, error, refresh };
}
