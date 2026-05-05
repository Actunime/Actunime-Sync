/**
 * Stratégie JSON-LD : extrait titre/épisode/saison depuis les balises
 * `<script type="application/ld+json">` schema.org. Stratégie la plus fiable
 * quand le site la propose (Crunchyroll par exemple le fait).
 */

import type { StrategyResult } from '@/shared/messaging';
import { extractFromText } from './title-parser';

interface ExtractedLd {
  title?: string;
  seriesTitle?: string;
  episode?: number;
  season?: number;
  rawSnippet?: string;
}

const MEDIA_TYPES = new Set([
  'TVEpisode',
  'Episode',
  'Movie',
  'VideoObject',
  'AnimeEpisode',
  'AnimeSeries',
  'ComicSeries',
  'ComicIssue',
  'ComicStory',
  'Book',
  'BookSeries',
  'Article',
]);

export function runJsonLdStrategy(): StrategyResult {
  const base: StrategyResult = {
    id: 'jsonld',
    label: 'Données structurées (JSON-LD)',
    description:
      'Lit les balises <script type="application/ld+json"> schema.org. Le plus fiable si le site les expose (TVEpisode, Movie, VideoObject).',
    confidence: 0,
  };

  const data = extractJsonLd();
  if (!data) return base;

  let title = data.seriesTitle ?? data.title;
  let episode = data.episode;
  let season = data.season;

  if (episode === undefined && title) {
    const fallback = extractFromText(title);
    if (fallback?.episode !== undefined) {
      episode = fallback.episode;
      if (fallback.season !== undefined && season === undefined) season = fallback.season;
      if (fallback.title) title = fallback.title;
    }
  }

  let confidence = 0;
  if (title) confidence += 0.5;
  if (episode !== undefined) confidence += 0.3;
  if (season !== undefined) confidence += 0.1;
  if (data.seriesTitle && data.title && data.seriesTitle !== data.title) confidence += 0.1;

  return {
    ...base,
    title,
    episode,
    season,
    evidence: data.rawSnippet,
    confidence: Math.min(confidence, 1),
  };
}

function extractJsonLd(): ExtractedLd | null {
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
    const items = flatten(parsed);
    for (const item of items) {
      const out = matchVideo(item);
      if (out) {
        out.rawSnippet = previewSnippet(item);
        return out;
      }
    }
  }
  return null;
}

function flatten(parsed: unknown): Record<string, unknown>[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(flatten);
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return flatten(obj['@graph']);
    return [obj];
  }
  return [];
}

function matchVideo(item: Record<string, unknown>): ExtractedLd | null {
  const types = normalizeTypes(item['@type']);
  if (types.length === 0) return null;
  const isMedia = types.some((t) => MEDIA_TYPES.has(t));
  if (!isMedia) return null;

  const partOfSeries = item['partOfSeries'] as Record<string, unknown> | undefined;
  const partOfSeason = item['partOfSeason'] as Record<string, unknown> | undefined;

  const seriesName = typeof partOfSeries?.name === 'string' ? partOfSeries.name : undefined;
  const itemName = typeof item.name === 'string' ? item.name : undefined;

  const out: ExtractedLd = {
    seriesTitle: seriesName,
    title: itemName,
  };

  const epNum = item.episodeNumber ?? item.issueNumber ?? item.chapterNumber ?? item.position;
  if (typeof epNum === 'number' && Number.isFinite(epNum)) out.episode = Math.floor(epNum);
  else if (typeof epNum === 'string' && /^\d+(?:\.\d+)?$/.test(epNum))
    out.episode = Math.floor(Number(epNum));

  const seasonNum = partOfSeason?.seasonNumber;
  if (typeof seasonNum === 'number' && Number.isFinite(seasonNum)) out.season = seasonNum;
  else if (typeof seasonNum === 'string' && /^\d+$/.test(seasonNum)) out.season = Number(seasonNum);

  return out;
}

function normalizeTypes(t: unknown): string[] {
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function previewSnippet(item: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(item, null, 2);
    if (json.length > 280) return json.slice(0, 280) + '…';
    return json;
  } catch {
    return '';
  }
}
