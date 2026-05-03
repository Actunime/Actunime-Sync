import {
  sendMessage,
  type ConfirmResultPayload,
  type DetectionStatusPayload,
  type DiscoveryResultPayload,
  type ExtensionMessage,
  type IframeRelayMessage,
  type TrackResultPayload,
} from '@/shared/messaging';
import type { DetectionResult } from './detection';
import { applyLearnedPattern } from './learned-engine';
import { detectGenericFromDom } from './heuristics';
import { startImagePick } from './image-pick';
import { launchConfigWizard } from './wizard';
import { storage } from '@/shared/storage';
import type { LearnedPattern } from '@/shared/types';
import { createAudioObserver, type AudioObserver } from './progress/audio';
import { observeVideoProgress } from './progress/video';
import {
  removeWatchingBadge,
  showActionToast,
  showConfirmationCard,
  showToast,
  showWatchingBadge,
  suggestAlias,
} from './overlay';

const LOG = '[Actunime]';

let cleanupObserver: (() => void) | null = null;
let currentDetection: DetectionResult | null = null;
let currentVideo: HTMLVideoElement | null = null;
/**
 * Délai de grâce avant de lancer la discovery — évite de spammer la card
 * de confirmation si l'user clique pour vérifier puis change d'avis.
 */
const DISCOVERY_DELAY_MS = 5_000;
let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
let discoveryFired = false;
/**
 * LearnedPattern pour le host courant, chargé au boot. Utilisé en priorité
 * sur la Couche 1 si présent.
 */
let learnedPattern: LearnedPattern | null = null;
/** Observer audio fallback (utilisé quand pas de `<video>` direct accessible). */
let audioObserver: AudioObserver | null = null;
/** Vrai dès qu'un `<video>` direct s'attache → l'audio observer est désactivé. */
let videoObserverAttached = false;

function evaluateCurrentPage() {
  const host = location.hostname;

  const detection: DetectionResult | null =
    applyLearned() ?? buildGenericDetection(host);

  if (!detection) {
    cleanupObserver?.();
    cleanupObserver = null;
    currentDetection = null;
    currentVideo = null;
    removeWatchingBadge();
    return;
  }

  // Si on a déjà une détection pour la même URL/épisode, on refresh juste les
  // champs (le DOM s'est peut-être enrichi entre temps, on améliore le titre).
  const sameKey =
    currentDetection &&
    currentDetection.siteId === detection.siteId &&
    currentDetection.slug === detection.slug &&
    currentDetection.episode === detection.episode;

  // Si on change d'épisode/série, retire le badge de la précédente détection.
  if (!sameKey) removeWatchingBadge();

  const prevTitle = currentDetection?.title;
  currentDetection = detection;

  if (!sameKey || prevTitle !== detection.title) {
    console.info(LOG, 'Détection:', detection);
  }

  if (sameKey && cleanupObserver) return; // observer déjà attaché pour cette page

  cleanupObserver?.();
  audioObserver?.cleanup();
  audioObserver = null;
  videoObserverAttached = false;

  // Stratégie hybride :
  //  1. On tente toujours d'attacher l'observer `<video>` (timing 85 % précis)
  //  2. En parallèle on prépare un observer audio (`tab.audible`) pour les
  //     cas où le `<video>` n'est pas accessible (iframe cross-origin)
  //  3. Le 1er qui fire « gagne » (dedup garantit que l'autre est ignoré)
  cleanupObserver = observeVideoProgress({
    selector: 'video',
    threshold: 0.85,
    dedupKey: `${detection.siteId}:${detection.slug ?? detection.seriesSlug ?? 'x'}:${detection.episode ?? 'x'}`,
    onAttach: (video) => {
      currentVideo = video;
      videoObserverAttached = true;
      // Si l'audio observer s'était déjà créé, on l'arrête (video plus précis)
      audioObserver?.cleanup();
      audioObserver = null;
      console.info(LOG, 'Vidéo attachée, tracking actif (mode video).');
    },
    onPlayStart: () => {
      scheduleDiscovery();
    },
    onThresholdReached: (ratio) => {
      if (currentDetection) handleProgressPush(currentDetection, ratio);
    },
  });

  // Fallback audio : créé tout de suite, prendra le relais si jamais le
  // `<video>` ne s'attache pas (cas iframe cross-origin pour les agrégateurs).
  // Plus de push automatique à un threshold fixe (faux positifs sur format
  // court/long). À la place :
  //  - mode B : push au changement d'épisode si engagement ≥ 10 min (cf. observeNavigation)
  //  - mode A : bouton « Marquer cet épisode vu » dans le popup une fois engagement atteint
  audioObserver = createAudioObserver({
    onPlayStart: () => {
      if (videoObserverAttached) return; // video pris la main
      console.info(LOG, 'Audio stable détecté, tracking actif (mode audio).');
      // Pas de délai : l'audioObserver a déjà attendu 5s de stabilité.
      scheduleDiscovery(0);
      reportTrackingState();
    },
    onEngagementReached: (cumMs) => {
      if (videoObserverAttached) return;
      console.info(LOG, `Engagement audio atteint (${Math.round(cumMs / 60_000)} min).`);
      reportTrackingState();
    },
  });

  // Query l'état audible initial : `chrome.tabs.onUpdated` ne fire que sur
  // changement, donc si la page jouait déjà avant l'injection (ex. au F5),
  // l'observer attendrait un signal qui ne viendrait jamais.
  void (async () => {
    try {
      const res = (await sendMessage({ type: 'QUERY_TAB_AUDIBLE' })) as { audible: boolean };
      if (res?.audible) audioObserver?.update(true);
    } catch {
      // ignore
    }
  })();
}

/**
 * Lance la discovery après un délai de grâce optionnel pour éviter de prompt
 * l'user si la lecture n'est qu'un check rapide. Idempotent : si déjà
 * programmé ou déjà tiré pour cette session, ne rien faire.
 *
 * - Mode video direct : 5s (le `<video>` peut fire `play` sur preview/scrubbing).
 * - Mode audio : 0s (l'observer audio attend déjà 5s de stabilité avant de
 *   nous appeler — pas besoin d'ajouter un délai).
 */
function scheduleDiscovery(delayMs: number = DISCOVERY_DELAY_MS) {
  if (discoveryFired) return;
  if (discoveryTimer) return;
  if (delayMs <= 0) {
    if (!currentDetection) return;
    discoveryFired = true;
    void handleDiscovery(currentDetection);
    return;
  }
  console.info(LOG, `Discovery programmée dans ${delayMs / 1000}s…`);
  discoveryTimer = setTimeout(() => {
    discoveryTimer = null;
    if (!currentDetection) return;
    discoveryFired = true;
    void handleDiscovery(currentDetection);
  }, delayMs);
}

function cancelDiscovery() {
  if (discoveryTimer) {
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
  }
}

/**
 * Applique le LearnedPattern du host courant (E17), s'il existe. Le pattern
 * est chargé au boot (`loadLearnedPattern`) et rafraîchi via le storage
 * `onChanged` (sauvegarde depuis le wizard).
 */
function applyLearned(): DetectionResult | null {
  if (!learnedPattern) return null;
  return applyLearnedPattern(learnedPattern);
}

function buildGenericDetection(host: string): DetectionResult | null {
  const generic = detectGenericFromDom();
  if (!generic) return null;

  // Slug séries généré depuis le titre (kebab-case, ASCII) — sert de fallback
  // pour `seriesKey` quand on n'a pas d'ID interne stable.
  const seriesSlug = (generic.seriesTitle ?? generic.title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);

  return {
    siteId: `generic:${host}`,
    kind: generic.kind,
    url: location.href,
    title: generic.seriesTitle ?? generic.title ?? '',
    episode: generic.episode,
    season: generic.season,
    seriesSlug: seriesSlug || undefined,
    slug: seriesSlug || undefined,
  };
}

/**
 * Debounce pour ne pas ré-évaluer à chaque micro-changement DOM (un épisode
 * Crunchyroll déclenche des centaines de mutations pendant le chargement).
 */
let evalTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEvaluation() {
  if (evalTimer) return;
  evalTimer = setTimeout(() => {
    evalTimer = null;
    evaluateCurrentPage();
  }, 300);
}

/**
 * Observateur global du DOM + du <title>. Re-évalue la détection à chaque
 * changement significatif pour enrichir/corriger le titre à mesure que le SPA
 * monte ses composants (lien `/series/...`, `<title>` mis à jour, etc.).
 */
function observeDomReady() {
  const observer = new MutationObserver(scheduleEvaluation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const titleObserver = new MutationObserver(scheduleEvaluation);
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
}

/**
 * Répond aux messages venant du popup (principalement `GET_DETECTION` pour
 * afficher l'état courant dans l'UI).
 */
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'START_IMAGE_PICK') {
      if (window.top !== window.self) return false;
      startImagePick();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'LAUNCH_CONFIG_WIZARD') {
      // Le top frame uniquement répond — sinon le wizard se lance dans chaque iframe.
      if (window.top !== window.self) return false;
      void (async () => {
        try {
          const pattern = await launchConfigWizard({ kind: 'anime' });
          if (pattern) {
            learnedPattern = pattern;
            // Re-évalue la page avec le nouveau pattern actif
            evaluateCurrentPage();
            sendResponse({ ok: true, pattern });
          } else {
            sendResponse({ ok: false, cancelled: true });
          }
        } catch (err) {
          sendResponse({ ok: false, error: (err as Error)?.message ?? 'erreur wizard' });
        }
      })();
      return true;
    }
    if (message.type === 'GET_DETECTION') {
      const response: DetectionStatusPayload = currentDetection
        ? {
            detected: true,
            siteId: currentDetection.siteId,
            kind: currentDetection.kind,
            title: currentDetection.title,
            episode: currentDetection.episode,
            season: currentDetection.season,
            slug: currentDetection.slug,
            seriesId: currentDetection.seriesId,
            seriesSlug: currentDetection.seriesSlug,
            url: currentDetection.url,
            progressRatio:
              currentVideo && currentVideo.duration
                ? currentVideo.currentTime / currentVideo.duration
                : undefined,
          }
        : { detected: false };
      sendResponse(response);
      return false;
    }
    return false;
  },
);

function buildPayload(detection: DetectionResult, ratio: number) {
  return {
    siteId: detection.siteId,
    url: detection.url,
    title: detection.title,
    episode: detection.episode,
    season: detection.season,
    slug: detection.slug,
    seriesId: detection.seriesId,
    seriesSlug: detection.seriesSlug,
    kind: detection.kind,
    progressRatio: ratio,
  };
}

/**
 * Phase 1 — début de lecture. Demande au background d'identifier la série.
 * Si miss → affiche le toast de confirmation. Aucun push ici.
 */
/**
 * Bouton « Modifier » du badge : oublie le match cache + ré-ouvre la card de
 * confirmation avec la détection courante.
 */
async function handleEditMatch(seriesKey: string, detection: DetectionResult) {
  await sendMessage({ type: 'FORGET_MATCH', payload: { seriesKey } });
  removeWatchingBadge();
  await handleDiscovery(detection);
}

/**
 * Bouton « Marquer vu » du badge : push immédiat l'épisode courant sans
 * attendre le 85 % / l'engagement audio.
 */
async function handleMarkNowFromBadge(detection: DetectionResult) {
  await handleProgressPush(detection, 1);
  removeWatchingBadge();
}

/**
 * Bouton « Ignorer » du badge : marque la série comme ignorée → pas de
 * nouveau toast / badge tant que l'user n'a pas modifié manuellement.
 */
async function handleIgnoreFromBadge(seriesKey: string) {
  await sendMessage({ type: 'FORGET_MATCH', payload: { seriesKey } });
  // ignore_series via le tracker (stockage permanent)
  await sendMessage({
    type: 'CONFIRM_TRACK',
    payload: { action: 'ignore_series', seriesKey },
  });
  removeWatchingBadge();
  showToast('Série ignorée. Vous pouvez la réactiver depuis les options.', 'info', 4000);
}

async function handleDiscovery(detection: DetectionResult) {
  console.info(LOG, 'Lecture détectée, discovery série...');
  try {
    const response = (await sendMessage({
      type: 'DISCOVER_SERIES',
      payload: buildPayload(detection, 0),
    })) as DiscoveryResultPayload;

    console.info(LOG, 'Réponse discovery:', response);

    if (response.state === 'cached') {
      console.info(LOG, `Série en cache : ${response.matchedTitle}`);
      showWatchingBadge({
        matchedTitle: response.matchedTitle,
        coverUrl: response.coverUrl,
        episode: detection.episode,
        season: detection.season,
        mode: videoObserverAttached ? 'video' : 'audio',
        listProgress: response.existingListEntry,
        onEdit: () => handleEditMatch(response.seriesKey, detection),
        onMarkNow: () => handleMarkNowFromBadge(detection),
        onIgnore: () => handleIgnoreFromBadge(response.seriesKey),
      });
      return;
    }
    if (response.state === 'ignored') {
      console.info(LOG, 'Série ignorée par l\'user, pas de tracking.');
      return;
    }
    if (response.state === 'no_match') {
      showToast(`Pas trouvé sur Actunime : ${response.error ?? detection.title}`, 'error');
      return;
    }
    if (response.state === 'error') {
      showToast(`Erreur discovery : ${response.error}`, 'error');
      return;
    }

    // needs_confirmation (avec ou sans candidats — la card propose le CTA
    // contribution dans le cas vide).
    const choice = await showConfirmationCard({
      detectedTitle: response.detection.title,
      episode: response.detection.episode,
      season: response.detection.season,
      kind: detection.kind,
      sourceUrl: detection.url,
      candidates: response.candidates,
    });

    // L'user dit « le titre détecté est faux, configure le site ». On lance
    // le wizard ; après save, on relance une discovery avec la nouvelle
    // détection issue du LearnedPattern.
    if (choice.action === 'configure_site') {
      const pattern = await launchConfigWizard({ kind: detection.kind });
      if (!pattern) return; // user a annulé
      // `learnedPattern` sera mis à jour via le storage onChanged listener.
      // On laisse une petite fenêtre pour que `evaluateCurrentPage` ait
      // recalculé `currentDetection`, puis on retente la discovery.
      setTimeout(() => {
        if (currentDetection) void handleDiscovery(currentDetection);
      }, 600);
      return;
    }

    // Le CTA contribution stocke un flag `pendingContribution` puis attend
    // que l'user ouvre le popup pour finaliser. La card overlay affiche déjà
    // son propre toast d'instruction — on n'en superpose pas un autre ici.
    if (choice.action === 'open_contribution') {
      return;
    }

    const confirmRes = (await sendMessage({
      type: 'CONFIRM_TRACK',
      payload:
        choice.action === 'confirm'
          ? {
              action: 'confirm',
              seriesKey: response.seriesKey,
              chosenAnimeId: choice.chosenAnimeId,
              chosenTitle: choice.chosenTitle,
              chosenCoverUrl: choice.chosenCoverUrl,
              isRewatch: choice.isRewatch,
            }
          : choice.action === 'ignore_series'
            ? { action: 'ignore_series', seriesKey: response.seriesKey }
            : { action: 'skip' },
    })) as ConfirmResultPayload;

    if (confirmRes.state === 'cached') {
      showWatchingBadge({
        matchedTitle: confirmRes.matchedTitle,
        coverUrl: confirmRes.coverUrl,
        episode: detection.episode,
        season: detection.season,
        mode: videoObserverAttached ? 'video' : 'audio',
        onEdit: () => handleEditMatch(confirmRes.seriesKey, detection),
        onMarkNow: () => handleMarkNowFromBadge(detection),
        onIgnore: () => handleIgnoreFromBadge(confirmRes.seriesKey),
      });
      // Suggestion d'alias post-confirmation (best-effort, stub backend pour V0.2).
      if (choice.action === 'confirm' && choice.suggestAliasFor) {
        const res = await suggestAlias(choice.chosenAnimeId, choice.suggestAliasFor);
        if (res.ok) {
          showToast('Synonyme proposé à la modération. Merci !', 'success', 4000);
        } else if (res.error) {
          console.info(LOG, 'Suggestion alias non envoyée:', res.error);
        }
      }
    } else if (confirmRes.state === 'ignored') {
      showToast('Série ignorée. Tu peux la réactiver depuis les options.', 'info');
    } else if (confirmRes.state === 'error') {
      showToast(`Impossible : ${confirmRes.error}`, 'error');
    }
  } catch (err) {
    console.warn(LOG, 'Erreur discovery:', err);
  }
}

/**
 * Phase 2 — seuil 85 % atteint. Push si série confirmée. Sinon silence
 * (pas de re-prompt — l'user a déjà eu sa chance en discovery).
 */
/**
 * Affiche un toast confirmant le push avec un bouton « Annuler » (8 sec).
 * Si l'user clique → envoi `UNDO_LAST_PUSH` → revert API + toast confirmation.
 */
async function notifyPushedWithUndo(
  detection: DetectionResult,
  response: Extract<TrackResultPayload, { success: true }>,
) {
  const epLabel = response.episodesWatched ?? detection.episode ?? '?';
  const title = response.matchedTitle ?? detection.title;
  const message = `Épisode ${epLabel} marqué vu — ${title}${response.isRewatch ? ' (↻ rewatch)' : ''}`;

  // Pas d'undo dispo (snapshot manquant) → toast simple sans bouton.
  if (!response.undo) {
    showToast(message, 'success');
    return;
  }

  const clicked = await showActionToast({
    message,
    actionLabel: 'Annuler',
    kind: 'success',
    durationMs: 8_000,
  });

  if (!clicked) return;

  // L'user a cliqué Annuler.
  const undoRes = (await sendMessage({
    type: 'UNDO_LAST_PUSH',
    payload: response.undo,
  })) as { ok: boolean; error?: string };

  if (undoRes.ok) {
    showToast('Annulé. L\'épisode a été remis dans son état précédent.', 'info', 4000);
  } else {
    showToast(`Impossible d'annuler : ${undoRes.error ?? 'erreur inconnue'}`, 'error', 5000);
  }
}

async function handleProgressPush(detection: DetectionResult, ratio: number) {
  console.info(LOG, `Seuil atteint (${Math.round(ratio * 100)}%), push...`);
  try {
    const response = (await sendMessage({
      type: 'PROGRESS_UPDATE',
      payload: buildPayload(detection, ratio),
    })) as TrackResultPayload;

    if (response.success) {
      void notifyPushedWithUndo(detection, response);
      return;
    }
    if ('ignored' in response && response.ignored) return;
    if ('error' in response && response.error === 'not_confirmed') {
      console.info(LOG, 'Série non confirmée, push ignoré.');
      return;
    }
    if ('error' in response && response.error) {
      showToast(`Impossible : ${response.error}`, 'error');
    }
  } catch (err) {
    console.warn(LOG, 'Erreur push:', err);
  }
}

function observeNavigation() {
  let lastUrl = location.href;
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Mode B : si engagement ≥ 10 min sur l'ancien épisode + on n'était pas
      // en mode video direct (où le push à 85 % se gère seul) → on push
      // l'ancien épisode avant de cleanup.
      if (
        currentDetection &&
        !videoObserverAttached &&
        audioObserver?.hasReachedEngagement()
      ) {
        console.info(LOG, '[mode B] push épisode précédent au changement de page');
        void handleProgressPush(currentDetection, 1);
      }

      // Reset complet à chaque navigation SPA.
      cleanupObserver?.();
      cleanupObserver = null;
      audioObserver?.cleanup();
      audioObserver = null;
      cancelDiscovery();
      discoveryFired = false;
      currentDetection = null;
      currentVideo = null;
      videoObserverAttached = false;
      removeWatchingBadge();
      reportTrackingState();
      setTimeout(evaluateCurrentPage, 500);
    }
  };
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    setTimeout(check, 60);
  };
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    setTimeout(check, 60);
  };
  window.addEventListener('popstate', check);
  // Filet de sécurité : poll léger car certains sites manipulent l'URL en JS sans pushState.
  setInterval(check, 2000);
}

// ─────────────────────────── Mode iframe ────────────────────────────────────

/**
 * Quand le content script tourne dans une iframe (player tiers cross-origin
 * activé via wizard), on n'a pas accès à la page parente — on ne peut donc
 * pas faire de discovery soi-même. Mode minimal :
 *  - On observe le `<video>` direct (présent dans cette iframe)
 *  - On envoie les events au SW qui les relai au top frame
 *  - Le top frame déclenche sa logique de discovery normale
 */
function initIframeMode() {
  console.info(LOG, 'Iframe mode loaded on', location.hostname);
  let cleanup: (() => void) | null = null;

  const ensureObserver = () => {
    if (cleanup) return;
    cleanup = observeVideoProgress({
      selector: 'video',
      threshold: 0.85,
      dedupKey: `iframe:${location.href}`,
      onAttach: () => {
        console.info(LOG, '[iframe] vidéo attachée');
      },
      onPlayStart: () => {
        void sendMessage({
          type: 'FRAME_PLAY_START',
          payload: { frameUrl: location.href },
        }).catch(() => {});
      },
      onThresholdReached: (ratio) => {
        void sendMessage({
          type: 'FRAME_THRESHOLD_REACHED',
          payload: { frameUrl: location.href, ratio },
        }).catch(() => {});
      },
    });
  };

  ensureObserver();
  // Re-scan en cas de DOM tardif (player monté async)
  const obs = new MutationObserver(ensureObserver);
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// ─────────────────────── Top frame init (existant) ──────────────────────────

function initTopFrameMode() {
  console.info(LOG, 'Content script loaded on', location.hostname);
  // Charge le LearnedPattern AVANT la 1re évaluation (évite un faux pass à
  // la Couche 1 sur les pages où l'user a déjà configuré un pattern).
  void (async () => {
    learnedPattern = await loadLearnedPattern(location.hostname);
    if (learnedPattern) console.info(LOG, 'LearnedPattern actif pour', location.hostname);
    evaluateCurrentPage();
    // Si l'user vient d'activer ce site depuis le popup, on lance directement
    // le wizard au boot — flow « Ajouter ce site » = activation + configuration.
    await maybeAutoLaunchWizard();
  })();
  observeDomReady();
  observeNavigation();
  listenToIframeRelay();
  observeLearnedPatternChanges();
  // Heartbeat tracking state : update toutes les 30 sec côté SW (utilisé par
  // le popup pour décider d'afficher le bouton « Marquer cet épisode vu »).
  setInterval(reportTrackingState, 30_000);
}

/**
 * Si le SW a marqué ce host comme « pending wizard » suite à une activation
 * depuis le popup, on consomme le flag et on lance le wizard automatiquement.
 * L'user enchaîne « Ajouter ce site » → wizard sans étape intermédiaire.
 */
async function maybeAutoLaunchWizard() {
  try {
    const should = await storage.consumePendingWizardForHost(location.hostname);
    if (!should) return;
    console.info(LOG, 'Auto-lancement du wizard suite à activation user');
    const pattern = await launchConfigWizard({ kind: 'anime' });
    if (pattern) {
      learnedPattern = pattern;
      evaluateCurrentPage();
    }
  } catch (err) {
    console.warn(LOG, 'maybeAutoLaunchWizard erreur:', err);
  }
}

async function loadLearnedPattern(host: string): Promise<LearnedPattern | null> {
  try {
    const { learnedPatterns = {} } = (await chrome.storage.local.get('learnedPatterns')) as {
      learnedPatterns?: Record<string, LearnedPattern>;
    };
    return learnedPatterns[host] ?? null;
  } catch {
    return null;
  }
}

/**
 * Garde `learnedPattern` à jour si l'user sauvegarde / retire un pattern
 * pendant que l'onglet est ouvert (sans recharger la page).
 */
function observeLearnedPatternChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!('learnedPatterns' in changes)) return;
    const next = (changes.learnedPatterns.newValue ?? {}) as Record<string, LearnedPattern>;
    learnedPattern = next[location.hostname] ?? null;
    evaluateCurrentPage();
  });
}

/**
 * Push l'état courant du tracking au SW. Utilisé par le popup (mode A) pour
 * décider d'afficher un bouton « Marquer cet épisode comme vu ».
 */
function reportTrackingState() {
  void sendMessage({
    type: 'REPORT_TRACKING_STATE',
    payload: {
      mode: videoObserverAttached ? 'video' : audioObserver ? 'audio' : null,
      engagementReached: audioObserver?.hasReachedEngagement() ?? false,
      cumulativeMs: audioObserver?.getCumulativeMs() ?? 0,
      // Confirmé = on a une détection courante (donc cache/discovery a tourné)
      confirmed: !!currentDetection,
      title: currentDetection?.title,
    },
  }).catch(() => {});
}

/**
 * Top frame écoute les relais d'events vidéo venant des sub-frames (players
 * cross-origin activés). Déclenche discovery / push avec sa propre détection
 * (le sub-frame n'en a pas — pas de meta og/ld+json sur un player nu).
 */
function listenToIframeRelay() {
  chrome.runtime.onMessage.addListener(
    (raw: ExtensionMessage | IframeRelayMessage, _sender, sendResponse) => {
      const message = raw as IframeRelayMessage | ExtensionMessage;
      if (message.type === 'IFRAME_PLAY_START' && currentDetection) {
        console.info(LOG, '[top] iframe play relai');
        void handleDiscovery(currentDetection);
        return false;
      }
      if (message.type === 'IFRAME_THRESHOLD_REACHED' && currentDetection) {
        console.info(LOG, '[top] iframe threshold relai');
        void handleProgressPush(currentDetection, message.payload.ratio);
        return false;
      }
      if (message.type === 'TAB_AUDIBLE_CHANGED') {
        audioObserver?.update(message.payload.audible);
        return false;
      }
      // Mode A : bouton « Marquer cet épisode vu » du popup.
      if (message.type === 'MARK_AS_WATCHED_NOW') {
        if (!currentDetection) {
          sendResponse({ ok: false, error: 'Aucune détection active' });
          return false;
        }
        void (async () => {
          try {
            await handleProgressPush(currentDetection!, 1);
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: (err as Error)?.message ?? 'erreur inconnue' });
          }
        })();
        return true;
      }
      return false;
    },
  );
}

// ──────────────────────────────── Boot ──────────────────────────────────────

if (window.top === window.self) {
  initTopFrameMode();
} else {
  initIframeMode();
}
