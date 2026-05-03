export type SiteKind = 'anime' | 'manga';

/**
 * Stratégie de détection retenue par le wizard de configuration (E17).
 * `manual` = l'user a pointé les éléments du DOM lui-même via le pick visuel.
 */
export type StrategyId = 'jsonld' | 'og' | 'url-tokens' | 'dom-selectors' | 'manual';

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
export interface LearnedPattern {
  /** Hostname normalisé. Ex: `www.example.com`. Sert de clé. */
  host: string;
  kind: SiteKind;
  /** Stratégie validée par l'user pendant le wizard. */
  strategy: StrategyId;
  /**
   * Sélecteurs CSS pointés à la souris dans le mode pick visuel.
   * Présents quand `strategy === 'manual'` ; absents pour les stratégies auto.
   */
  manualSelectors?: {
    title: string;
    episode?: NumericSelector;
    season?: NumericSelector;
  };
  /**
   * Regex appliquée à `location.pathname` pour ne déclencher que sur les
   * pages d'épisode et pas sur la home/listing/etc. Optionnel — dérivé
   * automatiquement de l'URL d'apprentissage si l'user ne l'édite pas.
   */
  episodeUrlRegex?: string;
  createdAt: string;
  updatedAt: string;
}

