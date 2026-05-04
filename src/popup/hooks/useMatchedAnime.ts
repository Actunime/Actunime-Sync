import { useEffect, useState } from 'react';
import {
  sendMessage,
  type DetectionStatusPayload,
  type MatchResultPayload,
} from '@/shared/messaging';

interface UseMatchedAnimeResult {
  match: MatchResultPayload | null;
  loading: boolean;
}

/**
 * Demande au background de résoudre l'entité Actunime correspondant à la
 * détection courante. Le matcher backend a son propre cache, donc un refresh
 * périodique est peu coûteux côté API (cache hit dès la 2e requête).
 */
export function useMatchedAnime(detection: DetectionStatusPayload | null): UseMatchedAnimeResult {
  const [match, setMatch] = useState<MatchResultPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!detection || !detection.detected) {
      setMatch(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await sendMessage<MatchResultPayload>({
          type: 'MATCH_BY_DETECTION',
          payload: {
            siteId: detection.siteId,
            slug: detection.slug,
            title: detection.title,
            seriesId: detection.seriesId,
            seriesSlug: detection.seriesSlug,
            season: detection.season,
            kind: detection.kind,
          },
        });
        if (!cancelled) setMatch(result);
      } catch {
        if (!cancelled) {
          setMatch({ matched: false, reason: 'error', error: 'Echec de communication' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // On re-match dès que la série ou l'épisode change.
  }, [
    detection?.detected,
    detection?.detected ? detection.siteId : null,
    detection?.detected ? detection.slug : null,
    detection?.detected ? detection.title : null,
  ]);

  return { match, loading };
}
