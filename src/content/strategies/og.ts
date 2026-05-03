/**
 * Stratégie Open Graph : `<meta property="og:title">` + parse regex pour
 * extraire un éventuel numéro d'épisode/saison du titre.
 */

import type { StrategyResult } from '@/shared/messaging';
import { cleanScrapedTitle } from '../title-cleanup';

export function runOgStrategy(): StrategyResult {
  const base: StrategyResult = {
    id: 'og',
    label: 'Open Graph (meta tags)',
    description:
      "Lit <meta property=\"og:title\" / og:type>. Présent sur la majorité des sites de streaming.",
    confidence: 0,
  };

  const ogTitle = readMeta('og:title');
  const ogType = readMeta('og:type');
  if (!ogTitle) return base;

  const evidence = [
    ogType ? `og:type = ${ogType}` : null,
    `og:title = ${ogTitle}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Tente d'extraire « épisode N » / « saison N » du titre lui-même, puis
  // nettoie le bruit résiduel (langue, qualité, suffixe site).
  const { episode, season, cleanedTitle: parseStripped } = parseEpisodeSeasonFromTitle(ogTitle);
  const cleanedTitle = parseStripped ? cleanScrapedTitle(parseStripped) : undefined;

  let confidence = 0;
  if (cleanedTitle) confidence += 0.4;
  if (episode !== undefined) confidence += 0.25;
  if (season !== undefined) confidence += 0.1;
  // og:type vidéo = bonus de confiance
  if (
    ogType &&
    ['video.episode', 'video.tv_show', 'video.movie', 'video.other'].includes(ogType)
  ) {
    confidence += 0.15;
  }

  return {
    ...base,
    title: cleanedTitle,
    episode,
    season,
    evidence,
    confidence: Math.min(confidence, 1),
  };
}

function readMeta(property: string): string | undefined {
  const el =
    document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ??
    document.querySelector<HTMLMetaElement>(`meta[name="${property}"]`);
  return el?.content?.trim() || undefined;
}

/**
 * Parse un titre type « Naruto - Épisode 5 - VOSTFR » et retourne
 * { episode, season, cleanedTitle }.
 */
export function parseEpisodeSeasonFromTitle(raw: string): {
  episode?: number;
  season?: number;
  cleanedTitle?: string;
} {
  let title = raw.trim();
  let episode: number | undefined;
  let season: number | undefined;

  // Format "S2E5" / "S02E05" en priorité (épisode + saison ensemble)
  const sxe = /\bS(\d{1,2})E(\d{1,4})\b/i.exec(title);
  if (sxe) {
    season = Number(sxe[1]);
    episode = Number(sxe[2]);
    title = title.replace(sxe[0], '').trim();
  }

  // Episode N / Épisode N / Ep N / Ep.N
  if (episode === undefined) {
    const ep = /(?:épisode|episode|ep)\.?\s*(\d{1,4})/i.exec(title);
    if (ep) {
      episode = Number(ep[1]);
      title = title.replace(ep[0], '').trim();
    }
  }

  // Saison N / Season N
  if (season === undefined) {
    const s = /(?:saison|season)\s*(\d{1,2})/i.exec(title);
    if (s) {
      season = Number(s[1]);
      title = title.replace(s[0], '').trim();
    }
  }

  // Nettoie séparateurs résiduels en bouts/queue
  title = title
    .replace(/[\s\-|·•–—]+$/u, '')
    .replace(/^[\s\-|·•–—]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    episode,
    season,
    cleanedTitle: title || undefined,
  };
}
