import { cleanScrapedTitle } from './title-cleanup';

export interface GenericDetection {
  confidence: number;
  title?: string;
  seriesTitle?: string;
  episode?: number;
  chapter?: number;
  season?: number;
  imageUrl?: string;
  kind: 'anime' | 'manga';
}

const SCORE_THRESHOLD = 3;

const URL_TOKENS_VIDEO =
  /\/(?:watch|episode|play|stream|video|series|show|anime|ep[-_]?\d+|s\d{1,2}e\d{1,3})(?:\/|$|\?)/i;

const URL_TOKENS_MANGA =
  /\/(?:read|reader|chapter|chapitre|scan|scans|lecture|manga|webtoon|ch[-_]?\d+)(?:\/|$|\?)/i;

interface JsonLdResult {
  title?: string;
  seriesTitle?: string;
  episode?: number;
  chapter?: number;
  season?: number;
  imageUrl?: string;
  kindHint?: 'anime' | 'manga';
  matched: boolean;
}

export function inferKind(): 'anime' | 'manga' {
  const ld = parseJsonLd();
  if (ld.kindHint) return ld.kindHint;

  const ogType = readMeta('og:type');
  if (ogType === 'book' || ogType === 'article' || ogType === 'manga') return 'manga';
  if (ogType?.startsWith('video.')) return 'anime';

  if (URL_TOKENS_MANGA.test(location.pathname)) return 'manga';
  if (URL_TOKENS_VIDEO.test(location.pathname)) return 'anime';

  if (document.querySelectorAll('video').length > 0) return 'anime';

  if (looksLikeMangaReader()) return 'manga';

  return 'anime';
}

export function detectGenericFromDom(): GenericDetection | null {
  const ld = parseJsonLd();
  const ogType = readMeta('og:type');
  const ogTitle = readMeta('og:title');
  const ogImage = readMeta('og:image');

  const animeScore = scoreAnime(ld, ogType);
  const mangaScore = scoreManga(ld, ogType);
  const kind: 'anime' | 'manga' = mangaScore > animeScore ? 'manga' : 'anime';
  const score = Math.max(animeScore, mangaScore);

  const hasValidVideo = document.querySelectorAll('video').length > 0;
  const hasCrossOriginIframe = hasCrossOriginPlayerIframe();
  const isMangaReader = looksLikeMangaReader();

  if (kind === 'anime' && !hasValidVideo && !hasCrossOriginIframe) return null;
  if (kind === 'manga' && !isMangaReader && !URL_TOKENS_MANGA.test(location.pathname) && !ld.matched) {
    return null;
  }

  if (score < SCORE_THRESHOLD) return null;

  let title = ld.title;
  let seriesTitle = ld.seriesTitle;
  if (!title && ogTitle) title = ogTitle;
  if (!title) title = document.title || undefined;
  if (!title) return null;

  const cleanedTitle = cleanScrapedTitle(title);
  const cleanedSeries = seriesTitle ? cleanScrapedTitle(seriesTitle) : undefined;

  return {
    confidence: score,
    title: cleanedSeries ?? cleanedTitle,
    seriesTitle: cleanedSeries,
    episode: kind === 'anime' ? ld.episode : undefined,
    chapter: kind === 'manga' ? ld.chapter ?? ld.episode : undefined,
    season: ld.season,
    imageUrl: ld.imageUrl ?? ogImage,
    kind,
  };
}

function scoreAnime(ld: JsonLdResult, ogType?: string): number {
  let s = 0;
  if (ld.matched && ld.kindHint !== 'manga') s += 5;
  if (ogType?.startsWith('video.')) s += 3;
  if (URL_TOKENS_VIDEO.test(location.pathname)) s += 2;
  if (document.querySelectorAll('video').length > 0) s += 2;
  if (hasCrossOriginPlayerIframe()) s += 2;
  return s;
}

function scoreManga(ld: JsonLdResult, ogType?: string): number {
  let s = 0;
  if (ld.matched && ld.kindHint === 'manga') s += 5;
  if (ogType === 'book' || ogType === 'article' || ogType === 'manga') s += 3;
  if (URL_TOKENS_MANGA.test(location.pathname)) s += 3;
  if (looksLikeMangaReader()) s += 2;
  return s;
}

function looksLikeMangaReader(): boolean {
  const imgs = document.querySelectorAll<HTMLImageElement>('img');
  let largeCount = 0;
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    if (rect.width >= 400 && rect.height >= 400) largeCount++;
    if (largeCount >= 3) return true;
  }
  return false;
}

function hasCrossOriginPlayerIframe(): boolean {
  const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[src]');
  for (const f of iframes) {
    try {
      const u = new URL(f.src, location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      if (u.hostname === location.hostname) continue;
      const rect = f.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) continue;
      return true;
    } catch {
      // src invalide
    }
  }
  return false;
}

function readMeta(property: string): string | undefined {
  const el =
    document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ??
    document.querySelector<HTMLMetaElement>(`meta[name="${property}"]`);
  return el?.content?.trim() || undefined;
}

function parseJsonLd(): JsonLdResult {
  const result: JsonLdResult = { matched: false };
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  for (const s of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s.textContent ?? '');
    } catch {
      continue;
    }
    const items = flattenLd(parsed);
    for (const item of items) {
      const matched = matchMediaLd(item, result);
      if (matched) result.matched = true;
      if (result.title && (result.episode !== undefined || result.chapter !== undefined)) break;
    }
    if (result.matched) break;
  }
  return result;
}

function flattenLd(parsed: unknown): Record<string, unknown>[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(flattenLd);
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return flattenLd(obj['@graph']);
    return [obj];
  }
  return [];
}

const ANIME_TYPES = ['TVEpisode', 'Episode', 'Movie', 'VideoObject', 'AnimeEpisode', 'AnimeSeries'];
const MANGA_TYPES = ['ComicSeries', 'ComicIssue', 'ComicStory', 'Book', 'Article', 'BookSeries'];

function matchMediaLd(item: Record<string, unknown>, into: JsonLdResult): boolean {
  const types = normalizeTypes(item['@type']);
  if (types.length === 0) return false;
  const isAnime = types.some((t) => ANIME_TYPES.includes(t));
  const isManga = types.some((t) => MANGA_TYPES.includes(t));
  if (!isAnime && !isManga) return false;

  if (isManga && !into.kindHint) into.kindHint = 'manga';
  else if (isAnime && !into.kindHint) into.kindHint = 'anime';

  const partOfSeries = item['partOfSeries'] as Record<string, unknown> | undefined;
  const partOfSeason = item['partOfSeason'] as Record<string, unknown> | undefined;

  const seriesName = typeof partOfSeries?.name === 'string' ? partOfSeries.name : undefined;
  const itemName = typeof item.name === 'string' ? item.name : undefined;

  if (seriesName && !into.seriesTitle) into.seriesTitle = seriesName;
  if (itemName && !into.title) into.title = itemName;

  const epNum = item.episodeNumber;
  if (typeof epNum === 'number' && Number.isFinite(epNum) && into.episode === undefined) {
    into.episode = epNum;
  } else if (typeof epNum === 'string' && /^\d+$/.test(epNum) && into.episode === undefined) {
    into.episode = Number(epNum);
  }

  const issueNum = item.issueNumber ?? item.chapterNumber ?? item.position;
  if (typeof issueNum === 'number' && Number.isFinite(issueNum) && into.chapter === undefined) {
    into.chapter = Math.floor(issueNum);
  } else if (
    typeof issueNum === 'string' &&
    /^\d+(?:\.\d+)?$/.test(issueNum) &&
    into.chapter === undefined
  ) {
    into.chapter = Math.floor(Number(issueNum));
  }

  const seasonNum = partOfSeason?.seasonNumber;
  if (typeof seasonNum === 'number' && Number.isFinite(seasonNum) && into.season === undefined) {
    into.season = seasonNum;
  } else if (typeof seasonNum === 'string' && /^\d+$/.test(seasonNum) && into.season === undefined) {
    into.season = Number(seasonNum);
  }

  const image = item.image;
  if (typeof image === 'string' && !into.imageUrl) {
    into.imageUrl = image;
  } else if (Array.isArray(image) && typeof image[0] === 'string' && !into.imageUrl) {
    into.imageUrl = image[0];
  } else if (image && typeof image === 'object' && 'url' in image && !into.imageUrl) {
    const url = (image as { url?: unknown }).url;
    if (typeof url === 'string') into.imageUrl = url;
  }

  return true;
}

function normalizeTypes(t: unknown): string[] {
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}
