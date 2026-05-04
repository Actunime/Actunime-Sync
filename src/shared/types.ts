export type SiteKind = 'anime' | 'manga';

/**
 * Stratégie de détection retenue par le wizard de configuration (E17).
 * `manual` = l'user a pointé les éléments du DOM lui-même via le pick visuel.
 */
export type StrategyId =
  | 'jsonld'
  | 'og'
  | 'url-tokens'
  | 'document-title'
  | 'dom-selectors'
  | 'manual';

/**
 * Sélecteur numérique : un sélecteur CSS + optionnellement l'index du nombre
 * à extraire quand le textContent en contient plusieurs.
 *
 * Exemple — élément avec textContent « Witch Hat Atelier - 03 VOSTFR - 03 » :
 *   - `tokenIndex: 0` → 1er nombre = 03 (épisode)
 *   - `tokenIndex` absent → fallback : 1er nombre trouvé (= identique à 0
 *     dans cet exemple, mais piège si le texte commence par une année type
 *     « 2024 - 03 »).
 *
 * Si l'élément ne contient qu'un seul nombre, `tokenIndex` peut être absent.
 */
export interface NumericSelector {
  selector: string;
  /** Index 0-based dans `textContent.match(/\d+/g)`. */
  tokenIndex?: number;
}

/**
 * Pattern privé local appris via le wizard de configuration (E17).
 * Persistance 100 % `chrome.storage.local`, jamais transmis à l'API
 * (cf. ADR-008 — couche 3 patterns privés).
 */
/**
 * Mode de tracking de progression pour les manga. L'observer correspondant
 * pousse `chaptersRead` quand son trigger est atteint.
 */
export type MangaTrackingMode = 'manual' | 'scroll' | 'page-counter' | 'next-button';

export interface MangaTrackingConfig {
  mode: MangaTrackingMode;
  /** Sélecteur CSS — utilisé par les modes `page-counter` et `next-button`. */
  selector?: string;
  /** Seuil 0..1 pour le mode `scroll` (par défaut 0.9). */
  threshold?: number;
}

export interface LearnedPattern {
  host: string;
  kind: SiteKind;
  strategy: StrategyId;
  manualSelectors?: {
    title: string;
    episode?: NumericSelector;
    season?: NumericSelector;
  };
  /**
   * Regex appliquée à `location.pathname` pour ne déclencher que sur les
   * pages d'épisode/chapitre et pas sur la home/listing/etc.
   */
  episodeUrlRegex?: string;
  /** Configuration du tracking de progression pour les manga (kind === 'manga'). */
  mangaTracking?: MangaTrackingConfig;
  createdAt: string;
  updatedAt: string;
}

