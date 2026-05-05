import { useEffect, useState } from 'react';
import {
  sendMessage,
  type DetectionStatusPayload,
  type MatchResultPayload,
} from '@/shared/messaging';

interface UseMatchedMediaResult {
  match: MatchResultPayload | null;
  loading: boolean;
}

/**
 * Demande au background de résoudre l'entité Actunime correspondant à la
 * détection courante. Le matcher backend a son propre cache, donc un refresh
 * périodique est peu coûteux côté API (cache hit dès la 2e requête).
 *
 * `detection` change de référence toutes les 2s (poll de `useCurrentDetection`)
 * même quand son contenu pertinent est identique. On extrait des primitives
 * stables pour la deps array et on lit `detection` librement dans l'effet —
 * l'effet ne refetche que quand `(detected, siteId, slug, title)` changent.
 */
export function useMatchedMedia(detection: DetectionStatusPayload | null): UseMatchedMediaResult {
  const [match, setMatch] = useState<MatchResultPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const detected = detection?.detected === true;
  const siteId = detected && detection.detected ? detection.siteId : null;
  const slug = detected && detection.detected ? detection.slug : null;
  const title = detected && detection.detected ? detection.title : null;

  useEffect(() => {
    if (!detection?.detected) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, siteId, slug, title]);

  return { match, loading };
}
