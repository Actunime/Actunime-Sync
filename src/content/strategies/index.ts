/**
 * Lance les 4 stratégies de détection en parallèle pour le wizard E17.
 * Les stratégies sont synchrones et lisent juste le DOM courant — pas
 * d'appels réseau, pas de promesses, donc « parallèle » = boucle simple.
 */

import type { StrategyResult } from '@/shared/messaging';
import { runDomSelectorsStrategy } from './dom-selectors';
import { runJsonLdStrategy } from './jsonld';
import { runOgStrategy } from './og';
import { runUrlTokensStrategy } from './url-tokens';

export function runAllStrategies(): StrategyResult[] {
  return [
    runJsonLdStrategy(),
    runOgStrategy(),
    runUrlTokensStrategy(),
    runDomSelectorsStrategy(),
  ];
}

export { runJsonLdStrategy, runOgStrategy, runUrlTokensStrategy, runDomSelectorsStrategy };
export { deriveEpisodeUrlRegex } from './url-tokens';
