/**
 * Stratégie DOM selectors : essaie les sélecteurs CSS génériques courants
 * pour titre / épisode (h1, header du player, document.title, etc.).
 *
 * Stratégie de dernier recours quand JSON-LD et OG sont absents — souvent
 * imprécise mais peut quand même tirer un titre brut.
 */

import type { StrategyResult } from '@/shared/messaging';
import { parseEpisodeSeasonFromTitle } from './og';
import { cleanScrapedTitle } from '../title-cleanup';

const TITLE_SELECTORS = [
  'h1[itemprop="name"]',
  'h1.title',
  'h1.show-title',
  'header h1',
  '.player-title',
  '.video-title',
  '[data-testid*="title" i]',
  'h1',
];

const EPISODE_SELECTORS = [
  '[data-testid*="episode" i]',
  '.episode-title',
  '.current-episode',
  '.episode-number',
  '[itemprop="episodeNumber"]',
];

export function runDomSelectorsStrategy(): StrategyResult {
  const base: StrategyResult = {
    id: 'dom-selectors',
    label: 'Sélecteurs DOM génériques',
    description:
      "Cherche un titre dans des sélecteurs CSS courants (h1, .player-title, document.title). Imprécis — sert de dernier recours.",
    confidence: 0,
  };

  let title: string | undefined;
  let titleSource: string | undefined;
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.textContent?.trim();
    if (text && text.length >= 2 && text.length <= 200) {
      title = text;
      titleSource = sel;
      break;
    }
  }

  // Fallback : document.title nettoyé du suffixe site
  if (!title && document.title) {
    title = stripSiteSuffix(document.title);
    titleSource = 'document.title';
  }

  let episode: number | undefined;
  let episodeSource: string | undefined;
  for (const sel of EPISODE_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.textContent?.trim();
    if (!text) continue;
    const m = /(?:épisode|episode|ep)\.?\s*(\d{1,4})/i.exec(text) ?? /\b(\d{1,4})\b/.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n < 9999) {
        episode = n;
        episodeSource = sel;
        break;
      }
    }
  }

  // Si on a un titre mais pas d'épisode, tente un parse depuis le titre lui-même
  // puis nettoie le bruit (saison/épisode/langue/qualité).
  let season: number | undefined;
  let cleanedTitle = title;
  if (title) {
    const parsed = parseEpisodeSeasonFromTitle(title);
    if (parsed.cleanedTitle) cleanedTitle = parsed.cleanedTitle;
    if (episode === undefined && parsed.episode !== undefined) {
      episode = parsed.episode;
      episodeSource = (episodeSource ?? '') + ' (depuis titre)';
    }
    if (parsed.season !== undefined) season = parsed.season;
  }
  if (cleanedTitle) cleanedTitle = cleanScrapedTitle(cleanedTitle);

  if (!cleanedTitle) return { ...base, evidence: 'Aucun sélecteur DOM courant n\'a matché.' };

  let confidence = 0.25; // base : on a au moins un titre
  if (episode !== undefined) confidence += 0.3;
  if (season !== undefined) confidence += 0.1;
  if (titleSource && titleSource !== 'document.title') confidence += 0.1;

  const evidenceParts = [
    titleSource ? `Titre depuis ${titleSource}` : null,
    episodeSource ? `Épisode depuis ${episodeSource}` : null,
  ].filter(Boolean);

  return {
    ...base,
    title: cleanedTitle,
    episode,
    season,
    evidence: evidenceParts.join('\n') || undefined,
    confidence: Math.min(confidence, 1),
  };
}

/**
 * Retire un suffixe « - SiteName » / « | SiteName » courant en fin de
 * `document.title`.
 */
function stripSiteSuffix(raw: string): string {
  return raw.replace(/\s*[\-|·•–—]\s*[A-Za-z0-9.][^\-|·•–—]{0,30}\s*$/u, '').trim();
}
