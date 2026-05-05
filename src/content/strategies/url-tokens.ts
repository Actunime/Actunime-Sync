/**
 * Stratégie URL tokens : lit `location.pathname` pour extraire un slug
 * série + numéro d'épisode/saison via patterns courants.
 *
 * Patterns reconnus :
 *   /watch/<id>/<slug-with-episode>
 *   /anime/<slug>/episode-<N>
 *   /serie/<slug>/saison-<S>/episode-<N>
 *   .../s<S>e<N>...
 *   .../episode/<N>
 *   .../<slug>-episode-<N>
 *   .../<slug>-ep-<N>
 */

import type { StrategyResult } from '@/shared/messaging';

interface UrlExtraction {
  slug?: string;
  episode?: number;
  season?: number;
  matchedPattern: string;
}

const PATTERNS: Array<{ name: string; re: RegExp; map: (m: RegExpExecArray) => UrlExtraction }> = [
  {
    name: 's{S}e{N} (Plex/Netflix-like)',
    re: /\/([a-z0-9][a-z0-9-]*?)[/-]s(\d{1,2})e(\d{1,4})\b/i,
    map: (m) => ({
      slug: m[1],
      season: Number(m[2]),
      episode: Number(m[3]),
      matchedPattern: 's{S}e{N}',
    }),
  },
  {
    name: 'saison/episode',
    re: /\/([a-z0-9][a-z0-9-]*?)\/saison-(\d{1,2})\/episode-(\d{1,4})/i,
    map: (m) => ({
      slug: m[1],
      season: Number(m[2]),
      episode: Number(m[3]),
      matchedPattern: 'saison/episode',
    }),
  },
  {
    name: '/{slug}/episode-N',
    re: /\/([a-z0-9][a-z0-9-]+?)\/episode-(\d{1,4})/i,
    map: (m) => ({ slug: m[1], episode: Number(m[2]), matchedPattern: '/{slug}/episode-N' }),
  },
  {
    name: '/{slug}-episode-N',
    re: /\/([a-z0-9][a-z0-9-]+?)-episode-(\d{1,4})/i,
    map: (m) => ({ slug: m[1], episode: Number(m[2]), matchedPattern: '/{slug}-episode-N' }),
  },
  {
    name: '/{slug}-ep-N',
    re: /\/([a-z0-9][a-z0-9-]+?)-ep-?(\d{1,4})/i,
    map: (m) => ({ slug: m[1], episode: Number(m[2]), matchedPattern: '/{slug}-ep-N' }),
  },
  {
    name: '/episode/N',
    re: /\/([a-z0-9][a-z0-9-]+?)\/episode\/(\d{1,4})/i,
    map: (m) => ({ slug: m[1], episode: Number(m[2]), matchedPattern: '/{slug}/episode/N' }),
  },
  {
    name: '/{slug}/.../chapter-N',
    re: /\/([a-z0-9][a-z0-9-]+?)(?:\.[a-z0-9]+)?(?:\/[a-z]{2})?\/(?:chapter|chapitre|ch)[-_/]?(\d{1,5}(?:\.\d+)?)/i,
    map: (m) => ({
      slug: m[1],
      episode: Math.floor(Number(m[2])),
      matchedPattern: '/{slug}/chapter-N',
    }),
  },
  {
    name: '/{slug}-chapter-N',
    re: /\/([a-z0-9][a-z0-9-]+?)-(?:chapter|chapitre|ch)-?(\d{1,5}(?:\.\d+)?)/i,
    map: (m) => ({
      slug: m[1],
      episode: Math.floor(Number(m[2])),
      matchedPattern: '/{slug}-chapter-N',
    }),
  },
  {
    name: '/watch/{id}/{slug}',
    re: /\/watch\/([^/]+)\/([^/?#]+)/i,
    map: (m) => ({ slug: m[2], matchedPattern: '/watch/{id}/{slug}' }),
  },
];

export function runUrlTokensStrategy(): StrategyResult {
  const base: StrategyResult = {
    id: 'url-tokens',
    label: "Tokens dans l'URL",
    description:
      'Cherche des motifs comme /watch/, /episode-N, /saison-S/episode-N, sXeY dans le chemin.',
    confidence: 0,
  };

  const path = location.pathname;
  const url = location.href;

  for (const p of PATTERNS) {
    const m = p.re.exec(path);
    if (!m) continue;
    const out = p.map(m);

    const title = out.slug ? slugToTitle(out.slug, out.episode) : undefined;

    let confidence = 0;
    if (title) confidence += 0.35;
    if (out.episode !== undefined) confidence += 0.35;
    if (out.season !== undefined) confidence += 0.15;
    // Le slug Crunchyroll-like (ID + slug texte) est moins fiable que /{slug}/episode-N
    if (out.matchedPattern.startsWith('/watch/')) confidence -= 0.1;

    return {
      ...base,
      title,
      episode: out.episode,
      season: out.season,
      evidence: `Pattern ${out.matchedPattern}\n${url}`,
      confidence: Math.max(0, Math.min(confidence, 1)),
    };
  }

  // Aucun motif typique, mais on log quand même le path pour aider l'user.
  return {
    ...base,
    evidence: `Aucun motif d'URL reconnu dans :\n${path}`,
    confidence: 0,
  };
}

/**
 * Convertit un slug type "naruto-shippuden-1" en "Naruto Shippuden",
 * en retirant le numéro d'épisode trouvé en suffixe.
 */
function slugToTitle(slug: string, episode?: number): string | undefined {
  if (!slug) return undefined;
  let cleaned = slug.replace(/\.[a-z0-9]+$/i, '');
  if (episode !== undefined) {
    cleaned = cleaned.replace(
      new RegExp(`-?(?:episode-|ep-|e|chapter-|chapitre-|ch-?)?${episode}$`, 'i'),
      '',
    );
  }
  cleaned = cleaned
    .replace(/-(?:episode|ep|épisode|chapter|chapitre|ch)[-.]?\d+.*$/i, '')
    .replace(/-e\d+.*$/i, '')
    .replace(/-s\d+.*$/i, '');
  const out = cleaned
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return out || undefined;
}

/**
 * Construit une regex pour `location.pathname` qui ne matche que les pages
 * d'épisode (et pas la home/listing). Utilisé à la sauvegarde du LearnedPattern
 * pour éviter de tirer sur toute la navigation user.
 */
export function deriveEpisodeUrlRegex(currentPath: string): string | undefined {
  // Utilise le pattern qui a matché — on remplace le slug par un wildcard et
  // on garde la position d'épisode/saison.
  for (const p of PATTERNS) {
    const m = p.re.exec(currentPath);
    if (!m) continue;
    return p.re.source;
  }
  return undefined;
}
