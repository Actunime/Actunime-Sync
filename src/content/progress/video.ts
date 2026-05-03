/**
 * Observateur de lecture vidéo. Deux événements distincts :
 *
 *  - `onPlayStart` : tirée la 1re fois que la vidéo joue (event `playing`,
 *    après buffering). Sert à déclencher la phase « discovery » du tracking
 *    (toast de confirmation pour identifier la série).
 *
 *  - `onThresholdReached` : tirée la 1re fois que `currentTime / duration`
 *    dépasse `threshold` (typiquement 0.85). Sert à pousser la progression
 *    côté API quand la série est confirmée.
 *
 * Chaque callback a son propre dedup pour ne pas fire deux fois sur le même
 * épisode.
 */

export interface VideoObserverOptions {
  selector?: string; // défaut : 'video'
  /** Seuil 0→1 pour `onThresholdReached`, ex. 0.85. */
  threshold: number;
  onPlayStart?: () => void;
  onThresholdReached?: (ratio: number) => void;
  onAttach?: (video: HTMLVideoElement) => void;
  /** Clé de dedup partagée par les deux callbacks (ex. `siteId:slug:ep`). */
  dedupKey?: string;
}

export function observeVideoProgress({
  selector = 'video',
  threshold,
  onPlayStart,
  onThresholdReached,
  onAttach,
  dedupKey,
}: VideoObserverOptions): () => void {
  let attached: HTMLVideoElement | null = null;
  let firedPlayStart: string | null = null;
  let firedThreshold: string | null = null;

  const handlePlaying = () => {
    if (!onPlayStart) return;
    if (firedPlayStart === dedupKey) return;
    firedPlayStart = dedupKey ?? null;
    onPlayStart();
  };

  const handleTimeUpdate = () => {
    if (!attached || !onThresholdReached) return;
    if (firedThreshold === dedupKey) return;
    const { currentTime, duration } = attached;
    if (!duration || !Number.isFinite(duration)) return;
    const ratio = currentTime / duration;
    if (ratio >= threshold) {
      firedThreshold = dedupKey ?? null;
      onThresholdReached(ratio);
    }
  };

  const attachTo = (video: HTMLVideoElement) => {
    if (attached === video) return;
    if (attached) detach();
    attached = video;
    attached.addEventListener('playing', handlePlaying, { passive: true });
    attached.addEventListener('timeupdate', handleTimeUpdate, { passive: true });
    onAttach?.(video);
    // Si la vidéo joue déjà au moment de l'attach (autoplay actif au mount).
    if (!video.paused && video.readyState >= 2) handlePlaying();
  };

  const detach = () => {
    if (!attached) return;
    attached.removeEventListener('playing', handlePlaying);
    attached.removeEventListener('timeupdate', handleTimeUpdate);
  };

  const scan = () => {
    const v = document.querySelector<HTMLVideoElement>(selector);
    if (v) attachTo(v);
  };

  scan();

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    detach();
  };
}
