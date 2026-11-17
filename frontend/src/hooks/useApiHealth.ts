import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from '@/services/api/client';

export type ApiHealthState =
  | { state: 'checking' }
  | { state: 'online'; data: HealthResponse }
  | { state: 'offline'; error: string };

/** Polls GET /api/v1/health so the shell can show backend connectivity. */
export function useApiHealth(intervalMs = 30_000): ApiHealthState {
  const [health, setHealth] = useState<ApiHealthState>({ state: 'checking' });

  useEffect(() => {
    let controller = new AbortController();

    const check = () => {
      controller.abort();
      controller = new AbortController();
      getHealth(controller.signal)
        .then((data) => setHealth({ state: 'online', data }))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setHealth({ state: 'offline', error: err instanceof Error ? err.message : 'Unreachable' });
        });
    };

    check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      window.clearInterval(id);
      controller.abort();
    };
  }, [intervalMs]);

  return health;
}
