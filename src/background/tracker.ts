import {
  api,
  ApiError,
  API_NETWORK_ERROR_STATUS,
  entityId,
  type ListEntry,
  type SearchMedia,
} from '@/shared/api-client';
import type {
  CandidateMedia,
  ConfirmResultPayload,
  ConfirmTrackPayload,
  DiscoveryResultPayload,
  ProgressUpdatePayload,
  ResearchResultPayload,
  TrackResultPayload,
  UndoLastPushResultPayload,
  UndoSnapshot,
} from '@/shared/messaging';
import { storage, type MatchingEntry } from '@/shared/storage';
import {
  matchTitle,
  pickDisplayTitle,
  kindToMediaType,
  type MediaKind,
  type MediaType,
  type ScoredMedia,
} from './matcher';

const sessionPushed = new Set<string>();

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
      kind: payload.kind,
    });

    if (await storage.isSeriesIgnored(result.seriesKey)) {
      return { state: 'ignored' };
    }

    if (result.pending) {
      await storage.setMatching(result.seriesKey, {
        kind: 'pending',
        listEntryId: result.pending.listEntryId,
        mediaType: result.pending.mediaType,
        title: result.pending.title,
        coverUrl: result.pending.coverUrl ?? null,
        confirmedAt: Date.now(),
      });

      let pendingEntry: ListEntry | null = null;
      try {
        const all = await api.getPendingListEntries();
        pendingEntry = all.find((e) => entityId(e) === result.pending!.listEntryId) ?? null;
      } catch {
        // best-effort
      }

      const status = pendingEntry?.status ?? result.pending.status;
      const episodesWatched = pendingEntry?.episodesWatched ?? result.pending.episodesWatched;
      const chaptersRead = pendingEntry?.chaptersRead ?? result.pending.chaptersRead;

      return {
        state: 'cached',
        seriesKey: result.seriesKey,
        matchedTitle: result.pending.title,
        coverUrl: result.pending.coverUrl ?? null,
        existingListEntry: status
          ? {
              status,
              episodesWatched,
              chaptersRead,
            }
          : null,
      };
    }

    if (result.cached) {
      let existing: ListEntry | null = null;
      try {
        existing = await api.getListByMedia(result.cached.mediaId);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          console.warn('[Actunime] getListByMedia échoué:', err);
        }
      }

      return {
        state: 'cached',
        seriesKey: result.seriesKey,
        matchedTitle: result.cached.title,
        coverUrl: result.cached.coverUrl ?? null,
        existingListEntry: existing
          ? {
              status: existing.status,
              episodesWatched: existing.episodesWatched,
              chaptersRead: existing.chaptersRead,
              rewatchCount: existing.rewatchCount,
            }
          : null,
      };
    }

    const candidates =
      result.candidates.length > 0 ? await enrichCandidates(result.candidates, result.kind) : [];
    return {
      state: 'needs_confirmation',
      seriesKey: result.seriesKey,
      candidates,
      detection: {
        title: payload.title,
        episode: payload.episode,
        chapter: payload.chapter,
        season: payload.season,
      },
    };
  } catch (err) {
    console.error(err);
    return { state: 'error', error: formatError(err) };
  }
}

export async function handleResearch(
  query: string,
  kind: MediaKind = 'anime',
): Promise<ResearchResultPayload> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return { candidates: [], error: 'Requête trop courte' };
  try {
    const [items, pendingProposals] = await Promise.all([
      api.searchByKind(kind, cleaned, 10).catch(() => [] as SearchMedia[]),
      api.searchPendingProposals(kind, cleaned, 5).catch(() => []),
    ]);
    const scored: ScoredMedia[] = items.map((media: SearchMedia) => ({
      media,
      score: 1,
    }));
    const validated = await enrichCandidates(scored, kind);

    const mediaType = kindToMediaType(kind);
    const pendingCandidates: CandidateMedia[] = [];
    for (const p of pendingProposals) {
      const id = p.id ?? p._id;
      const dep = p.mainDependency;
      const title = dep?.title?.original;
      if (!id || !title) continue;
      pendingCandidates.push({
        id,
        mediaType,
        title,
        alias: dep.title?.alias,
        coverUrl: dep.poster?.url ?? dep.poster?.file ?? null,
        year: null,
        score: 1,
        isPending: true,
        proposalId: id,
        supportCount: p.supportCount,
        existingListEntry: null,
      });
    }

    const candidates = [...validated, ...pendingCandidates];
    if (candidates.length === 0) return { candidates: [], empty: true };
    return { candidates };
  } catch (err) {
    return { candidates: [], error: formatError(err) };
  }
}

export async function handleConfirm(
  payload: ConfirmTrackPayload,
  _context: { lastDetection?: ProgressUpdatePayload },
): Promise<ConfirmResultPayload> {
  if (payload.action === 'skip') return { state: 'skipped' };

  if (payload.action === 'ignore_series') {
    await storage.ignoreSeries(payload.seriesKey);
    return { state: 'ignored' };
  }

  try {
    const kind: MediaKind = payload.kind ?? 'anime';
    const mediaType = kindToMediaType(kind);

    if (payload.proposalId) {
      const defaultStatus = kind === 'manga' ? 'READING' : 'WATCHING';
      const entry = await api.createListEntryFromProposal({
        proposalId: payload.proposalId,
        mediaType,
        status: defaultStatus,
        preview: {
          title: payload.chosenTitle,
          coverImage: payload.chosenCoverUrl ?? undefined,
        },
      });
      const listEntryId = entityId(entry) ?? '';
      await storage.setMatching(payload.seriesKey, {
        kind: 'pending',
        listEntryId,
        mediaType,
        title: payload.chosenTitle,
        coverUrl: payload.chosenCoverUrl,
        confirmedAt: Date.now(),
      });
      return {
        state: 'cached',
        seriesKey: payload.seriesKey,
        matchedTitle: payload.chosenTitle,
        coverUrl: payload.chosenCoverUrl,
        existingListEntry: entry
          ? {
              status: entry.status,
              episodesWatched: entry.episodesWatched,
              chaptersRead: entry.chaptersRead,
              rewatchCount: entry.rewatchCount,
            }
          : null,
      };
    }

    await storage.setMatching(payload.seriesKey, {
      kind: 'media',
      mediaId: payload.chosenMediaId,
      mediaType,
      title: payload.chosenTitle,
      coverUrl: payload.chosenCoverUrl,
      confirmedAt: Date.now(),
      isRewatch: payload.isRewatch,
    });

    let existingListEntry: ListEntry | null = null;
    try {
      existingListEntry = await api.getListByMedia(payload.chosenMediaId);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        console.warn('[Actunime] getListByMedia post-confirm échoué:', err);
      }
    }

    return {
      state: 'cached',
      seriesKey: payload.seriesKey,
      matchedTitle: payload.chosenTitle,
      coverUrl: payload.chosenCoverUrl,
      existingListEntry: existingListEntry
        ? {
            status: existingListEntry.status,
            episodesWatched: existingListEntry.episodesWatched,
            chaptersRead: existingListEntry.chaptersRead,
            rewatchCount: existingListEntry.rewatchCount,
          }
        : null,
    };
  } catch (err) {
    return { state: 'error', error: formatError(err) };
  }
}

export async function handleProgressUpdate(
  payload: ProgressUpdatePayload,
): Promise<TrackResultPayload> {
  try {
    const seriesKey = `${payload.siteId}:${payload.seriesId ?? payload.seriesSlug ?? payload.slug ?? payload.title ?? 'unknown'}`;

    if (await storage.isSeriesIgnored(seriesKey)) {
      return { success: false, ignored: true };
    }

    const entry = await storage.getMatching(seriesKey);
    if (!entry) {
      return { success: false, error: 'not_confirmed' };
    }

    if (entry.kind === 'pending') {
      return pushPendingProgress({
        listEntryId: entry.listEntryId,
        mediaType: entry.mediaType,
        matchedTitle: entry.title,
        seriesKey,
        episode: payload.episode,
        chapter: payload.chapter,
      });
    }

    const result = await pushMediaProgress({
      mediaId: entry.mediaId,
      mediaType: entry.mediaType,
      matchedTitle: entry.title,
      episode: payload.episode,
      chapter: payload.chapter,
      isRewatch: entry.isRewatch === true,
    });

    if (entry.isRewatch && result.success) {
      await storage.setMatching(seriesKey, { ...entry, isRewatch: false });
    }

    return result;
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

interface PushPendingArgs {
  listEntryId: string;
  mediaType: MediaType;
  matchedTitle: string;
  episode?: number;
  chapter?: number;
  seriesKey: string;
}

async function pushPendingProgress(args: PushPendingArgs): Promise<TrackResultPayload> {
  const { listEntryId, mediaType, matchedTitle, episode, chapter, seriesKey } = args;
  const isManga = mediaType === 'Manga';
  const target = isManga ? chapter : episode;
  const sessionKey = `pending:${listEntryId}:${target ?? 'x'}`;

  if (sessionPushed.has(sessionKey)) {
    return {
      success: true,
      actunimeEntityId: listEntryId,
      matchedTitle,
      episodesWatched: !isManga ? target : undefined,
      chaptersRead: isManga ? target : undefined,
      isRewatch: false,
    };
  }

  try {
    let previousCount: number | undefined;
    let previousStatus: ListEntry['status'] | undefined;
    try {
      const fresh = await api.getPendingListEntries();
      const current = fresh.find((e) => entityId(e) === listEntryId);
      previousCount = isManga ? current?.chaptersRead : current?.episodesWatched;
      previousStatus = current?.status;
    } catch {
      // best-effort
    }

    const targetCount = target ?? (previousCount ?? 0) + 1;
    const kind: MediaKind = isManga ? 'manga' : 'anime';

    if (targetCount < (previousCount ?? 0)) {
      return {
        success: true,
        actunimeEntityId: listEntryId,
        matchedTitle,
        behind: {
          listCount: previousCount ?? 0,
          currentNumber: targetCount,
          seriesKey,
          listEntryId,
          kind,
        },
      };
    }
    if (targetCount === (previousCount ?? 0)) {
      return {
        success: true,
        actunimeEntityId: listEntryId,
        matchedTitle,
        episodesWatched: !isManga ? previousCount : undefined,
        chaptersRead: isManga ? previousCount : undefined,
        isRewatch: false,
      };
    }

    const activeStatus = isManga ? 'READING' : 'WATCHING';
    await api.updateListEntry(listEntryId, {
      ...(isManga ? { chaptersRead: targetCount } : { episodesWatched: targetCount }),
      status: activeStatus,
    });
    sessionPushed.add(sessionKey);

    return {
      success: true,
      actunimeEntityId: listEntryId,
      matchedTitle,
      episodesWatched: !isManga ? targetCount : undefined,
      chaptersRead: isManga ? targetCount : undefined,
      isRewatch: false,
      undo: {
        listEntryId,
        previousEpisodesWatched: !isManga ? previousCount : undefined,
        previousChaptersRead: isManga ? previousCount : undefined,
        previousStatus,
        wasCreated: false,
      },
    };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

interface PushMediaArgs {
  mediaId: string;
  mediaType: MediaType;
  matchedTitle?: string;
  episode?: number;
  chapter?: number;
  isRewatch: boolean;
}

async function pushMediaProgress(args: PushMediaArgs): Promise<TrackResultPayload> {
  const { mediaId, mediaType, matchedTitle, episode, chapter, isRewatch } = args;
  const isManga = mediaType === 'Manga';
  const target = isManga ? chapter : episode;
  const activeStatus = isManga ? 'READING' : 'WATCHING';

  const sessionKey = `${mediaId}:${target ?? 'x'}:${isRewatch ? 're' : 'first'}`;
  if (sessionPushed.has(sessionKey)) {
    return {
      success: true,
      actunimeEntityId: mediaId,
      matchedTitle,
      episodesWatched: !isManga ? target : undefined,
      chaptersRead: isManga ? target : undefined,
      isRewatch,
    };
  }

  let existing: ListEntry | null = null;
  try {
    existing = await api.getListByMedia(mediaId);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }

  const previousCount = isManga ? existing?.chaptersRead : existing?.episodesWatched;
  const targetCount = target ?? (previousCount ?? 0) + 1;
  let undo: UndoSnapshot | undefined;

  if (existing) {
    const existingId = entityId(existing);
    if (!existingId) throw new Error('List entry sans id');
    undo = {
      listEntryId: existingId,
      previousEpisodesWatched: !isManga ? existing.episodesWatched : undefined,
      previousChaptersRead: isManga ? existing.chaptersRead : undefined,
      previousStatus: existing.status,
      previousRewatchCount: !isManga ? existing.rewatchCount : undefined,
      wasCreated: false,
    };
    const countPatch = isManga ? { chaptersRead: targetCount } : { episodesWatched: targetCount };
    if (isRewatch && !isManga) {
      await api.updateListEntry(existingId, {
        ...countPatch,
        status: activeStatus,
        rewatchCount: (existing.rewatchCount ?? 0) + 1,
      });
    } else if (targetCount > (previousCount ?? 0)) {
      await api.updateListEntry(existingId, {
        ...countPatch,
        status: activeStatus,
      });
    } else {
      undo = undefined;
    }
  } else {
    const created = await api.createListEntry({
      mediaId,
      mediaType,
      status: activeStatus,
      ...(isManga ? { chaptersRead: targetCount } : { episodesWatched: targetCount }),
    });
    const createdId = entityId(created);
    if (createdId) {
      undo = { listEntryId: createdId, wasCreated: true };
    }
  }

  sessionPushed.add(sessionKey);

  return {
    success: true,
    actunimeEntityId: mediaId,
    matchedTitle,
    episodesWatched: !isManga ? targetCount : undefined,
    chaptersRead: isManga ? targetCount : undefined,
    isRewatch,
    undo,
  };
}

export async function handleUndoLastPush(
  snapshot: UndoSnapshot,
): Promise<UndoLastPushResultPayload> {
  try {
    if (snapshot.wasCreated) {
      await api.deleteListEntry(snapshot.listEntryId);
      sessionPushed.clear();
      return { ok: true };
    }
    const isManga = snapshot.previousChaptersRead !== undefined;
    const patch: {
      episodesWatched?: number;
      chaptersRead?: number;
      status?: ListEntry['status'];
      rewatchCount?: number;
    } = isManga
      ? { chaptersRead: snapshot.previousChaptersRead ?? 0 }
      : {
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

export async function enrichCandidates(
  scored: ScoredMedia[],
  kind: MediaKind,
): Promise<CandidateMedia[]> {
  const mediaType = kindToMediaType(kind);
  return Promise.all(
    scored.map(async (s) => {
      const m = s.media;
      const mediaId = entityId(m);
      const start = m.date?.start;
      const year =
        start instanceof Date
          ? start.getFullYear()
          : typeof start === 'string'
            ? new Date(start).getFullYear() || null
            : null;

      let existing: ListEntry | null = null;
      if (mediaId) {
        try {
          existing = await api.getListByMedia(mediaId);
        } catch {
          // best-effort
        }
      }

      const existingId = entityId(existing);

      return {
        id: mediaId ?? '',
        mediaType,
        title: pickDisplayTitle(m) ?? '',
        alias: m.title?.alias,
        coverUrl: m.posterUrl ?? m.cover?.url ?? null,
        year: Number.isFinite(year) ? year : null,
        score: s.score,
        existingListEntry:
          existing && existingId
            ? {
                id: existingId,
                status: existing.status,
                episodesWatched: existing.episodesWatched,
                chaptersRead: existing.chaptersRead,
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

export type { MatchingEntry };
