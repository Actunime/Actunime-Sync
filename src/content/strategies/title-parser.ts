import { cleanScrapedTitle } from '../title-cleanup';

export interface TitleExtraction {
  title?: string;
  episode?: number;
  season?: number;
  matchedPattern?: string;
}

const SEP = '[-–—|:,]';

const PATTERNS: Array<{ name: string; re: RegExp; map: (m: RegExpExecArray) => TitleExtraction }> = [
  {
    name: 'Vol. X Ch. Y',
    re: new RegExp(
      `^(.+?)\\s*${SEP}?\\s*Vol(?:ume|\\.)?\\s*(\\d{1,3})\\s+Ch(?:ap(?:ter|itre|\\.)?|\\.)?\\s*(\\d{1,5}(?:\\.\\d+)?)`,
      'i',
    ),
    map: (m) => ({
      title: m[1].trim(),
      season: Number(m[2]),
      episode: Math.floor(Number(m[3])),
      matchedPattern: 'Vol. X Ch. Y',
    }),
  },
  {
    name: 'Ch. Y',
    re: new RegExp(
      `^(.+?)\\s*${SEP}?\\s*Ch(?:ap(?:ter|itre|\\.)?|\\.)?\\s*(\\d{1,5}(?:\\.\\d+)?)\\b`,
      'i',
    ),
    map: (m) => ({
      title: m[1].trim(),
      episode: Math.floor(Number(m[2])),
      matchedPattern: 'Ch. Y',
    }),
  },
  {
    name: 'Chapter Y',
    re: new RegExp(
      `^(.+?)\\s*${SEP}?\\s*(?:Chapter|Chapitre|Chap)\\s*(\\d{1,5}(?:\\.\\d+)?)`,
      'i',
    ),
    map: (m) => ({
      title: m[1].trim(),
      episode: Math.floor(Number(m[2])),
      matchedPattern: 'Chapter Y',
    }),
  },
  {
    name: 'Episode Y',
    re: new RegExp(
      `^(.+?)\\s*${SEP}?\\s*(?:Episode|Épisode|Ep\\.?)\\s*(\\d{1,5})`,
      'i',
    ),
    map: (m) => ({
      title: m[1].trim(),
      episode: Number(m[2]),
      matchedPattern: 'Episode Y',
    }),
  },
  {
    name: 'sXXeYY',
    re: /^(.+?)\s+s(\d{1,2})e(\d{1,4})\b/i,
    map: (m) => ({
      title: m[1].trim(),
      season: Number(m[2]),
      episode: Number(m[3]),
      matchedPattern: 'sXXeYY',
    }),
  },
  {
    name: 'N | Chapter M - Title',
    re: new RegExp(
      `^\\s*\\d+\\s*[|]\\s*(?:Chapter|Chapitre|Chap)\\s*(\\d{1,5}(?:\\.\\d+)?)\\s*[-–—:|]\\s*(.+)`,
      'i',
    ),
    map: (m) => ({
      title: m[2].trim(),
      episode: Math.floor(Number(m[1])),
      matchedPattern: 'N | Chapter M - Title',
    }),
  },
  {
    name: 'Chapter M - Title',
    re: new RegExp(
      `^\\s*(?:Chapter|Chapitre|Chap)\\s*(\\d{1,5}(?:\\.\\d+)?)\\s*[-–—:|]\\s*(.+)`,
      'i',
    ),
    map: (m) => ({
      title: m[2].trim(),
      episode: Math.floor(Number(m[1])),
      matchedPattern: 'Chapter M - Title',
    }),
  },
];

function isValidTitle(title: string): boolean {
  if (!title) return false;
  if (title.length < 3) return false;
  return /[a-zà-ÿ]{3,}/i.test(title);
}

export function extractFromText(raw: string): TitleExtraction | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(trimmed);
    if (!m) continue;
    const out = p.map(m);
    const cleaned = out.title ? cleanScrapedTitle(out.title) : undefined;
    if (!cleaned || !isValidTitle(cleaned)) continue;
    return {
      title: cleaned,
      episode: out.episode,
      season: out.season,
      matchedPattern: out.matchedPattern,
    };
  }
  return null;
}
