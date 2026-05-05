/**
 * Canal de messagerie typé entre content script, popup et background.
 * Utilise `chrome.runtime.sendMessage` sous le capot.
 */

import type { LearnedPattern, StrategyId } from './types';

/**
 * Résultat brut d'une stratégie de détection (E17).
 * Chaque stratégie tourne indépendamment et retourne ce qu'elle a trouvé.
 * Le wizard les affiche côte-à-côte pour validation user.
 */
export interface StrategyResult {
  id: StrategyId;
  /** Libellé court pour l'UI. */
  label: string;
  /** Description « d'où ça vient » (ex: « Lit `<script type=ld+json>` »). */
  description: string;
  /** Champs extraits — `undefined` si la stratégie n'a rien trouvé. */
  title?: string;
  episode?: number;
  season?: number;
  /** Fragment d'évidence (ex: snippet JSON-LD, regex match) à montrer à l'user. */
  evidence?: string;
  /** Score 0..1. 0 = rien, 1 = tout (titre + épisode + bonus). */
  confidence: number;
}

export interface ProgressUpdatePayload {
  siteId: string;
  url: string;
  title: string;
  episode?: number;
  chapter?: number;
  season?: number;
  slug?: string;
  seriesId?: string;
  seriesSlug?: string;
  kind: 'anime' | 'manga';
  progressRatio: number;
}

/**
 * Candidat retourné par le matcher quand l'user doit confirmer.
 * Inclut le statut existant côté liste utilisateur si l'anime est déjà suivi.
 */
export interface CandidateMedia {
  id: string;
  mediaType: 'Anime' | 'Manga';
  title: string;
  alias?: string[];
  coverUrl?: string | null;
  year?: number | null;
  score: number;
  /**
   * `true` si ce candidat est une proposition PENDING (pas encore validée par
   * le staff). Confirmer dessus crée une list entry attachée à la proposal —
   * l'œuvre se trouvera dans la liste user en attente de validation.
   */
  isPending?: boolean;
  /** ID de la proposal (présent uniquement si `isPending: true`). */
  proposalId?: string;
  /** Nombre d'utilisateurs qui appuient cette proposition. */
  supportCount?: number;
  /** Statut de l'anime/manga dans la liste de l'user, si présent. */
  existingListEntry?: {
    id: string;
    status: string;
    episodesWatched?: number;
    chaptersRead?: number;
    rewatchCount?: number;
  } | null;
}

/**
 * Réponse du tracker à un push (PROGRESS_UPDATE, à 85 %) : push effectué si
 * cache hit, sinon silent (l'user a déjà eu sa chance pendant la phase
 * discovery au début de la lecture — ne pas re-prompter à 85 %).
 */
export interface UndoSnapshot {
  /** ID de la list entry impactée. */
  listEntryId: string;
  /** Valeur d'`episodesWatched` AVANT le push (pour revert anime). */
  previousEpisodesWatched?: number;
  /** Valeur de `chaptersRead` AVANT le push (pour revert manga). */
  previousChaptersRead?: number;
  /** Statut AVANT le push (à revert si on a écrasé un statut différent). */
  previousStatus?: string;
  /** `rewatchCount` AVANT le push (revert si on l'a incrémenté, anime uniquement). */
  previousRewatchCount?: number;
  /** `true` si le push a créé l'entry (l'undo doit la DELETE). */
  wasCreated: boolean;
}

export type TrackResultPayload =
  | {
      success: true;
      actunimeEntityId: string;
      matchedTitle?: string;
      episodesWatched?: number;
      chaptersRead?: number;
      isRewatch?: boolean;
      /** Permet à l'user d'annuler le push via un toast. */
      undo?: UndoSnapshot;
      /**
       * Le numéro courant (épisode/chapitre lu sur le site) est INFÉRIEUR à la
       * progression déjà enregistrée dans la liste user. Aucun push API n'a été
       * effectué. Le content script affiche un dialog pour demander quoi faire
       * (régresser la liste, ou rester silencieux jusqu'au rattrapage).
       */
      behind?: {
        listCount: number;
        currentNumber: number;
        seriesKey: string;
        listEntryId: string;
        kind: 'anime' | 'manga';
      };
    }
  | { success: false; error: string }
  | { success: false; ignored: true };

/**
 * Action user après dialog "tu es derrière ta liste" — appelée via
 * `RESOLVE_BEHIND` pour appliquer le choix côté tracker.
 */
export type BehindResolution =
  | {
      action: 'regress';
      seriesKey: string;
      listEntryId: string;
      targetCount: number;
      kind: 'anime' | 'manga';
    }
  | { action: 'catch-up'; seriesKey: string };

/**
 * Réponse à un DISCOVER_SERIES (à `playing`). Le but est uniquement
 * d'identifier la série, pas de pousser un épisode.
 */
export interface ExistingListEntrySummary {
  status: string;
  episodesWatched?: number;
  chaptersRead?: number;
  rewatchCount?: number;
}

export type DiscoveryResultPayload =
  | {
      state: 'cached';
      seriesKey: string;
      matchedTitle: string;
      coverUrl?: string | null;
      /** État courant de la liste user pour cet anime (si présent). */
      existingListEntry?: ExistingListEntrySummary | null;
    }
  | { state: 'ignored' }
  | { state: 'no_match'; error?: string }
  | {
      state: 'needs_confirmation';
      seriesKey: string;
      candidates: CandidateMedia[];
      detection: {
        title: string;
        chapter?: number;
        episode?: number;
        season?: number;
      };
    }
  | { state: 'error'; error: string };

/**
 * Réponse à un CONFIRM_TRACK (sortie du toast de confirmation). Le push se
 * fait via PROGRESS_UPDATE à 85 % — la confirmation ne fait que (dé)cacher
 * la décision côté storage.
 */
export type ConfirmResultPayload =
  | {
      state: 'cached';
      seriesKey: string;
      matchedTitle: string;
      coverUrl?: string | null;
      existingListEntry?: ExistingListEntrySummary | null;
    }
  | { state: 'ignored' }
  | { state: 'skipped' }
  | { state: 'error'; error: string };

export type DetectionStatusPayload =
  | { detected: false }
  | {
      detected: true;
      siteId: string;
      kind: 'anime' | 'manga';
      title: string;
      episode?: number;
      chapter?: number;
      season?: number;
      slug?: string;
      seriesId?: string;
      seriesSlug?: string;
      url: string;
    };

export interface MatchRequestPayload {
  siteId: string;
  slug?: string;
  title: string;
  /** Indispensable pour reconstruire la `seriesKey` et hit le cache de confirmation user. */
  seriesId?: string;
  seriesSlug?: string;
  season?: number;
  kind?: 'anime' | 'manga';
}

/**
 * Minimale : juste ce dont le popup a besoin pour afficher une card.
 * Subset du `SearchAnime` retourné par l'API.
 */
export interface MatchedMediaSummary {
  id: string;
  title: string;
  alias?: string[];
  coverUrl?: string | null;
  year?: number | null;
  externs?: {
    AL_ID?: number;
    MAL_ID?: number;
    KITSU_ID?: number;
  };
  /**
   * `true` quand l'œuvre n'est pas encore validée par le staff (proposition
   * en attente). Le popup affiche un badge dédié au lieu de l'année.
   * `id` est alors le `listEntryId`, pas le `mediaId`.
   */
  isPending?: boolean;
  /**
   * Nombre d'utilisateurs qui appuient cette proposition (pending uniquement).
   * Inclut l'auteur initial et tous les users qui ont rejoint via dédup.
   */
  supportCount?: number;
}

export type MatchResultPayload =
  | { matched: true; media: MatchedMediaSummary; score: number }
  | { matched: false; reason: 'no_match' | 'not_authenticated' | 'error'; error?: string };

/**
 * Réponse de l'user au prompt de confirmation, renvoyée par le content script
 * au background. Inclut tout ce dont le tracker a besoin pour pousser sans
 * recharger l'état.
 */
export type ConfirmTrackPayload =
  | {
      action: 'confirm';
      seriesKey: string;
      chosenMediaId: string;
      /** Titre Actunime affiché dans le badge / cache (pas le titre du site). */
      chosenTitle: string;
      /** Cover Actunime pour affichage dans le badge ultérieur. */
      chosenCoverUrl?: string | null;
      /** Mémorise l'intention « rewatch » dans le cache (utilisée au push 85 %). */
      isRewatch: boolean;
      /**
       * Si défini, le candidat est une proposition PENDING — on crée une list
       * entry attachée à la proposal au lieu de cacher un mediaId.
       */
      proposalId?: string;
      /** Type de média (utilisé quand on attache à une proposal pending). */
      kind?: 'anime' | 'manga';
    }
  | { action: 'skip' }
  | { action: 'ignore_series'; seriesKey: string };

export type ExtensionMessage =
  | { type: 'DISCOVER_SERIES'; payload: ProgressUpdatePayload }
  | { type: 'PROGRESS_UPDATE'; payload: ProgressUpdatePayload }
  | { type: 'CONFIRM_TRACK'; payload: ConfirmTrackPayload }
  | { type: 'RESEARCH_QUERY'; payload: { query: string; kind?: 'anime' | 'manga' } }
  | { type: 'SUGGEST_ALIAS'; payload: { animeId: string; alias: string } }
  | {
      type: 'OPEN_CONTRIBUTION_TAB';
      payload: {
        kind: 'anime' | 'manga';
        title: string;
        season?: number;
        episode?: number;
        sourceUrl?: string;
      };
    }
  | { type: 'AUTH_PING' }
  | { type: 'GET_DETECTION' }
  | { type: 'MATCH_BY_DETECTION'; payload: MatchRequestPayload }
  | { type: 'FETCH_IMAGE'; payload: { url: string } }
  | { type: 'FORGET_MATCH'; payload: { seriesKey: string } }
  | { type: 'ACTIVATE_HOST'; payload: { host: string } }
  | { type: 'DEACTIVATE_HOST'; payload: { host: string } }
  | { type: 'LIST_ACTIVATED_HOSTS' }
  | { type: 'CHECK_HOST_STATE'; payload: { host: string } }
  | { type: 'QUERY_TAB_AUDIBLE' }
  | {
      type: 'REPORT_TRACKING_STATE';
      payload: {
        mode: 'audio' | 'manual' | null;
        engagementReached: boolean;
        cumulativeMs: number;
        confirmed: boolean;
        title?: string;
      };
    }
  | { type: 'GET_TRACKING_STATE_FOR_TAB'; payload: { tabId: number } }
  | { type: 'MARK_AS_WATCHED_NOW' }
  | { type: 'UNDO_LAST_PUSH'; payload: UndoSnapshot }
  | { type: 'RESOLVE_BEHIND'; payload: BehindResolution }
  | { type: 'LAUNCH_CONFIG_WIZARD' }
  | { type: 'SAVE_LEARNED_PATTERN'; payload: { pattern: LearnedPattern } }
  | { type: 'REMOVE_LEARNED_PATTERN'; payload: { host: string } }
  | { type: 'LIST_LEARNED_PATTERNS' }
  | { type: 'GET_LEARNED_PATTERN'; payload: { host: string } }
  | { type: 'CHECK_API_HEALTH' }
  | {
      type: 'CONTRIBUTE_PROPOSE_MEDIA';
      payload: {
        kind: 'anime' | 'manga';
        title: string;
        /** Synonymes / titres alternatifs (anglais, original, abréviations…). */
        aliases?: string[];
        format: string;
        country: string;
        status: string;
        coverDataUrl: string;
        /** Numéro initial à pré-remplir dans la list entry (épisode pour anime, chapitre pour manga). */
        episode?: number;
        chapter?: number;
        /** Statut de la list entry créée. Défaut form : `WATCHING` (anime) / `READING` (manga). */
        listStatus?: string;
      };
    }
  | {
      type: 'OPEN_CONTRIBUTION_FORM';
      payload: {
        kind?: 'anime' | 'manga';
        title: string;
        season?: number;
        episode?: number;
        chapter?: number;
        sourceUrl?: string;
      };
    }
  | { type: 'START_IMAGE_PICK' };

export interface OpenContributionTabResultPayload {
  ok: boolean;
  error?: string;
}

export interface ActivateHostResultPayload {
  ok: boolean;
  /** L'user a refusé le prompt natif Chrome. */
  denied?: boolean;
  error?: string;
}

export type HostActivationState =
  | 'activated' // activé via wizard user
  | 'inactive'; // pas activé

export interface CheckHostStateResultPayload {
  state: HostActivationState;
  /** Hostname normalisé qu'on a évalué. */
  host: string;
}

export interface ListActivatedHostsResultPayload {
  hosts: { host: string; activatedAt: number }[];
}

export interface TrackingStatePayload {
  mode: 'audio' | 'manual' | null;
  engagementReached: boolean;
  cumulativeMs: number;
  /** L'œuvre est confirmée dans le cache (= prête à push). */
  confirmed: boolean;
  title?: string;
}

export interface MarkAsWatchedResultPayload {
  ok: boolean;
  error?: string;
}

export interface UndoLastPushResultPayload {
  ok: boolean;
  error?: string;
}

export interface LaunchConfigWizardResultPayload {
  ok: boolean;
  /** Pattern sauvegardé si l'user a complété le wizard. */
  pattern?: LearnedPattern;
  /** L'user a fermé sans valider. */
  cancelled?: boolean;
  error?: string;
}

export interface SaveLearnedPatternResultPayload {
  ok: boolean;
  error?: string;
}

export interface ListLearnedPatternsResultPayload {
  patterns: LearnedPattern[];
}

export interface GetLearnedPatternResultPayload {
  pattern: LearnedPattern | null;
}

export interface CheckApiHealthResultPayload {
  ok: boolean;
}

export type ContributeProposeMediaResultPayload =
  | {
      ok: true;
      proposalId: string;
      listEntryId: string;
      /** `true` si une proposition existante a été rejointe (pas de nouvelle création). */
      joinedExisting?: boolean;
    }
  | { ok: false; error: string };

export type IframeRelayMessage = { type: 'TAB_AUDIBLE_CHANGED'; payload: { audible: boolean } };

export interface ResearchResultPayload {
  candidates: CandidateMedia[];
  /** Vide si l'API ne renvoie rien. */
  empty?: boolean;
  error?: string;
}

export interface SuggestAliasResultPayload {
  ok: boolean;
  /** ID de la proposal créée si ok. */
  proposalId?: string;
  error?: string;
}

export interface FetchImageResultPayload {
  ok: boolean;
  /** Data URL (base64) si ok=true. */
  dataUrl?: string;
  error?: string;
}

export type ExtensionResponse =
  | TrackResultPayload
  | DiscoveryResultPayload
  | ConfirmResultPayload
  | FetchImageResultPayload
  | ResearchResultPayload
  | SuggestAliasResultPayload
  | OpenContributionTabResultPayload
  | ActivateHostResultPayload
  | CheckHostStateResultPayload
  | ListActivatedHostsResultPayload
  | TrackingStatePayload
  | MarkAsWatchedResultPayload
  | UndoLastPushResultPayload
  | LaunchConfigWizardResultPayload
  | SaveLearnedPatternResultPayload
  | ListLearnedPatternsResultPayload
  | GetLearnedPatternResultPayload
  | CheckApiHealthResultPayload
  | ContributeProposeMediaResultPayload
  | { authenticated: boolean }
  | DetectionStatusPayload
  | MatchResultPayload
  | { error: string };

/**
 * Envoi d'un message vers le service worker (background).
 */
export async function sendMessage<R = ExtensionResponse>(message: ExtensionMessage): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

/**
 * Envoi d'un message vers un content script d'un onglet précis. Utilisé par le
 * popup pour demander l'état de détection au content script de l'onglet actif.
 */
export async function sendTabMessage<R = ExtensionResponse>(
  tabId: number,
  message: ExtensionMessage,
): Promise<R> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<R>;
}
