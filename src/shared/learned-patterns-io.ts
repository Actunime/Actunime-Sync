/**
 * Sérialisation / désérialisation des `LearnedPattern` pour l'export-import
 * entre utilisateurs (E17). Format JSON versionné, validation maison sans
 * dépendance externe pour garder le bundle Options léger.
 */

import type { LearnedPattern, NumericSelector, StrategyId } from './types';

const EXPORT_VERSION = 1 as const;

export interface LearnedPatternsExport {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /**
   * Source informative (« Actunime Sync 0.x »). Pas utilisé pour la
   * compatibilité — purement humain.
   */
  source: string;
  patterns: LearnedPattern[];
}

const VALID_STRATEGIES: StrategyId[] = [
  'jsonld',
  'og',
  'url-tokens',
  'dom-selectors',
  'manual',
];

/**
 * Produit le JSON formaté à télécharger / partager.
 */
export function serializePatterns(patterns: LearnedPattern[]): string {
  const payload: LearnedPatternsExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: `Actunime Sync ${chrome.runtime.getManifest().version}`,
    patterns,
  };
  return JSON.stringify(payload, null, 2);
}

export type ParseResult =
  | { ok: true; patterns: LearnedPattern[] }
  | { ok: false; error: string };

/**
 * Parse + valide un JSON exporté. Tolérant : on ignore les patterns invalides
 * mais on les compte dans le résultat (`skipped`) pour info.
 */
export function parseLearnedPatternsExport(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `JSON invalide : ${(err as Error).message}` };
  }

  // Tolérance : accepte aussi un array brut de patterns (sans wrapper).
  if (Array.isArray(parsed)) {
    parsed = { version: EXPORT_VERSION, exportedAt: '', source: '', patterns: parsed };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: 'Le fichier ne contient pas un objet JSON.' };
  }

  const versionRaw = (parsed as Record<string, unknown>).version;
  const version = typeof versionRaw === 'number' ? versionRaw : null;
  if (version !== EXPORT_VERSION) {
    return {
      ok: false,
      error: `Version de format non supportée : ${versionRaw}. Attendu : ${EXPORT_VERSION}.`,
    };
  }

  const patternsRaw = (parsed as Record<string, unknown>).patterns;
  if (!Array.isArray(patternsRaw)) {
    return { ok: false, error: 'Champ « patterns » manquant ou invalide.' };
  }

  const patterns: LearnedPattern[] = [];
  for (const p of patternsRaw) {
    const validated = validatePattern(p);
    if (validated) patterns.push(validated);
  }

  if (patterns.length === 0) {
    return { ok: false, error: 'Aucun pattern valide trouvé dans le fichier.' };
  }

  return { ok: true, patterns };
}

/**
 * Valide un objet de type `LearnedPattern` venant de l'extérieur (JSON tiers).
 * Retourne le pattern normalisé ou `null` si invalide.
 *
 * Refuse :
 *  - host vide / non-string
 *  - kind hors `anime|manga`
 *  - strategy hors énum connue
 *  - sélecteurs CSS invalides (ne passent pas `document.querySelector` sur
 *    une sandbox try-catch — vérifié à l'import au niveau de l'options page,
 *    pas ici, pour ne pas dépendre du DOM)
 */
function validatePattern(p: unknown): LearnedPattern | null {
  if (!isObject(p)) return null;

  const host = p.host;
  if (typeof host !== 'string' || host.length === 0 || host.length > 256) return null;

  const kind = p.kind;
  if (kind !== 'anime' && kind !== 'manga') return null;

  const strategy = p.strategy;
  if (typeof strategy !== 'string' || !VALID_STRATEGIES.includes(strategy as StrategyId)) {
    return null;
  }

  const out: LearnedPattern = {
    host,
    kind,
    strategy: strategy as StrategyId,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
  };

  if (typeof p.episodeUrlRegex === 'string' && isValidRegex(p.episodeUrlRegex)) {
    out.episodeUrlRegex = p.episodeUrlRegex;
  }

  if (strategy === 'manual') {
    const sel = p.manualSelectors;
    if (!isObject(sel)) return null;
    const title = sel.title;
    if (typeof title !== 'string' || title.length === 0 || title.length > 1024) return null;
    out.manualSelectors = {
      title,
      episode: validateNumericSelector(sel.episode),
      season: validateNumericSelector(sel.season),
    };
  }

  return out;
}

function validateNumericSelector(v: unknown): NumericSelector | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) return undefined;
  const selector = v.selector;
  if (typeof selector !== 'string' || selector.length === 0 || selector.length > 1024) {
    return undefined;
  }
  const tokenIndex =
    typeof v.tokenIndex === 'number' && Number.isInteger(v.tokenIndex) && v.tokenIndex >= 0
      ? v.tokenIndex
      : undefined;
  return { selector, tokenIndex };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_REGEX_LENGTH = 256;
const REDOS_HEURISTIC = /\([^)]*[+*][^)]*\)[+*]|\(\?:[^)]*[+*][^)]*\)[+*]/;

function isValidRegex(source: string): boolean {
  if (typeof source !== 'string') return false;
  if (source.length === 0 || source.length > MAX_REGEX_LENGTH) return false;
  if (REDOS_HEURISTIC.test(source)) return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Catégorise une liste de patterns importés selon leur conflit avec ceux
 * déjà installés. Utilisé pour afficher un récap dans l'UI (« 3 nouveaux,
 * 2 remplacent les existants »).
 */
export interface ImportDiff {
  /** Hosts non encore configurés. */
  fresh: LearnedPattern[];
  /** Hosts déjà configurés — l'import remplacera. */
  conflicts: LearnedPattern[];
}

export function diffImport(
  incoming: LearnedPattern[],
  existing: LearnedPattern[],
): ImportDiff {
  const existingHosts = new Set(existing.map((p) => p.host));
  const fresh: LearnedPattern[] = [];
  const conflicts: LearnedPattern[] = [];
  for (const p of incoming) {
    if (existingHosts.has(p.host)) conflicts.push(p);
    else fresh.push(p);
  }
  return { fresh, conflicts };
}

/**
 * Suggère un nom de fichier pour l'export. Si export d'un seul site →
 * `actunime-pattern-<host>.json`. Sinon → `actunime-patterns-<date>.json`.
 */
export function suggestFilename(patterns: LearnedPattern[]): string {
  if (patterns.length === 1) {
    const safe = patterns[0].host.replace(/[^a-z0-9.-]/gi, '-');
    return `actunime-pattern-${safe}.json`;
  }
  const date = new Date().toISOString().slice(0, 10);
  return `actunime-patterns-${date}.json`;
}
