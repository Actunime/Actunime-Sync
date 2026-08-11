import { describe, expect, it } from 'vitest';
import { isValidRegex } from './learned-patterns-io';

describe('isValidRegex', () => {
  it('accepte les regex simples et non ambiguës', () => {
    expect(isValidRegex('/episode-\\d+/i')).toBe(true);
    expect(isValidRegex('^/watch/[^/]+/ep-\\d+$')).toBe(true);
    expect(isValidRegex('(?:chapter|chapitre)-\\d+')).toBe(true);
  });

  it('rejette les quantificateurs imbriqués (ReDoS classique)', () => {
    expect(isValidRegex('(a+)+$')).toBe(false);
    expect(isValidRegex('(a*)+$')).toBe(false);
    expect(isValidRegex('(?:a+)+$')).toBe(false);
    expect(isValidRegex('(a+){2,}$')).toBe(false);
  });

  it('rejette les alternances ambiguës répétées (bypass de la heuristique naïve)', () => {
    expect(isValidRegex('(a|a)+$')).toBe(false);
    expect(isValidRegex('(x|xx)*$')).toBe(false);
    expect(isValidRegex('(?:a|a){3,}$')).toBe(false);
  });

  it('rejette les regex trop longues ou syntaxiquement invalides', () => {
    expect(isValidRegex('a'.repeat(300))).toBe(false);
    expect(isValidRegex('(unclosed')).toBe(false);
    expect(isValidRegex('')).toBe(false);
  });
});
