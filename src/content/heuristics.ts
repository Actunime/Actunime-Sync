/**
 * Détection générique « Couche 1 » : reconnait une page de visionnage anime/movie
 * sans pattern dédié, en lisant les signaux standardisés du DOM.
 *
 * Sources, par ordre de fiabilité :
 *  1. JSON-LD (`<script type="application/ld+json">`) avec `@type` ∈
 *     {`TVEpisode`, `Episode`, `Movie`, `VideoObject`} — fournit titre,
 *     numéro d'épisode, saison, série, image
 *  2. OpenGraph meta (`og:type`, `og:title`, `og:image`)
 *  3. Tokens dans l'URL (`/watch/`, `/episode/`, `/play/`, etc.)
 *  4. Présence d'un `<video>` non trivial (durée > 60 s)
 *
 * Score composite. Threshold à 4 = succès. Avec ce score on évite les faux
 * positifs sur des pages de présentation, tout en couvrant la plupart des
 * sites de streaming « bien faits » (qui mettent du JSON-LD ou de l'OpenGraph).
 */

import { cleanScrapedTitle } from './title-cleanup';

export interface GenericDetection {
  confidence: number;
  title?: string;
  /** Nom de la série (différent du titre d'épisode si fourni). */
  seriesTitle?: string;
  episode?: number;
  season?: number;
  /** URL d'image récupérée (`og:image` ou ld+json `image`). */
  imageUrl?: string;
  /** Indication détectée du type de contenu. */
  kind: 'anime' | 'manga';
}

const SCORE_THRESHOLD = 3;

const URL_TOKENS_VIDEO =
  /\/(?:watch|episode|play|stream|video|series|show|anime|ep[-_]?\d+|s\d{1,2}e\d{1,3})(?:\/|$|\?)/i;

interface JsonLdResult {
  title?: string;
  seriesTitle?: string;
  episode?: number;
  season?: number;
  imageUrl?: string;
  matched: boolean;
}

/**
 * Inspecte la page courante. Retourne `null` si le score est trop bas pour
 * affirmer qu'on est sur une page de visionnage.
 */
export function detectGenericFromDom(): GenericDetection | null {
  let score = 0;
  let title: string | undefined;
  let seriesTitle: string | undefined;
  let episode: number | undefined;
  let season: number | undefined;
  let imageUrl: string | undefined;

  // 1. JSON-LD (fort)
  const ld = parseJsonLd();
  if (ld.matched) {
    score += 5;
    if (ld.title) title = ld.title;
    if (ld.seriesTitle) seriesTitle = ld.seriesTitle;
    if (ld.episode !== undefined) episode = ld.episode;
    if (ld.season !== undefined) season = ld.season;
    if (ld.imageUrl) imageUrl = ld.imageUrl;
  }

  // 2. OpenGraph (moyen)
  const ogType = readMeta('og:type');
  const isOgVideo =
    ogType === 'video.episode' ||
    ogType === 'video.tv_show' ||
    ogType === 'video.movie' ||
    ogType === 'video.other';
  if (isOgVideo) score += 3;

  const ogTitle = readMeta('og:title');
  if (ogTitle && !title) {
    title = ogTitle;
    score += 1;
  }
  const ogImage = readMeta('og:image');
  if (ogImage && !imageUrl) imageUrl = ogImage;

  // 3. URL token
  if (URL_TOKENS_VIDEO.test(location.pathname)) score += 2;

  // 4. <video> direct OU iframe player cross-origin
  const hasValidVideo = document.querySelectorAll('video').length > 0;
  if (hasValidVideo) score += 2;

  const hasCrossOriginIframe = hasCrossOriginPlayerIframe();
  if (hasCrossOriginIframe) score += 2;

  // Garde-fou : ni <video> ni iframe player = ce n'est pas une page de
  // visionnage. On rejette même avec un score élevé sur d'autres signaux
  // (ex. og:type pourrait être video.tv_show sur une fiche IMDb sans player).
  if (!hasValidVideo && !hasCrossOriginIframe) return null;

  console.info('[Actunime heuristics] score=', score, {
    ldMatched: ld.matched,
    ogType,
    ogTitle,
    urlMatch: URL_TOKENS_VIDEO.test(location.pathname),
    hasValidVideo,
    hasCrossOriginIframe,
  });

  if (score < SCORE_THRESHOLD) return null;

  // Fallback titre : document.title si rien d'autre
  if (!title) title = document.title || undefined;
  if (!title) return null;

  // Nettoyage SEO commun aux agrégateurs (préfixes « Regarder gratuitement »,
  // suffixes « en HD », « - SiteName »…)
  const cleanedTitle = cleanScrapedTitle(title);
  const cleanedSeries = seriesTitle ? cleanScrapedTitle(seriesTitle) : undefined;

  return {
    confidence: score,
    title: cleanedSeries ?? cleanedTitle,
    seriesTitle: cleanedSeries,
    episode,
    season,
    imageUrl,
    // Inférence : ld+json `Movie` → toujours anime côté Actunime aussi (pas de
    // catégorie "film" séparée). On laisse 'anime' par défaut, le toast E13
    // permet de toute façon à l'user de corriger.
    kind: 'anime',
  };
}

// `cleanScrapedTitle` factorisé dans `./title-cleanup.ts` — utilisé aussi
// par les stratégies du wizard E17 (`strategies/og.ts`, `strategies/dom-selectors.ts`).

/**
 * Détecte la présence d'au moins une iframe pointant vers un host différent
 * du nôtre, avec une taille non-triviale (filtre les iframes de tracking
 * 1×1 qui ne sont pas des players). Suffisant pour considérer qu'on est
 * sur un site agrégateur avec un player tiers embed.
 */
function hasCrossOriginPlayerIframe(): boolean {
  const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[src]');
  for (const f of iframes) {
    try {
      const u = new URL(f.src, location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      if (u.hostname === location.hostname) continue;
      // Filtre les iframes minuscules (tracking pixels, oauth widgets…)
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

/**
 * Parse tous les `<script type="application/ld+json">` du document et retourne
 * les premières valeurs trouvées correspondant à un type vidéo connu.
 * Tolérant aux formats : objet seul, tableau d'objets, `@graph` avec liste.
 */
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
      const matched = matchVideoLd(item, result);
      if (matched) result.matched = true;
      if (result.title && result.episode !== undefined) break;
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

function matchVideoLd(item: Record<string, unknown>, into: JsonLdResult): boolean {
  const types = normalizeTypes(item['@type']);
  if (types.length === 0) return false;
  const isVideo = types.some((t) =>
    ['TVEpisode', 'Episode', 'Movie', 'VideoObject', 'AnimeEpisode', 'AnimeSeries'].includes(t),
  );
  if (!isVideo) return false;

  // Titre : pour TVEpisode on préfère le nom de la série au titre de l'épisode.
  // Pour Movie c'est le titre.
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
