import { api, entityId, type SearchMedia } from "@/shared/api-client";
import { storage, type MatchingEntry } from "@/shared/storage";

export type MediaKind = "anime" | "manga";
export type MediaType = "Anime" | "Manga";

export interface ScoredMedia {
  media: SearchMedia;
  score: number;
  seasonBoost?: number;
}

export interface PendingMatch {
  listEntryId: string;
  mediaType: MediaType;
  title: string;
  coverUrl?: string | null;
  status?: string;
  episodesWatched?: number;
  chaptersRead?: number;
  supportCount?: number;
}

export interface CachedMatch {
  mediaId: string;
  mediaType: MediaType;
  title: string;
  coverUrl?: string | null;
  isRewatch?: boolean;
}

export interface MatchTitleResult {
  cached?: CachedMatch;
  pending?: PendingMatch;
  candidates: ScoredMedia[];
  seriesKey: string;
  kind: MediaKind;
}

const TOP_N = 3;
const SEASON_BOOST = 0.2;

export function buildSeriesKey(params: {
  siteId: string;
  seriesId?: string;
  seriesSlug?: string;
  slug?: string;
  title?: string;
}): string {
  const id =
    params.seriesId ??
    params.seriesSlug ??
    params.slug ??
    params.title ??
    "unknown";
  return `${params.siteId}:${id}`;
}

export function kindToMediaType(kind: MediaKind): MediaType {
  return kind === "manga" ? "Manga" : "Anime";
}

function resolveFromCache(entry: MatchingEntry | null): {
  cached?: CachedMatch;
  pending?: PendingMatch;
} {
  if (!entry || !entry.title) return {};
  if (entry.kind === "pending") {
    return {
      pending: {
        listEntryId: entry.listEntryId,
        mediaType: entry.mediaType,
        title: entry.title,
        coverUrl: entry.coverUrl ?? null,
      },
    };
  }
  if (entry.kind === "media") {
    return {
      cached: {
        mediaId: entry.mediaId,
        mediaType: entry.mediaType,
        title: entry.title,
        coverUrl: entry.coverUrl ?? null,
        isRewatch: entry.isRewatch,
      },
    };
  }
  return {};
}

async function resolvePendingByTitle(
  detectedTitle: string,
  kind: MediaKind,
): Promise<PendingMatch | undefined> {
  const mediaType = kindToMediaType(kind);
  try {
    const pending = await api.getPendingListEntries();
    const detected = cleanTitle(detectedTitle).toLowerCase();
    const hit = pending.find((e) => {
      if (e.mediaType !== mediaType) return false;
      if (!e.preview?.title) return false;
      return fuzzyTitleMatch(detected, e.preview.title);
    });
    if (!hit?.preview) return undefined;
    const id = entityId(hit);
    if (!id) return undefined;
    return {
      listEntryId: id,
      mediaType,
      title: hit.preview.title,
      coverUrl: hit.preview.coverImage ?? null,
      status: hit.status,
      episodesWatched: hit.episodesWatched,
      chaptersRead: hit.chaptersRead,
      supportCount: hit.proposal?.supportCount,
    };
  } catch {
    return undefined;
  }
}

async function searchAndScore(
  cleaned: string,
  kind: MediaKind,
  season?: number,
): Promise<ScoredMedia[]> {
  if (cleaned.length < 2) return [];
  const [items, pendingProposals] = await Promise.all([
    api.searchByKind(kind, cleaned, 10).catch(() => [] as SearchMedia[]),
    api.searchPendingProposals(kind, cleaned, 5).catch(() => []),
  ]);

  const proposalCandidates: SearchMedia[] = pendingProposals
    .map((p) => {
      const id = p.id ?? p._id;
      const dep = p.mainDependency;
      if (!id || !dep?.title?.original) return null;
      return {
        id,
        title: {
          original: dep.title.original,
          normal: dep.title.original,
          alias: dep.title.alias,
        },
        posterUrl: dep.poster?.url ?? dep.poster?.file ?? null,
      } as SearchMedia;
    })
    .filter(Boolean) as SearchMedia[];

  const all = [...items, ...proposalCandidates];
  if (all.length === 0) return [];

  return all
    .map((media) => scoreCandidate(cleaned, media, season))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

export async function matchTitle(params: {
  siteId: string;
  slug?: string;
  title: string;
  season?: number;
  seriesId?: string;
  seriesSlug?: string;
  kind?: MediaKind;
}): Promise<MatchTitleResult> {
  const seriesKey = buildSeriesKey(params);
  const kind: MediaKind = params.kind ?? "anime";

  const cacheEntry = await storage.getMatching(seriesKey);
  const fromCache = resolveFromCache(cacheEntry);
  if (fromCache.pending || fromCache.cached) {
    return { ...fromCache, candidates: [], seriesKey, kind };
  }

  const pending = await resolvePendingByTitle(params.title, kind);
  if (pending) {
    return { pending, candidates: [], seriesKey, kind };
  }

  const cleaned = cleanTitle(params.title);
  const candidates = await searchAndScore(cleaned, kind, params.season);
  return { candidates, seriesKey, kind };
}

export function pickDisplayTitle(media: SearchMedia): string | undefined {
  return (
    media.title?.normal ?? media.title?.original ?? media.title?.alias?.[0]
  );
}

function fuzzyTitleMatch(detected: string, candidate: string): boolean {
  const d = detected.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!d || !c) return false;
  if (d === c) return true;
  if (c.includes(d) && d.length >= 4) return true;
  if (d.includes(c) && c.length >= 4) return true;
  return similarity(d, c) >= 0.85;
}

function cleanTitle(title: string): string {
  return title
    .replace(
      /\s*-?\s*(?:episode|ep|épisode|ep\.|chapter|chapitre|chap|ch|ch\.)\s*\d.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(
  query: string,
  media: SearchMedia,
  season?: number,
): ScoredMedia {
  const titles = [
    media.title?.original,
    media.title?.normal,
    ...(media.title?.alias ?? []),
  ].filter(Boolean) as string[];
  if (titles.length === 0) return { media, score: 0 };

  const baseScore = Math.max(...titles.map((c) => similarity(query, c)));
  const boost = season !== undefined ? seasonMatchBoost(titles, season) : 0;

  return {
    media,
    score: Math.min(1, baseScore + boost),
    seasonBoost: boost || undefined,
  };
}

function seasonMatchBoost(titles: string[], season: number): number {
  const explicit = new RegExp(
    `\\b(?:season|saison|s)\\s*${season}\\b|\\b${season}(?:nd|rd|th|st)?\\s+season\\b|\\s${season}$`,
    "i",
  );
  const hasAnySeasonHint = (t: string) =>
    /\b(?:season|saison)\s*\d+\b|\bs\d+\b|\s\d+$/i.test(t);

  if (season === 1) {
    return titles.some((t) => !hasAnySeasonHint(t)) ? SEASON_BOOST : 0;
  }
  return titles.some((t) => explicit.test(t)) ? SEASON_BOOST : 0;
}

function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  if (max === 0) return 0;
  return 1 - levenshtein(x, y) / max;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}
