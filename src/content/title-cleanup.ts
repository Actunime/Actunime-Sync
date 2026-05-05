/**
 * Nettoyage agressif d'un titre scrapé (depuis `og:title`, `<title>`, JSON-LD,
 * sélecteur DOM…). Vise à isoler le **titre de série** propre de tout le bruit
 * que les sites de streaming collent autour : numéro de saison/épisode, langue,
 * qualité, mots-clés SEO, suffixe nom du site.
 *
 * Stratégie en 3 passes :
 *  1. **Couper à partir du 1er mot-bruit reconnu** (« Saison N », « Épisode N »,
 *     « S1E2 », « Streaming », « VOSTFR », « HD », etc.). C'est ce qui fait la
 *     majorité du boulot — la plupart des sites mettent le titre AVANT le bruit.
 *  2. **Retirer les préfixes SEO** (« Regarder », « Watch », « Voir »…).
 *  3. **Retirer le suffixe site** (« - Crunchyroll », « | 9animeTV »…) si il
 *     reste après la pass 1.
 *
 * Exemples :
 *   « The Angel Next Door Spoils Me Rotten Saison 1 Épisode 1 Streaming VOSTFR »
 *     → « The Angel Next Door Spoils Me Rotten »
 *   « Regarder Naruto en HD - 9animeTV »
 *     → « Naruto »
 *   « One Piece - Episode 1078 - VOSTFR »
 *     → « One Piece »
 */

/**
 * Mots-clés qui marquent le début du « bruit » dans un titre scrapé.
 * Critère commun : ils apparaissent SYSTÉMATIQUEMENT après le titre de série,
 * jamais dans le titre lui-même (sauf rares faux positifs acceptés).
 *
 * Les motifs Saison/Épisode/Ep/SxEy exigent un nombre derrière pour ne pas
 * couper « Code Saison: la nouvelle ère » au mot « Saison ».
 */
const NOISE_START_PATTERNS = [
  // Saison N / Season N / S1E2 / S01 — exigent un nombre
  /\b(?:saison|season)\s*\d+/i,
  /\b(?:épisode|episode|ep)\.?\s*\d+/i,
  /\b(?:chapter|chapitre|chap)\.?\s*\d+(?:\.\d+)?/i,
  /\bch\.\s*\d+(?:\.\d+)?/i,
  /\bvol(?:ume|\.)?\s*\d+/i,
  /\bs\d{1,2}(?:e\d{1,4})?\b/i,
  // Mots-clés langue/qualité/streaming — assez spécifiques pour couper sans nombre
  /\b(?:vostfr|vost|vf|vostfr-vf|sub|subbed|dub|dubbed)\b/i,
  /\b(?:streaming|stream|en\s+ligne|gratuit(?:ement)?|complet|complete|full|hd|fullhd|4k|1080p|720p|480p)\b/i,
];

const SEO_PREFIXES =
  /^(?:Regarder|Voir|Watch|Lire|Read)\s+(?:gratuitement\s+|en\s+ligne\s+|online\s+|free\s+)?/i;

/**
 * Suffixe « - SiteName » / « | SiteName » / « · SiteName ». Le segment final
 * doit être assez court (≤ 30 caractères) pour ne pas grignoter un vrai
 * fragment du titre.
 */
const SITE_SUFFIX = /\s*[\-|·•–—]\s*[A-Za-z0-9.][^\-|·•–—]{0,30}\s*$/u;

/**
 * Mots de bruit SEO que les sites collent en fin de titre (« X Manga »,
 * « Y Online », « Z Free »…). Retiré itérativement tant qu'il reste assez
 * de mots avant.
 */
const TRAILING_NOISE =
  /\s+(?:manga|manhwa|manhua|webtoon|webcomic|anime|comic|novel|online|free|read|gratuit|gratuitement)\s*[,.]?\s*$/i;

export function cleanScrapedTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return '';

  // Pass 1 — coupe à la première occurrence de bruit
  let earliest = -1;
  for (const re of NOISE_START_PATTERNS) {
    const m = re.exec(t);
    if (m && m.index >= 0 && (earliest < 0 || m.index < earliest)) {
      earliest = m.index;
    }
  }
  if (earliest > 0) {
    t = t.slice(0, earliest).trim();
    // Retire un éventuel séparateur résiduel en queue
    t = t.replace(/[\s\-|·•–—:]+$/u, '').trim();
  }

  // Pass 2 — préfixes SEO
  for (let i = 0; i < 2; i++) {
    const before = t;
    t = t.replace(SEO_PREFIXES, '').trim();
    if (t === before) break;
  }

  // Pass 3 — suffixe « - SiteName » (uniquement si la pass 1 n'a pas déjà coupé,
  // sinon le segment résiduel est probablement le vrai titre déjà propre).
  const beforeSiteCut = t;
  const cut = t.replace(SITE_SUFFIX, '').trim();
  if (cut.length >= 3 && cut.length >= beforeSiteCut.length * 0.5) {
    t = cut;
  }

  // Pass 4 — strip itératif des suffixes SEO/catégorisation
  // (« Manga Online », « Manhwa Free »…) tant qu'il reste ≥ 2 mots avant.
  for (let i = 0; i < 4; i++) {
    const stripped = t.replace(TRAILING_NOISE, '').trim();
    if (stripped === t) break;
    if (!stripped || stripped.split(/\s+/).length < 2) break;
    t = stripped;
  }

  return t.trim();
}
