import { useEffect, useState } from 'react';
import { sendTabMessage, type DetectionStatusPayload } from '@/shared/messaging';

interface UseCurrentDetectionResult {
  detection: DetectionStatusPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Interroge le content script de l'onglet actif pour savoir si une page
 * anime/manga est actuellement détectée. Refresh toutes les 2s tant que le
 * popup est ouvert pour afficher la progression vidéo en temps réel.
 */
export function useCurrentDetection(): UseCurrentDetectionResult {
  const [detection, setDetection] = useState<DetectionStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setDetection({ detected: false });
        setError(null);
        return;
      }
      const res = await sendTabMessage<DetectionStatusPayload>(tab.id, {
        type: 'GET_DETECTION',
      });
      setDetection(res);
      setError(null);
    } catch (err) {
      // Cas classique : content script pas injecté sur la page (ex. onglet newtab,
      // chrome://..., site non matché dans host_permissions).
      setDetection({ detected: false });
      const message = (err as Error)?.message ?? '';
      setError(message.includes('Receiving end') ? null : message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  return { detection, loading, error, refresh };
}
