/**
 * Applique un `LearnedPattern` (E17) à la page courante et retourne un
 * `DetectionResult` compatible avec le pipeline existant, ou `null` si la
 * page n'est pas une page d'épisode (regex URL non matchée, ou stratégie
 * incapable d'extraire un titre).
 */

import type { LearnedPattern, NumericSelector } from '@/shared/types';
import type { DetectionResult } from './detection';
import {
  runDocumentTitleStrategy,
  runDomSelectorsStrategy,
  runJsonLdStrategy,
  runOgStrategy,
  runUrlTokensStrategy,
} from './strategies';

const MAX_RUNTIME_REGEX_LENGTH = 256;

export function applyLearnedPattern(pattern: LearnedPattern): DetectionResult | null {
  // Filtre URL : ne tire que sur les pages d'épisode (si regex fournie).
  if (pattern.episodeUrlRegex && pattern.episodeUrlRegex.length <= MAX_RUNTIME_REGEX_LENGTH) {
    try {
      const re = new RegExp(pattern.episodeUrlRegex);
      if (!re.test(location.pathname)) return null;
    } catch {
      // regex invalide → on continue quand même (best-effort)
    }
  }

  const isManga = pattern.kind === 'manga';
  let title: string | undefined;
  let episode: number | undefined;
  let chapter: number | undefined;
  let season: number | undefined;

  const assignNumber = (value: number | undefined) => {
    if (value === undefined) return;
    if (isManga) chapter = value;
    else episode = value;
  };

  switch (pattern.strategy) {
    case 'jsonld': {
      const r = runJsonLdStrategy();
      title = r.title;
      assignNumber(r.episode);
      if (!isManga) season = r.season;
      break;
    }
    case 'og': {
      const r = runOgStrategy();
      title = r.title;
      assignNumber(r.episode);
      if (!isManga) season = r.season;
      break;
    }
    case 'url-tokens': {
      const r = runUrlTokensStrategy();
      title = r.title;
      assignNumber(r.episode);
      if (!isManga) season = r.season;
      break;
    }
    case 'document-title': {
      const r = runDocumentTitleStrategy();
      title = r.title;
      assignNumber(r.episode);
      if (!isManga) season = r.season;
      break;
    }
    case 'dom-selectors': {
      const r = runDomSelectorsStrategy();
      title = r.title;
      assignNumber(r.episode);
      if (!isManga) season = r.season;
      break;
    }
    case 'manual': {
      const sel = pattern.manualSelectors;
      if (sel) {
        title = readText(sel.title);
        if (sel.episode) assignNumber(readNumericSelector(sel.episode));
        if (sel.season && !isManga) season = readNumericSelector(sel.season);
      }
      break;
    }
  }

  if (!title) return null;

  // Le numéro extrait par la stratégie choisie par l'user prime — l'URL ne
  // sert que de fallback quand la stratégie n'a pas fourni de nombre. Certains
  // sites (MangaFire…) mettent un ID interne dans le path (/chapter/3833602),
  // pas le numéro de chapitre.
  if (isManga) {
    if (chapter === undefined) chapter = extractChapterFromUrl();
  } else {
    if (episode === undefined) episode = extractEpisodeFromUrl();
  }

  const seriesSlug = slugify(title);

  return {
    siteId: `learned:${pattern.host}`,
    kind: pattern.kind,
    url: location.href,
    title,
    episode,
    chapter,
    season,
    seriesSlug: seriesSlug || undefined,
    slug: seriesSlug || undefined,
  };
}

function extractChapterFromUrl(): number | undefined {
  const m = /\/(?:chapter|chapitre|ch)[-_/]?(\d+(?:\.\d+)?)\b/i.exec(location.pathname);
  if (!m) return undefined;
  const n = Math.floor(Number(m[1]));
  // Au-delà de 4 chiffres, c'est presque sûrement un ID interne du site
  // (MangaFire : /chapter/3833602), pas un numéro de chapitre.
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : undefined;
}

function extractEpisodeFromUrl(): number | undefined {
  const m =
    /\/(?:episode|épisode|ep)[-_/]?(\d{1,4})\b/i.exec(location.pathname) ??
    /[/-]s\d{1,2}e(\d{1,4})\b/i.exec(location.pathname);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 9999 ? n : undefined;
}

function readText(selector: string): string | undefined {
  try {
    const el = document.querySelector<HTMLElement>(selector);
    const text = el?.textContent?.trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lit le nombre désigné par un `NumericSelector` :
 *   - si `tokenIndex` est défini, on prend le N-ième nombre dans le textContent
 *   - sinon : fallback heuristique (préfixe explicite, puis 1er nombre)
 */
function readNumericSelector(sel: NumericSelector): number | undefined {
  const text = readText(sel.selector);
  if (!text) return undefined;
  if (sel.tokenIndex !== undefined) {
    const tokens = text.match(/\d{1,4}/g);
    if (!tokens) return undefined;
    const raw = tokens[sel.tokenIndex];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n < 9999 ? n : undefined;
  }
  return parseNumber(text);
}

/**
 * Parse heuristique d'un nombre depuis un texte type « Épisode 5 » / « 5 » / « E5 ».
 * Préfère un nombre annoncé par un préfixe explicite, sinon le 1er nombre trouvé.
 */
function parseNumber(text: string): number | undefined {
  const explicit = /(?:épisode|episode|ep)\.?\s*(\d{1,4})/i.exec(text);
  if (explicit) return Number(explicit[1]);
  const seasonExplicit = /(?:saison|season)\s*(\d{1,2})/i.exec(text);
  if (seasonExplicit) return Number(seasonExplicit[1]);
  const any = /(\d{1,4})/.exec(text);
  if (any) {
    const n = Number(any[1]);
    if (n > 0 && n < 9999) return n;
  }
  return undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}
