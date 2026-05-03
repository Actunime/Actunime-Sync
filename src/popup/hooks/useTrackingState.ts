import { useCallback, useEffect, useState } from 'react';
import {
  sendMessage,
  type MarkAsWatchedResultPayload,
  type TrackingStatePayload,
} from '@/shared/messaging';

interface UseTrackingStateResult {
  state: TrackingStatePayload | null;
  loading: boolean;
  marking: boolean;
  markAsWatched: () => Promise<MarkAsWatchedResultPayload | null>;
}

/**
 * Lit l'état de tracking actuel du tab actif (mode video/audio, engagement
 * atteint, cumul). Permet au popup d'afficher conditionnellement un bouton
 * « Marquer cet épisode comme vu » quand le mode est `audio` + engagement OK.
 */
export function useTrackingState(): UseTrackingStateResult {
  const [state, setState] = useState<TrackingStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setState(null);
        return;
      }
      const res = (await sendMessage({
        type: 'GET_TRACKING_STATE_FOR_TAB',
        payload: { tabId: tab.id },
      })) as TrackingStatePayload;
      setState(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Refresh pendant que le popup est ouvert pour suivre l'évolution du cumul
    const interval = setInterval(refresh, 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const markAsWatched = useCallback(async () => {
    setMarking(true);
    try {
      const res = (await sendMessage({
        type: 'MARK_AS_WATCHED_NOW',
      })) as MarkAsWatchedResultPayload;
      if (res?.ok) {
        // Refresh l'état pour re-cacher le bouton (épisode push)
        await refresh();
      }
      return res;
    } finally {
      setMarking(false);
    }
  }, [refresh]);

  return { state, loading, marking, markAsWatched };
}
