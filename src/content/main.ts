import {
  sendMessage,
  type ConfirmResultPayload,
  type DetectionStatusPayload,
  type DiscoveryResultPayload,
  type ExtensionMessage,
  type IframeRelayMessage,
  type ResearchResultPayload,
  type TrackResultPayload,
} from '@/shared/messaging';
import type { DetectionResult } from './detection';
import { applyLearnedPattern } from './learned-engine';
import { detectGenericFromDom, inferKind } from './heuristics';
import { startImagePick } from './image-pick';
import { launchConfigWizard } from './wizard';
import { storage } from '@/shared/storage';
import type { LearnedPattern } from '@/shared/types';
import { buildResumeUrl } from '@/shared/resume-url';
import { createAudioObserver, type AudioObserver } from './progress/audio';
import { createScrollObserver, type ScrollObserver } from './progress/scroll';
import { createPageCounterObserver, type PageCounterObserver } from './progress/page-counter';
import { createNextButtonObserver, type NextButtonObserver } from './progress/next-button';
import {
  removeConfigPrompt,
  removeWatchingBadge,
  showActionToast,
  showConfigPrompt,
  showConfirmationCard,
  showToast,
  showWatchingBadge,
  suggestAlias,
  type ConfirmationChoice,
} from './overlay';

const LOG = '[Actunime]';

let currentDetection: DetectionResult | null = null;
const DISCOVERY_DELAY_MS = 5_000;
const MANGA_DISCOVERY_DELAY_MS = 2_000;
/**
 * Fenêtre pendant laquelle, si un LearnedPattern existe mais que sa stratégie
 * échoue encore (SPA : `<title>`/metadata montés après le load), on attend au
 * lieu de retomber sur la détection générique — qui capterait un titre pourri
 * (« MangaFire - ») et déclencherait le prompt avec.
 */
const LEARNED_GRACE_MS = 12_000;
let navigationStartedAt = Date.now();
let graceRetryTimer: ReturnType<typeof setTimeout> | null = null;
let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
let discoveryFired = false;
let learnedPattern: LearnedPattern | null = null;
let audioObserver: AudioObserver | null = null;
let mangaObserver: ScrollObserver | PageCounterObserver | NextButtonObserver | null = null;
let configPromptDismissed = false;
let mangaInitializedForUrl: string | null = null;
let mangaInitializedChapter: number | undefined = undefined;

function evaluateCurrentPage() {
  const host = location.hostname;

  const learned = applyLearned();
  if (!learned && learnedPattern && Date.now() - navigationStartedAt < LEARNED_GRACE_MS) {
    scheduleGraceRetry();
    return;
  }
  const detection: DetectionResult | null = learned ?? buildGenericDetection(host);

  if (!detection) {
    audioObserver?.cleanup();
    audioObserver = null;
    mangaObserver?.cleanup();
    mangaObserver = null;
    currentDetection = null;
    removeWatchingBadge();
    removeConfigPrompt();
    return;
  }

  if (!learnedPattern) {
    audioObserver?.cleanup();
    audioObserver = null;
    mangaObserver?.cleanup();
    mangaObserver = null;
    currentDetection = null;
    removeWatchingBadge();
    if (!configPromptDismissed) {
      showConfigPrompt({
        kind: detection.kind,
        onConfigure: async () => {
          const initialKind = detection.kind ?? inferKind();
          const pattern = await launchConfigWizard({ kind: initialKind });
          if (pattern) {
            learnedPattern = pattern;
            evaluateCurrentPage();
          }
        },
        onDismiss: () => {
          configPromptDismissed = true;
        },
      });
    }
    return;
  }
  removeConfigPrompt();

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

  if (sameKey && (audioObserver || mangaObserver)) return;

  audioObserver?.cleanup();
  audioObserver = null;
  mangaObserver?.cleanup();
  mangaObserver = null;

  if (detection.kind === 'manga') {
    if (mangaInitializedForUrl === location.href && mangaInitializedChapter === detection.chapter) {
      // Le cleanup ci-dessus a pu détruire l'observer (titre affiné → sameKey
      // false) alors que le chapitre n'a pas changé : ré-attache sans relancer
      // la discovery.
      if (!mangaObserver) attachMangaObserver(detection);
      return;
    }
    cancelDiscovery();
    discoveryFired = false;
    removeWatchingBadge();
    mangaInitializedForUrl = location.href;
    mangaInitializedChapter = detection.chapter;
    void scheduleDiscovery(MANGA_DISCOVERY_DELAY_MS);
    attachMangaObserver(detection);
    reportTrackingState();
    return;
  }

  audioObserver = createAudioObserver({
    onPlayStart: () => {
      console.info(LOG, 'Audio stable détecté, tracking actif (mode audio).');
      scheduleDiscovery(0);
      reportTrackingState();
    },
    onEngagementReached: (cumMs) => {
      console.info(LOG, `Engagement audio atteint (${Math.round(cumMs / 60_000)} min).`);
      reportTrackingState();
    },
  });

  void (async () => {
    try {
      const res = (await sendMessage({ type: 'QUERY_TAB_AUDIBLE' })) as {
        audible: boolean;
      };
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
 * - Mode manga : 2s — laisse le `<title>`/DOM finir de se monter ; le timer
 *   lit `currentDetection` au moment du tir, donc un titre affiné entre-temps
 *   est pris en compte.
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
 * Pendant la grace period learned, garantit une ré-évaluation même si le DOM
 * ne mute plus (le MutationObserver ne re-déclencherait alors jamais).
 */
function scheduleGraceRetry() {
  if (graceRetryTimer) return;
  graceRetryTimer = setTimeout(() => {
    graceRetryTimer = null;
    evaluateCurrentPage();
  }, 1_000);
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

function attachMangaObserver(detection: DetectionResult) {
  const config = learnedPattern?.mangaTracking;
  if (!config || config.mode === 'manual') return;

  const trigger = () => {
    if (!currentDetection) return;
    console.info(LOG, `[manga] trigger via ${config.mode}, push chapitre`);
    void handleProgressPush(currentDetection, 1);
  };

  if (config.mode === 'scroll') {
    mangaObserver = createScrollObserver({
      threshold: config.threshold ?? 0.9,
      containerSelector: config.selector,
      onReached: trigger,
    });
    return;
  }
  if (config.mode === 'page-counter' && config.selector) {
    mangaObserver = createPageCounterObserver({
      selector: config.selector,
      onReached: trigger,
    });
    return;
  }
  if (config.mode === 'next-button' && config.selector) {
    mangaObserver = createNextButtonObserver({
      selector: config.selector,
      onClicked: trigger,
    });
    return;
  }
  void detection;
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
    chapter: generic.chapter,
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
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const titleObserver = new MutationObserver(scheduleEvaluation);
    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

/**
 * Répond aux messages venant du popup (principalement `GET_DETECTION` pour
 * afficher l'état courant dans l'UI).
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
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
        const initialKind = learnedPattern?.kind ?? currentDetection?.kind ?? inferKind();
        const pattern = await launchConfigWizard({ kind: initialKind });
        if (pattern) {
          learnedPattern = pattern;
          // Re-évalue la page avec le nouveau pattern actif
          evaluateCurrentPage();
          sendResponse({ ok: true, pattern });
        } else {
          sendResponse({ ok: false, cancelled: true });
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: (err as Error)?.message ?? 'erreur wizard',
        });
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
          chapter: currentDetection.chapter,
          season: currentDetection.season,
          slug: currentDetection.slug,
          seriesId: currentDetection.seriesId,
          seriesSlug: currentDetection.seriesSlug,
          url: currentDetection.url,
        }
      : { detected: false };
    sendResponse(response);
    return false;
  }
  return false;
});

function buildPayload(detection: DetectionResult, ratio: number) {
  return {
    siteId: detection.siteId,
    url: detection.url,
    title: detection.title,
    episode: detection.episode,
    chapter: detection.chapter,
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
  discoveryFired = false;
  mangaInitializedForUrl = null;
  mangaInitializedChapter = undefined;

  const research = (await sendMessage({
    type: 'RESEARCH_QUERY',
    payload: { query: detection.title, kind: detection.kind },
  })) as ResearchResultPayload;

  console.log(LOG, 'handleEditMatch RESEARCH_QUERY', research);

  const choice = await showConfirmationCard({
    detectedTitle: detection.title,
    episode: detection.episode || detection.chapter,
    season: detection.season,
    kind: detection.kind,
    sourceUrl: detection.url,
    candidates: research.candidates ?? [],
  });

  await handleConfirmationChoice(choice, seriesKey, detection);
}

async function handleConfirmationChoice(
  choice: ConfirmationChoice,
  seriesKey: string,
  detection: DetectionResult,
) {
  if (choice.action === 'configure_site') {
    await handleReconfigure(detection);
    return;
  }
  if (choice.action === 'open_contribution') return;

  const confirmRes = (await sendMessage({
    type: 'CONFIRM_TRACK',
    payload:
      choice.action === 'confirm'
        ? {
            action: 'confirm',
            seriesKey,
            chosenMediaId: choice.chosenMediaId,
            chosenTitle: choice.chosenTitle,
            chosenCoverUrl: choice.chosenCoverUrl,
            isRewatch: choice.isRewatch,
            proposalId: choice.proposalId,
            kind: detection.kind,
          }
        : choice.action === 'ignore_series'
          ? { action: 'ignore_series', seriesKey }
          : { action: 'skip' },
  })) as ConfirmResultPayload;

  if (confirmRes.state === 'cached') {
    const isManga = detection.kind === 'manga';
    showWatchingBadge({
      kind: detection.kind,
      matchedTitle: confirmRes.matchedTitle,
      coverUrl: confirmRes.coverUrl,
      episode: detection.episode,
      chapter: detection.chapter,
      season: detection.season,
      mode: isManga ? 'manual' : 'audio',
      listProgress: confirmRes.existingListEntry,
      onEdit: () => handleEditMatch(confirmRes.seriesKey, detection),
      onMarkNow: () => handleMarkNowFromBadge(detection),
      onIgnore: () => handleIgnoreFromBadge(confirmRes.seriesKey),
      onReconfigure: () => handleReconfigure(detection),
      resume: computeResume(detection, confirmRes.existingListEntry),
    });
  } else if (confirmRes.state === 'ignored') {
    showToast('Série ignorée. Tu peux la réactiver depuis les options.', 'info');
  } else if (confirmRes.state === 'error') {
    showToast(`Impossible : ${confirmRes.error}`, 'error');
  }
}

function computeResume(
  detection: DetectionResult,
  listProgress:
    | {
        episodesWatched?: number;
        chaptersRead?: number;
      }
    | null
    | undefined,
): { targetNumber: number; onResume: () => void } | undefined {
  const isManga = detection.kind === 'manga';
  const currentNumber = isManga ? detection.chapter : detection.episode;
  const consumed = isManga ? listProgress?.chaptersRead : listProgress?.episodesWatched;
  if (currentNumber === undefined || consumed === undefined || consumed <= currentNumber) {
    return undefined;
  }
  const targetNumber = consumed + 1;
  const url = buildResumeUrl(window.location.href, currentNumber, targetNumber);
  if (!url) return undefined;
  return {
    targetNumber,
    onResume: () => {
      window.location.href = url;
    },
  };
}

async function handleReconfigure(detection: DetectionResult) {
  removeWatchingBadge();
  const initialKind = learnedPattern?.kind ?? detection.kind ?? inferKind();
  const pattern = await launchConfigWizard({ kind: initialKind });
  if (pattern) {
    learnedPattern = pattern;
    mangaInitializedForUrl = null;
    mangaInitializedChapter = undefined;
    discoveryFired = false;
    evaluateCurrentPage();
  }
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
  console.info(LOG, 'Lecture détectée, discovery série...', detection);
  try {
    const response = (await sendMessage({
      type: 'DISCOVER_SERIES',
      payload: buildPayload(detection, 0),
    })) as DiscoveryResultPayload;

    console.info(LOG, 'Réponse discovery:', response);

    if (response.state === 'cached') {
      console.info(LOG, `Série en cache : ${response.matchedTitle}`);
      const isManga = detection.kind === 'manga';
      showWatchingBadge({
        kind: detection.kind,
        matchedTitle: response.matchedTitle,
        coverUrl: response.coverUrl,
        episode: detection.episode,
        chapter: detection.chapter,
        season: detection.season,
        mode: isManga ? 'manual' : 'audio',
        listProgress: response.existingListEntry,
        onEdit: () => handleEditMatch(response.seriesKey, detection),
        onMarkNow: () => handleMarkNowFromBadge(detection),
        onIgnore: () => handleIgnoreFromBadge(response.seriesKey),
        onReconfigure: () => handleReconfigure(detection),
        resume: computeResume(detection, response.existingListEntry),
      });
      return;
    }
    if (response.state === 'ignored') {
      console.info(LOG, "Série ignorée par l'user, pas de tracking.");
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

    console.log(LOG, 'choice...');
    // needs_confirmation (avec ou sans candidats — la card propose le CTA
    // contribution dans le cas vide).
    const choice = await showConfirmationCard({
      detectedTitle: response.detection.title,
      episode: response.detection.episode || response.detection.chapter,
      season: response.detection.season,
      kind: detection.kind,
      sourceUrl: detection.url,
      candidates: response.candidates,
    });

    console.log(LOG, 'choice:', choice);

    // L'user dit « le titre détecté est faux, configure le site ». On lance
    // le wizard ; après save, on relance une discovery avec la nouvelle
    // détection issue du LearnedPattern.
    if (choice.action === 'configure_site') {
      const pattern = await launchConfigWizard({ kind: detection.kind });
      if (!pattern) return; // user a annulé
      // Manga : le listener storage.onChanged relance déjà évaluation +
      // discovery (avec le délai de stabilité) — pas de retry direct ici.
      if (pattern.kind === 'manga') return;
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
              chosenMediaId: choice.chosenMediaId,
              chosenTitle: choice.chosenTitle,
              chosenCoverUrl: choice.chosenCoverUrl,
              isRewatch: choice.isRewatch,
              proposalId: choice.proposalId,
              kind: detection.kind,
            }
          : choice.action === 'ignore_series'
            ? { action: 'ignore_series', seriesKey: response.seriesKey }
            : { action: 'skip' },
    })) as ConfirmResultPayload;

    if (confirmRes.state === 'cached') {
      const isManga = detection.kind === 'manga';
      showWatchingBadge({
        kind: detection.kind,
        matchedTitle: confirmRes.matchedTitle,
        coverUrl: confirmRes.coverUrl,
        episode: detection.episode,
        chapter: detection.chapter,
        season: detection.season,
        mode: isManga ? 'manual' : 'audio',
        listProgress: confirmRes.existingListEntry,
        onEdit: () => handleEditMatch(confirmRes.seriesKey, detection),
        onMarkNow: () => handleMarkNowFromBadge(detection),
        onIgnore: () => handleIgnoreFromBadge(confirmRes.seriesKey),
        onReconfigure: () => handleReconfigure(detection),
        resume: computeResume(detection, confirmRes.existingListEntry),
      });
      // Suggestion d'alias post-confirmation (best-effort, stub backend pour V0.2).
      if (choice.action === 'confirm' && choice.suggestAliasFor) {
        const res = await suggestAlias(choice.chosenMediaId, choice.suggestAliasFor);
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
  const isManga = detection.kind === 'manga';
  const numberLabel = isManga ? 'Chapitre' : 'Épisode';
  const verb = isManga ? 'lu' : 'vu';
  const num = isManga
    ? (response.chaptersRead ?? detection.chapter)
    : (response.episodesWatched ?? detection.episode);
  const numStr = num ?? '?';
  const title = response.matchedTitle ?? detection.title;
  const rewatchSuffix = !isManga && response.isRewatch ? ' (↻ rewatch)' : '';
  const message = `${numberLabel} ${numStr} marqué ${verb} — ${title}${rewatchSuffix}`;

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
    const undoneLabel = isManga ? 'Le chapitre' : "L'épisode";
    showToast(`Annulé. ${undoneLabel} a été remis dans son état précédent.`, 'info', 4000);
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
      navigationStartedAt = Date.now();
      if (currentDetection && audioObserver?.hasReachedEngagement()) {
        console.info(LOG, 'Push épisode précédent au changement de page');
        void handleProgressPush(currentDetection, 1);
      }

      audioObserver?.cleanup();
      audioObserver = null;
      mangaObserver?.cleanup();
      mangaObserver = null;
      cancelDiscovery();
      discoveryFired = false;
      currentDetection = null;
      configPromptDismissed = false;
      mangaInitializedForUrl = null;
      mangaInitializedChapter = undefined;
      removeWatchingBadge();
      removeConfigPrompt();
      reportTrackingState();
      setTimeout(evaluateCurrentPage, 500);
      setTimeout(evaluateCurrentPage, 1500);
      setTimeout(evaluateCurrentPage, 3500);
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

function initTopFrameMode() {
  console.info(LOG, 'Content script loaded on', location.hostname);
  void (async () => {
    learnedPattern = await loadLearnedPattern(location.hostname);
    if (learnedPattern) console.info(LOG, 'LearnedPattern actif pour', location.hostname);
    evaluateCurrentPage();
    await maybeAutoLaunchWizard();
  })();
  observeDomReady();
  observeNavigation();
  listenToTabAudibleRelay();
  observeLearnedPatternChanges();
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
    const initialKind = learnedPattern?.kind ?? currentDetection?.kind ?? inferKind();
    const pattern = await launchConfigWizard({ kind: initialKind });
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
    mangaInitializedForUrl = null;
    mangaInitializedChapter = undefined;
    discoveryFired = false;
    evaluateCurrentPage();
  });
}

/**
 * Push l'état courant du tracking au SW. Utilisé par le popup (mode A) pour
 * décider d'afficher un bouton « Marquer cet épisode comme vu ».
 */
function reportTrackingState() {
  const isManga = currentDetection?.kind === 'manga';
  void sendMessage({
    type: 'REPORT_TRACKING_STATE',
    payload: {
      mode: isManga ? 'manual' : audioObserver ? 'audio' : null,
      engagementReached: audioObserver?.hasReachedEngagement() ?? false,
      cumulativeMs: audioObserver?.getCumulativeMs() ?? 0,
      confirmed: !!currentDetection,
      title: currentDetection?.title,
    },
  }).catch(() => {});
}

function listenToTabAudibleRelay() {
  chrome.runtime.onMessage.addListener(
    (raw: ExtensionMessage | IframeRelayMessage, _sender, sendResponse) => {
      const message = raw as IframeRelayMessage | ExtensionMessage;
      if (message.type === 'TAB_AUDIBLE_CHANGED') {
        audioObserver?.update(message.payload.audible);
        return false;
      }
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
            sendResponse({
              ok: false,
              error: (err as Error)?.message ?? 'erreur inconnue',
            });
          }
        })();
        return true;
      }
      return false;
    },
  );
}

if (window.top === window.self) {
  initTopFrameMode();
}
