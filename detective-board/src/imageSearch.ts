import { getLogger } from './logger';

const log = getLogger('imageSearch');

interface CSEImageItem {
  link?: string;
  image?: {
    thumbnailLink?: string;
  };
}

interface CSEApiResponse {
  items?: CSEImageItem[];
}

/**
 * Unsplash Source fallback (no API key required). Returns a URL that redirects
 * to a random image relevant to the query. We keep size at 600x600 to match UI.
 */
export function fallbackImageFromUnsplash(query: string, w = 600, h = 600): string {
  const q = encodeURIComponent(query);
  return `https://source.unsplash.com/${w}x${h}/?${q}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function placeholderDataUri(text: string, w = 600, h = 600): string {
  const safe = xmlEscape(text);
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#f2f2f2'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='24' fill='#888'>${safe}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function buildFallbackList(kind: 'book' | 'game' | 'movie' | 'purchase', title: string, existing?: string): string[] {
  const list: string[] = [];
  if (existing) list.push(existing);
  const t = title.trim();
  if (kind === 'book') {
    list.push(
      fallbackImageFromUnsplash(`${t} book cover`),
      fallbackImageFromUnsplash(`Книга ${t}`),
      fallbackImageFromUnsplash(t),
      fallbackImageFromUnsplash('book cover')
    );
  } else if (kind === 'game') {
    list.push(
      fallbackImageFromUnsplash(`${t} game cover`),
      fallbackImageFromUnsplash(`Игра ${t}`),
      fallbackImageFromUnsplash(t),
      fallbackImageFromUnsplash('video game cover')
    );
  } else if (kind === 'movie') {
    list.push(
      fallbackImageFromUnsplash(`${t} movie poster`),
      fallbackImageFromUnsplash(`Фильм ${t}`),
      fallbackImageFromUnsplash(t),
      fallbackImageFromUnsplash('movie poster')
    );
  } else {
    // purchase
    list.push(
      fallbackImageFromUnsplash(`${t} product photo`),
      fallbackImageFromUnsplash(`Товар ${t}`),
      fallbackImageFromUnsplash(t),
      fallbackImageFromUnsplash('shopping product')
    );
  }
  list.push(placeholderDataUri('Нет изображения'));
  // remove duplicates
  return Array.from(new Set(list));
}

/**
 * Fetch first image URL from Google Custom Search (Image) API.
 * Requires VITE_GOOGLE_CSE_KEY and VITE_GOOGLE_CSE_CX to be set in env.
 * Returns https URL or undefined if not found/failed.
 */
export async function fetchFirstImageFromGoogle(query: string): Promise<string | undefined> {
  try {
    // Try cache first (7 days)
    const cacheKey = `img:cse:${query.toLowerCase()}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const obj = JSON.parse(raw) as { url: string; ts: number };
        const ageDays = (Date.now() - obj.ts) / (1000 * 60 * 60 * 24);
        if (obj.url && ageDays <= 7) {
          return obj.url;
        }
      }
    } catch { /* noop */ }

    const key = import.meta.env.VITE_GOOGLE_CSE_KEY as string | undefined;
    const cx = import.meta.env.VITE_GOOGLE_CSE_CX as string | undefined;
    if (!key || !cx) {
      log.warn('Google CSE is not configured (VITE_GOOGLE_CSE_KEY / VITE_GOOGLE_CSE_CX)');
      return undefined;
    }
    const q = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?searchType=image&num=1&safe=active&q=${q}&key=${key}&cx=${cx}`;
    const r = await fetch(url);
    if (!r.ok) {
      log.warn('CSE:bad_status', { status: r.status });
      return undefined;
    }
    const j: CSEApiResponse = await r.json();
    const link: string | undefined = j?.items?.[0]?.link || j?.items?.[0]?.image?.thumbnailLink;
    if (typeof link === 'string' && link) {
      const httpsUrl = link.replace('http://', 'https://');
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ url: httpsUrl, ts: Date.now() }));
      } catch { /* noop */ }
      return httpsUrl;
    }
  } catch (e) {
    log.warn('CSE:error', e as Error);
  }
  return undefined;
}
