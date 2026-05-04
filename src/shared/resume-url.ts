/**
 * Détecte un pattern d'URL de chapitre/épisode et reconstruit l'URL pour un
 * autre numéro. Heuristique pure, sans pattern stocké : si la confiance n'est
 * pas haute on retourne `null` et l'appelant cache le bouton « Reprendre ».
 */
export function buildResumeUrl(
  currentUrl: string,
  currentNumber: number,
  targetNumber: number,
): string | null {
  if (currentNumber === targetNumber) return null;
  if (!Number.isFinite(currentNumber) || !Number.isFinite(targetNumber)) return null;
  if (currentNumber < 0 || targetNumber < 0) return null;

  const cur = String(currentNumber);
  const tgt = String(targetNumber);
  const kw = '(?:chapter|chapitre|chap|episode|épisode|episode|ep|ch)';

  const patterns: RegExp[] = [
    new RegExp(`(?<=${kw}[-_/])${cur}(?=[/?#&_-]|$)`, 'i'),
    new RegExp(`(?<=${kw}=)${cur}(?=[&#]|$)`, 'i'),
    new RegExp(`(?<=s\\d+e)${cur}(?=[/?#&_-]|$)`, 'i'),
  ];

  for (const re of patterns) {
    const match = re.exec(currentUrl);
    if (!match) continue;
    const start = match.index;
    return currentUrl.slice(0, start) + tgt + currentUrl.slice(start + cur.length);
  }

  try {
    const u = new URL(currentUrl);
    const parts = u.pathname.split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === cur) {
        parts[i] = tgt;
        u.pathname = parts.join('/');
        return u.toString();
      }
    }
  } catch {
    return null;
  }

  return null;
}
