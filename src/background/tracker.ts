/**
 * Pipeline de tracking V0.2 — deux phases distinctes :
 *
 *  1. **Discovery** (`handleDiscovery`) — appelée à `playing` (début lecture).
 *     But unique : identifier la série Actunime. Pas de push API.
 *       - hit cache → state `cached`
 *       - série ignorée → state `ignored`
 *       - aucun candidat → state `no_match`
 *       - sinon → state `needs_confirmation` + top N candidats
 *
 *  2. **Confirmation** (`handleConfirm`) — appelée après que l'user a cliqué
 *     dans le toast. (Dé)cache la décision. **Pas de push API.**
 *
 *  3. **Push** (`handleProgressUpdate`) — appelée à 85 %. Push si cache hit
 *     uniquement. Sinon silencieux (l'user a déjà eu sa chance en discovery).
 */

import {
  api,
  ApiError,
  API_NETWORK_ERROR_STATUS,
  entityId,
  type ListEntry,
  type SearchAnime,
} from '@/shared/api-client';
import type {
  CandidateAnime,
  ConfirmResultPayload,
  ConfirmTrackPayload,
  DiscoveryResultPayload,
  ProgressUpdatePayload,
  ResearchResultPayload,
  TrackResultPayload,
  UndoLastPushResultPayload,
  UndoSnapshot,
} from '@/shared/messaging';
import { storage } from '@/shared/storage';
import { matchTitle, pickDisplayTitle, type ScoredAnime } from './matcher';

/**
 * Déduplication en mémoire dans le service worker (clé `mediaId:episode`).
 * Évite de re-pousser si l'user revient sur la même page.
 */
const sessionPushed = new Set<string>();

// ────────────────────────── Discovery (au playing) ──────────────────────────

export async function handleDiscovery(
  payload: ProgressUpdatePayload,
): Promise<DiscoveryResultPayload> {
  try {
    const result = await matchTitle({
      siteId: payload.siteId,
      slug: payload.slug,
      title: payload.title,
      season: payload.season,
      seriesId: payload.seriesId,
      seriesSlug: payload.seriesSlug,
    });

    if (await storage.isSeriesIgnored(result.seriesKey)) {
      return { state: 'ignored' };
    }

    // Pending match : œuvre déjà proposée par l'user, en attente staff. On
    // cache automatiquement et on traite comme un cached normal — le push
    // utilisera `pendingListEntryId` au lieu de `mediaId`.
    if (result.pending) {
      await storage.setMatching(result.seriesKey, {
        actunimeEntityId: result.pending.listEntryId,
        pendingListEntryId: result.pending.listEntryId,
        title: result.pending.title,
        coverUrl: result.pending.coverUrl ?? null,
        confirmedAt: Date.now(),
      });
      return {
        state: 'cached',
        seriesKey: result.seriesKey,
        matchedTitle: result.pending.title,
        coverUrl: result.pending.coverUrl ?? null,
        existingListEntry: result.pending.status
          ? {
              status: result.pending.status,
              episodesWatched: result.pending.episodesWatched,
            }
          : null,
      };
    }

    if (result.cached) {
      // Lecture du cache complet pour récupérer le coverUrl (pas exposé par
      // le matcher qui ne renvoie qu'un fake anime minimal).
      const cachedFull = await storage.getMatching(result.seriesKey);
      const mediaId = entityId(result.cached.anime);

      // Fetch l'état courant de la liste user (status, episodesWatched, rewatchCount).
      // Best-effort : 404 = pas en liste, autre erreur = on perd juste l'enrichissement.
      let existing: ListEntry | null = null;
      if (mediaId) {
        try {
          existing = await api.getListByMedia(mediaId);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) {
            console.warn('[Actunime] getListByMedia échoué:', err);
          }
        }
      }

      return {
        state: 'cached',
        seriesKey: result.seriesKey,
        matchedTitle:
          cachedFull?.title ?? pickDisplayTitle(result.cached.anime) ?? '',
        coverUrl: cachedFull?.coverUrl ?? null,
        existingListEntry: existing
          ? {
              status: existing.status,
              episodesWatched: existing.episodesWatched,
              rewatchCount: existing.rewatchCount,
            }
          : null,
      };
    }

    // Toujours passer en `needs_confirmation` (même avec 0 candidats) pour que
    // le toast permette à l'user (a) recherche manuelle, (b) ouverture du flow
    // de contribution si l'œuvre n'est pas dans Actunime. Principe : ne jamais
    // bloquer l'utilisateur (cf. E15).
    const candidates =
      result.candidates.length > 0 ? await enrichCandidates(result.candidates) : [];
    return {
      state: 'needs_confirmation',
      seriesKey: result.seriesKey,
      candidates,
      detection: {
        title: payload.title,
        episode: payload.episode,
        season: payload.season,
      },
    };
  } catch (err) {
    return { state: 'error', error: formatError(err) };
  }
}

// ──────────────────────── Recherche manuelle (toast) ────────────────────────

export async function handleResearch(query: string): Promise<ResearchResultPayload> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return { candidates: [], error: 'Requête trop courte' };
  try {
    const res = await api.searchGlobal(cleaned, 10);
    const animes = res.animes ?? [];
    if (animes.length === 0) return { candidates: [], empty: true };
    const scored: ScoredAnime[] = animes.map((anime: SearchAnime) => ({ anime, score: 1 }));
    const candidates = await enrichCandidates(scored);
    return { candidates };
  } catch (err) {
    return { candidates: [], error: formatError(err) };
  }
}

// ──────────────────────── Confirmation (post-toast) ─────────────────────────

export async function handleConfirm(
  payload: ConfirmTrackPayload,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: { lastDetection?: ProgressUpdatePayload },
): Promise<ConfirmResultPayload> {
  if (payload.action === 'skip') return { state: 'skipped' };

  if (payload.action === 'ignore_series') {
    await storage.ignoreSeries(payload.seriesKey);
    return { state: 'ignored' };
  }

  // action === 'confirm' : on (dé)cache la décision, sans push.
  try {
    await storage.setMatching(payload.seriesKey, {
      actunimeEntityId: payload.chosenAnimeId,
      title: payload.chosenTitle,
      coverUrl: payload.chosenCoverUrl,
      confirmedAt: Date.now(),
      isRewatch: payload.isRewatch,
    });
    return {
      state: 'cached',
      seriesKey: payload.seriesKey,
      matchedTitle: payload.chosenTitle,
      coverUrl: payload.chosenCoverUrl,
    };
  } catch (err) {
    return { state: 'error', error: formatError(err) };
  }
}

// ─────────────────────────────── Push (85 %) ────────────────────────────────

export async function handleProgressUpdate(
  payload: ProgressUpdatePayload,
): Promise<TrackResultPayload> {
  try {
    const result = await matchTitle({
      siteId: payload.siteId,
      slug: payload.slug,
      title: payload.title,
      season: payload.season,
      seriesId: payload.seriesId,
      seriesSlug: payload.seriesSlug,
    });

    if (await storage.isSeriesIgnored(result.seriesKey)) {
      return { success: false, ignored: true };
    }

    // Cas pending (œuvre proposée par l'user, pas encore validée) : push direct
    // via PUT /lists/<listEntryId>. Pas de mediaId pour cette œuvre tant que
    // le staff n'a pas approuvé la proposal.
    if (result.pending) {
      const cached = await storage.getMatching(result.seriesKey);
      const pushResult = await pushPendingProgress({
        listEntryId: result.pending.listEntryId,
        matchedTitle: result.pending.title,
        episode: payload.episode,
      });
      void cached; // nothing rewatch-related on pending
      return pushResult;
    }

    if (!result.cached) {
      // Pas confirmé en discovery — silence, pas de re-prompt à 85 %.
      return { success: false, error: 'not_confirmed' };
    }

    const cached = await storage.getMatching(result.seriesKey);
    const isRewatch = cached?.isRewatch === true;

    const mediaId = entityId(result.cached.anime);
    if (!mediaId) {
      return { success: false, error: 'Cache corrompu (id manquant)' };
    }

    const pushResult = await pushProgress({
      mediaId,
      matchedTitle: pickDisplayTitle(result.cached.anime),
      episode: payload.episode,
      kind: payload.kind,
      isRewatch,
    });

    // Une fois le 1er push consommé, on retire le flag rewatch (les épisodes
    // suivants ne re-incrémentent pas rewatchCount).
    if (isRewatch && pushResult.success && cached) {
      await storage.setMatching(result.seriesKey, { ...cached, isRewatch: false });
    }

    return pushResult;
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

interface PushPendingProgressArgs {
  listEntryId: string;
  matchedTitle: string;
  episode?: number;
}

/**
 * Push direct sur une list entry « pending » (l'œuvre est proposée par l'user
 * mais pas encore validée par le staff, donc pas de `mediaId`). On met à jour
 * `episodesWatched` + `status: WATCHING` directement via le listEntryId.
 */
async function pushPendingProgress(
  args: PushPendingProgressArgs,
): Promise<TrackResultPayload> {
  const { listEntryId, matchedTitle, episode } = args;
  const sessionKey = `pending:${listEntryId}:${episode ?? 'x'}`;
  if (sessionPushed.has(sessionKey)) {
    return {
      success: true,
      actunimeEntityId: listEntryId,
      matchedTitle,
      episodesWatched: episode,
      isRewatch: false,
    };
  }

  try {
    // Snapshot de l'état avant push pour permettre l'annulation user.
    let previousEpisodesWatched: number | undefined;
    let previousStatus: ListEntry['status'] | undefined;
    try {
      const fresh = await api.getPendingListEntries();
      const current = fresh.find((e) => entityId(e) === listEntryId);
      previousEpisodesWatched = current?.episodesWatched;
      previousStatus = current?.status;
    } catch {
      // best-effort
    }

    const targetEpisodes = episode ?? (previousEpisodesWatched ?? 0) + 1;
    if (targetEpisodes <= (previousEpisodesWatched ?? 0)) {
      // Rien à pousser : on est déjà à un épisode ≥ target.
      return {
        success: true,
        actunimeEntityId: listEntryId,
        matchedTitle,
        episodesWatched: previousEpisodesWatched,
        isRewatch: false,
      };
    }

    await api.updateListEntry(listEntryId, {
      episodesWatched: targetEpisodes,
      status: 'WATCHING',
    });
    sessionPushed.add(sessionKey);

    return {
      success: true,
      actunimeEntityId: listEntryId,
      matchedTitle,
      episodesWatched: targetEpisodes,
      isRewatch: false,
      undo: {
        listEntryId,
        previousEpisodesWatched,
        previousStatus,
        wasCreated: false,
      },
    };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

interface PushProgressArgs {
  mediaId: string;
  matchedTitle?: string;
  episode?: number;
  kind: 'anime' | 'manga';
  isRewatch: boolean;
}

async function pushProgress(args: PushProgressArgs): Promise<TrackResultPayload> {
  const { mediaId, matchedTitle, episode, kind, isRewatch } = args;

  const sessionKey = `${mediaId}:${episode ?? 'x'}:${isRewatch ? 're' : 'first'}`;
  if (sessionPushed.has(sessionKey)) {
    return {
      success: true,
      actunimeEntityId: mediaId,
      matchedTitle,
      episodesWatched: episode,
      isRewatch,
    };
  }

  let existing: ListEntry | null = null;
  try {
    existing = await api.getListByMedia(mediaId);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }

  const targetEpisodes = episode ?? (existing?.episodesWatched ?? 0) + 1;
  let undo: UndoSnapshot | undefined;

  if (existing) {
    const existingId = entityId(existing);
    if (!existingId) throw new Error('List entry sans id');
    // Snapshot AVANT modification pour permettre l'annulation user.
    undo = {
      listEntryId: existingId,
      previousEpisodesWatched: existing.episodesWatched,
      previousStatus: existing.status,
      previousRewatchCount: existing.rewatchCount,
      wasCreated: false,
    };
    if (isRewatch) {
      await api.updateListEntry(existingId, {
        episodesWatched: targetEpisodes,
        status: 'WATCHING',
        rewatchCount: (existing.rewatchCount ?? 0) + 1,
      });
    } else if (targetEpisodes > (existing.episodesWatched ?? 0)) {
      await api.updateListEntry(existingId, {
        episodesWatched: targetEpisodes,
        status: 'WATCHING',
      });
    } else {
      // Pas de modif (target ≤ existant), pas besoin d'undo non plus.
      undo = undefined;
    }
  } else {
    const created = await api.createListEntry({
      mediaId,
      mediaType: kind === 'anime' ? 'Anime' : 'Manga',
      status: 'WATCHING',
      episodesWatched: targetEpisodes,
    });
    const createdId = entityId(created);
    if (createdId) {
      undo = {
        listEntryId: createdId,
        wasCreated: true,
      };
    }
  }

  sessionPushed.add(sessionKey);

  return {
    success: true,
    actunimeEntityId: mediaId,
    matchedTitle,
    episodesWatched: targetEpisodes,
    isRewatch,
    undo,
  };
}

/**
 * Annule le dernier push selon le snapshot capturé. Si l'entry avait été
 * créée par le push (`wasCreated`), on la supprime. Sinon on revert
 * `episodesWatched` / `status` / `rewatchCount` à leurs valeurs précédentes.
 */
export async function handleUndoLastPush(
  snapshot: UndoSnapshot,
): Promise<UndoLastPushResultPayload> {
  try {
    if (snapshot.wasCreated) {
      await api.deleteListEntry(snapshot.listEntryId);
      sessionPushed.clear();
      return { ok: true };
    }
    // Construction défensive du patch : on n'envoie que les champs qu'on
    // veut explicitement revert. Les undefined sont remplacés par 0 (revert
    // à l'état initial) car JSON.stringify les omet, ce qui laisserait
    // Mongoose conserver la valeur post-push (= pas un revert réel). L'API
    // valide via Zod `.partial().strict()` donc un patch vide = 400.
    const patch: {
      episodesWatched?: number;
      status?: ListEntry['status'];
      rewatchCount?: number;
    } = {
      episodesWatched: snapshot.previousEpisodesWatched ?? 0,
      rewatchCount: snapshot.previousRewatchCount ?? 0,
    };
    if (snapshot.previousStatus) patch.status = snapshot.previousStatus;
    await api.updateListEntry(snapshot.listEntryId, patch);
    sessionPushed.clear();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/**
 * Pour chaque candidat, récupère son éventuelle entrée existante dans la liste
 * de l'user (status, episodesWatched, rewatchCount). Permet à l'UI de cocher
 * « rewatch » par défaut si l'anime est déjà COMPLETED.
 */
async function enrichCandidates(scored: ScoredAnime[]): Promise<CandidateAnime[]> {
  return Promise.all(
    scored.map(async (s) => {
      const a = s.anime;
      const animeId = entityId(a);
      const start = a.date?.start;
      const year =
        start instanceof Date
          ? start.getFullYear()
          : typeof start === 'string'
            ? new Date(start).getFullYear() || null
            : null;

      let existing: ListEntry | null = null;
      if (animeId) {
        try {
          existing = await api.getListByMedia(animeId);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) {
            // erreur autre : on perd juste l'enrichissement
          }
        }
      }

      const existingId = entityId(existing);

      return {
        id: animeId ?? '',
        title: pickDisplayTitle(a) ?? '',
        alias: a.title?.alias,
        coverUrl: a.posterUrl ?? a.cover?.url ?? null,
        year: Number.isFinite(year) ? year : null,
        score: s.score,
        existingListEntry:
          existing && existingId
            ? {
                id: existingId,
                status: existing.status,
                episodesWatched: existing.episodesWatched,
                rewatchCount: existing.rewatchCount,
              }
            : null,
      };
    }),
  );
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === API_NETWORK_ERROR_STATUS) {
      return 'Serveur Actunime indisponible. Vérifie ta connexion ou réessaie dans quelques instants.';
    }
    if (err.status >= 500) {
      return `Erreur serveur Actunime (HTTP ${err.status}). Réessaie plus tard.`;
    }
    if (err.status === 401) {
      return 'Session expirée. Reconnecte-toi via le popup.';
    }
    if (err.status === 403) {
      return 'Action refusée par le serveur.';
    }
    if (err.status === 404) {
      return 'Ressource introuvable côté Actunime.';
    }
    return `${err.status} ${err.message}`;
  }
  return (err as Error)?.message ?? 'Erreur inconnue';
}
