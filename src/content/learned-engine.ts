/**
 * Applique un `LearnedPattern` (E17) à la page courante et retourne un
 * `DetectionResult` compatible avec le pipeline existant, ou `null` si la
 * page n'est pas une page d'épisode (regex URL non matchée, ou stratégie
 * incapable d'extraire un titre).
 */

import type { LearnedPattern, NumericSelector } from '@/shared/types';
import type { DetectionResult } from './detection';
import {
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

  let title: string | undefined;
  let episode: number | undefined;
  let season: number | undefined;

  switch (pattern.strategy) {
    case 'jsonld': {
      const r = runJsonLdStrategy();
      title = r.title;
      episode = r.episode;
      season = r.season;
      break;
    }
    case 'og': {
      const r = runOgStrategy();
      title = r.title;
      episode = r.episode;
      season = r.season;
      break;
    }
    case 'url-tokens': {
      const r = runUrlTokensStrategy();
      title = r.title;
      episode = r.episode;
      season = r.season;
      break;
    }
    case 'dom-selectors': {
      const r = runDomSelectorsStrategy();
      title = r.title;
      episode = r.episode;
      season = r.season;
      break;
    }
    case 'manual': {
      const sel = pattern.manualSelectors;
      if (sel) {
        title = readText(sel.title);
        if (sel.episode) episode = readNumericSelector(sel.episode);
        if (sel.season) season = readNumericSelector(sel.season);
      }
      break;
    }
  }

  if (!title) return null;

  // slug propre depuis le titre — sert de clé de cache stable
  const seriesSlug = slugify(title);

  return {
    siteId: `learned:${pattern.host}`,
    kind: pattern.kind,
    url: location.href,
    title,
    episode,
    season,
    seriesSlug: seriesSlug || undefined,
    slug: seriesSlug || undefined,
  };
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
