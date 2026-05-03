export interface DetectionResult {
  siteId: string;
  kind: 'anime' | 'manga';
  url: string;
  slug?: string;
  episode?: number;
  chapter?: number;
  season?: number;
  title: string;
  seriesId?: string;
  seriesSlug?: string;
}
