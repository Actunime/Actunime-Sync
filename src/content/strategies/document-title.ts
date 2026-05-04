import type { StrategyResult } from '@/shared/messaging';
import { extractFromText } from './title-parser';

export function runDocumentTitleStrategy(): StrategyResult {
  const base: StrategyResult = {
    id: 'document-title',
    label: 'Titre de la page',
    description:
      "Lit `<title>` et reconnaît les motifs « Ch. N », « Chapter N », « Episode N », « Vol. N Ch. M », « sXXeYY ».",
    confidence: 0,
  };

  const raw = (document.title ?? '').trim();
  if (!raw) {
    return { ...base, evidence: 'document.title vide' };
  }

  const out = extractFromText(raw);
  if (!out || !out.title) {
    return {
      ...base,
      evidence: `Aucun motif reconnu dans :\n${raw}`,
      confidence: 0,
    };
  }

  let confidence = 0.4;
  if (out.episode !== undefined) confidence += 0.3;
  if (out.season !== undefined) confidence += 0.15;

  return {
    ...base,
    title: out.title,
    episode: out.episode,
    season: out.season,
    evidence: `Pattern « ${out.matchedPattern} »\n${raw}`,
    confidence: Math.min(confidence, 1),
  };
}
