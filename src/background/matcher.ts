/**
 * Matching d'un titre extrait (ex. « Attack on Titan ») vers une entité Actunime.
 *
 * Cascade :
 *  1. Cache hit par `seriesKey` → résolution immédiate (un seul confirm par série)
 *  2. Recherche fuzzy via `POST /search/global` (top 5 animes)
 *  3. Scoring Levenshtein normalisé + boost si saison détectée
 *  4. Retourne le top N (3) candidats — la décision finale revient à l'UI
 *     de confirmation côté content script
 */

import { api, entityId, type SearchAnime } from '@/shared/api-client';
import { storage } from '@/shared/storage';

export interface ScoredAnime {
  anime: SearchAnime;
  score: number;
  /** Bonus saison appliqué au score brut (pour debug / affichage). */
  seasonBoost?: number;
}

/**
 * Match contre une « pending entry » : œuvre proposée par l'user mais pas
 * encore validée par le staff. Pas de mediaId, on push direct via listEntryId.
 */
export interface PendingMatch {
  listEntryId: string;
  title: string;
  coverUrl?: string | null;
  status?: string;
  episodesWatched?: number;
  /** Nombre d'utilisateurs qui appuient la proposition liée. */
  supportCount?: number;
}

export interface MatchTitleResult {
  /** Hit cache : un seul candidat, plus rien à confirmer. */
  cached?: ScoredAnime;
  /** Œuvre déjà proposée par l'user, en attente de validation staff. */
  pending?: PendingMatch;
  /** Top N candidats à proposer à l'user pour confirmation. */
  candidates: ScoredAnime[];
  /** Clé série utilisée pour cache (à renvoyer au moment de la confirmation). */
  seriesKey: string;
}

const TOP_N = 3;
const SEASON_BOOST = 0.2;

/**
 * Construit la clé de cache série. Préfère `seriesId` (stable, ID interne du
 * site) à `seriesSlug` (peut changer si refonte URL), avec fallback sur le
 * slug épisode si rien d'autre.
 */
export function buildSeriesKey(params: {
  siteId: string;
  seriesId?: string;
  seriesSlug?: string;
  slug?: string;
  title?: string;
}): string {
  const id = params.seriesId ?? params.seriesSlug ?? params.slug ?? params.title ?? 'unknown';
  return `${params.siteId}:${id}`;
}

/**
 * Résout un titre extrait vers une liste ordonnée de candidats Actunime.
 * Le caller doit ensuite confirmer le choix (ou hit cache direct).
 */
export async function matchTitle(params: {
  siteId: string;
  slug?: string;
  title: string;
  season?: number;
  seriesId?: string;
  seriesSlug?: string;
}): Promise<MatchTitleResult> {
  const seriesKey = buildSeriesKey(params);
  const cached = await storage.getMatching(seriesKey);

  // Cache hit pending → on garde le pendingListEntryId pour que le push se
  // fasse direct via PUT /lists/<id> (pas de mediaId pour cette œuvre).
  if (cached?.pendingListEntryId && cached.title) {
    return {
      pending: {
        listEntryId: cached.pendingListEntryId,
        title: cached.title,
        coverUrl: cached.coverUrl ?? null,
      },
      candidates: [],
      seriesKey,
    };
  }

  // Garde-fou : un cache avec un titre vide / sans id est inutilisable. On
  // l'ignore et on retourne au flow normal (re-search + re-confirm), pour
  // éviter d'afficher un badge sans contenu.
  if (cached && cached.actunimeEntityId && cached.title) {
    return {
      cached: {
        anime: { id: cached.actunimeEntityId, title: { normal: cached.title } },
        score: 1,
      },
      candidates: [],
      seriesKey,
    };
  }

  // Avant la recherche globale, regarde si l'user a déjà proposé cette œuvre
  // (proposition en attente de validation). Évite la double proposition et
  // le toast « Pas dans Actunime » sur ses propres œuvres pending.
  try {
    const pending = await api.getPendingListEntries();
    const detected = cleanTitle(params.title).toLowerCase();
    const hit = pending.find((e) => {
      if (!e.preview?.title) return false;
      return fuzzyTitleMatch(detected, e.preview.title);
    });
    if (hit?.preview) {
      const id = entityId(hit);
      if (id) {
        return {
          pending: {
            listEntryId: id,
            title: hit.preview.title,
            coverUrl: hit.preview.coverImage ?? null,
            status: hit.status,
            episodesWatched: hit.episodesWatched,
            supportCount: hit.proposal?.supportCount,
          },
          candidates: [],
          seriesKey,
        };
      }
    }
  } catch {
    // API down ou autre — on continue avec search global, pas bloquant
  }

  const cleaned = cleanTitle(params.title);
  if (cleaned.length < 2) return { candidates: [], seriesKey };

  const res = await api.searchGlobal(cleaned, 10);
  const animes = res.animes ?? [];
  if (animes.length === 0) return { candidates: [], seriesKey };

  const scored = animes
    .map((anime) => scoreCandidate(cleaned, anime, params.season))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return { candidates: scored, seriesKey };
}

export function pickDisplayTitle(anime: SearchAnime): string | undefined {
  return anime.title?.normal ?? anime.title?.original ?? anime.title?.alias?.[0];
}

/**
 * Match conservateur entre un titre détecté côté site et un titre stocké en
 * preview de pending entry. Inclusion bidirectionnelle ou similarité ≥ 0.85.
 * Utilisé uniquement pour les pending de l'user — donc faux positifs très
 * peu probables (pool restreint à ses propres propositions).
 */
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
    .replace(/\s*-?\s*(episode|ep|épisode|ep\.).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidate(query: string, anime: SearchAnime, season?: number): ScoredAnime {
  const candidates = [
    anime.title?.original,
    anime.title?.normal,
    ...(anime.title?.alias ?? []),
  ].filter(Boolean) as string[];
  if (candidates.length === 0) return { anime, score: 0 };

  const baseScore = Math.max(...candidates.map((c) => similarity(query, c)));
  const boost = season !== undefined ? seasonMatchBoost(candidates, season) : 0;

  return {
    anime,
    score: Math.min(1, baseScore + boost),
    seasonBoost: boost || undefined,
  };
}

/**
 * Renvoie un boost si l'un des titres candidats indique la saison demandée
 * (« Saison N », « Season N », « SN » ou suffixe ` N`). Pour `season === 1`,
 * boost les candidats *sans* indicateur saison (puisque S1 est rarement
 * suffixée explicitement).
 */
function seasonMatchBoost(titles: string[], season: number): number {
  const explicit = new RegExp(
    `\\b(?:season|saison|s)\\s*${season}\\b|\\b${season}(?:nd|rd|th|st)?\\s+season\\b|\\s${season}$`,
    'i',
  );
  const hasAnySeasonHint = (t: string) =>
    /\b(?:season|saison)\s*\d+\b|\bs\d+\b|\s\d+$/i.test(t);

  if (season === 1) {
    return titles.some((t) => !hasAnySeasonHint(t)) ? SEASON_BOOST : 0;
  }
  return titles.some((t) => explicit.test(t)) ? SEASON_BOOST : 0;
}

/**
 * Similarité normalisée (0 → 1) basée sur la distance de Levenshtein sur
 * chaînes en lowercase + accents retirés.
 */
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
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
