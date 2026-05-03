import { useEffect, useState } from 'react';
import { sendMessage, type CheckApiHealthResultPayload } from '@/shared/messaging';

/**
 * Ping `/maintenance/health` au mount puis toutes les 30s pendant que le popup
 * est ouvert. Affiche le résultat sous forme `'ok' | 'down' | 'checking'`.
 *
 * `'down'` signale que le serveur Actunime est inaccessible (network error,
 * 5xx, etc.) → le popup affiche un bandeau d'avertissement.
 */
export function useApiHealth(): {
  status: 'checking' | 'ok' | 'down';
  recheck: () => void;
} {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = (await sendMessage({ type: 'CHECK_API_HEALTH' })) as CheckApiHealthResultPayload;
        if (cancelled) return;
        setStatus(res.ok ? 'ok' : 'down');
      } catch {
        if (cancelled) return;
        setStatus('down');
      }
    };
    void run();
    const interval = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tick]);

  return {
    status,
    recheck: () => setTick((t) => t + 1),
  };
}
