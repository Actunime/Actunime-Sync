/**
 * Observateur basé sur l'audio de l'onglet (`tab.audible`).
 *
 * Utilisé en fallback quand on n'a pas accès au `<video>` directement (cas
 * typique : le player est dans une iframe cross-origin sur un site agrégateur).
 *
 * V0.3 : plus de push automatique à un threshold fixe (faux positifs sur format
 * court/long). À la place :
 *  - `onPlayStart` : audio actif depuis `stableMs` ms (filtre les pubs courtes)
 *  - `onEngagementReached` : audio cumulé ≥ `engagementMs` (par défaut 10 min) →
 *    signale au caller qu'on a un engagement raisonnable. Le caller décide
 *    quoi faire (push au changement d'épisode = mode B, ou bouton « Marquer vu »
 *    dans le popup = mode A).
 *
 * Le caller alimente l'observateur via `update(audible)` à chaque changement
 * de l'état `tab.audible` reporté par le SW.
 */

export interface AudioObserverOptions {
  /** Délai (ms) d'audio continu avant de déclencher `onPlayStart`. Défaut 5 s. */
  stableMs?: number;
  /** Cumul (ms) d'audio actif avant `onEngagementReached`. Défaut 10 min. */
  engagementMs?: number;
  onPlayStart: () => void;
  onEngagementReached: (cumulativeMs: number) => void;
}

export interface AudioObserver {
  /** À appeler à chaque changement de `tab.audible`. */
  update(audible: boolean): void;
  /** Cumul ms audio actif depuis l'init (en compte le segment courant si actif). */
  getCumulativeMs(): number;
  /** `true` quand le seuil d'engagement a été dépassé. */
  hasReachedEngagement(): boolean;
  cleanup(): void;
}

export function createAudioObserver(opts: AudioObserverOptions): AudioObserver {
  const stableMs = opts.stableMs ?? 5_000;
  const engagementMs = opts.engagementMs ?? 10 * 60 * 1_000;

  let isAudible = false;
  let lastAudibleStart: number | null = null;
  let cumulativeMs = 0;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let engagementInterval: ReturnType<typeof setInterval> | null = null;
  let firedPlayStart = false;
  let firedEngagement = false;

  function clearStable() {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function getCurrentCumulative(): number {
    return cumulativeMs + (lastAudibleStart ? Date.now() - lastAudibleStart : 0);
  }

  function checkEngagement() {
    if (firedEngagement) return;
    const total = getCurrentCumulative();
    if (total >= engagementMs) {
      firedEngagement = true;
      stopEngagementInterval();
      opts.onEngagementReached(total);
    }
  }

  function startEngagementInterval() {
    if (engagementInterval) return;
    engagementInterval = setInterval(checkEngagement, 30_000);
  }

  function stopEngagementInterval() {
    if (engagementInterval) {
      clearInterval(engagementInterval);
      engagementInterval = null;
    }
  }

  function update(audible: boolean) {
    if (audible && !isAudible) {
      isAudible = true;
      lastAudibleStart = Date.now();
      if (!firedPlayStart) {
        clearStable();
        stableTimer = setTimeout(() => {
          firedPlayStart = true;
          stableTimer = null;
          opts.onPlayStart();
        }, stableMs);
      }
      startEngagementInterval();
    } else if (!audible && isAudible) {
      isAudible = false;
      if (lastAudibleStart !== null) {
        cumulativeMs += Date.now() - lastAudibleStart;
        lastAudibleStart = null;
      }
      clearStable();
      checkEngagement(); // dernier check au moment du cut
    }
  }

  return {
    update,
    getCumulativeMs: getCurrentCumulative,
    hasReachedEngagement: () => firedEngagement,
    cleanup() {
      clearStable();
      stopEngagementInterval();
    },
  };
}
