import { db } from './db';
import { getLogger } from './logger';
import { fetchFirstImageFromGoogle, fetchFirstImageFromOpenverse, fallbackImageFromUnsplash } from './imageSearch';

const log = getLogger('coverBackfill');

function ensureHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
}

export async function resolveBookCover(title: string): Promise<string | undefined> {
  const s = title.replace(/^(книга|book)\s+/i, '').trim();
  // Google Books
  try {
    const q = encodeURIComponent(`intitle:${s}`);
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`);
    const j = await r.json();
    const vol = j?.items?.[0]?.volumeInfo;
    const link: string | undefined = vol?.imageLinks?.thumbnail || vol?.imageLinks?.smallThumbnail;
    if (link) return ensureHttps(link);
  } catch (e) {
    log.warn('book:google_books_error', e as Error);
  }
  // Openverse
  try {
    const ov = await fetchFirstImageFromOpenverse(`${s} book cover`);
    if (ov) return ov;
  } catch (e) {
    log.warn('book:openverse_error', e as Error);
  }
  // Google CSE
  try {
    const alt = await fetchFirstImageFromGoogle(`${s} book cover OR Книга ${s}`);
    if (alt) return alt;
  } catch (e) {
    log.warn('book:cse_error', e as Error);
  }
  return fallbackImageFromUnsplash(s);
}

export async function resolveMoviePoster(title: string): Promise<string | undefined> {
  // iTunes movies
  try {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=movie&limit=1`);
    const j = await r.json();
    let art: string | undefined = j?.results?.[0]?.artworkUrl100 || j?.results?.[0]?.artworkUrl60;
    if (art) {
      art = ensureHttps(art).replace(/100x100bb\.jpg$/, '600x600bb.jpg');
      return art;
    }
  } catch (e) {
    log.warn('movie:itunes_error', e as Error);
  }
  try {
    const ov = await fetchFirstImageFromOpenverse(`${title} movie poster`);
    if (ov) return ov;
  } catch (e) {
    log.warn('movie:openverse_error', e as Error);
  }
  try {
    const alt = await fetchFirstImageFromGoogle(`${title} movie poster OR Фильм ${title}`);
    if (alt) return alt;
  } catch (e) {
    log.warn('movie:cse_error', e as Error);
  }
  return fallbackImageFromUnsplash(title);
}

export async function resolveGameCover(title: string): Promise<string | undefined> {
  // iTunes software (apps)
  try {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=software&limit=1`);
    const j = await r.json();
    let art: string | undefined = j?.results?.[0]?.artworkUrl100 || j?.results?.[0]?.artworkUrl60;
    if (art) {
      art = ensureHttps(art).replace(/100x100bb\.png$/, '600x600bb.png').replace(/100x100bb\.jpg$/, '600x600bb.jpg');
      return art;
    }
  } catch (e) {
    log.warn('game:itunes_error', e as Error);
  }
  try {
    const ov = await fetchFirstImageFromOpenverse(`${title} game cover`);
    if (ov) return ov;
  } catch (e) {
    log.warn('game:openverse_error', e as Error);
  }
  try {
    const alt = await fetchFirstImageFromGoogle(`${title} game cover OR Игра ${title}`);
    if (alt) return alt;
  } catch (e) {
    log.warn('game:cse_error', e as Error);
  }
  return fallbackImageFromUnsplash(title);
}

export async function resolvePurchaseImage(title: string): Promise<string | undefined> {
  try {
    const s = title.replace(/^(покупка|товар|product)\s+/i, '').trim();
    const alt = await fetchFirstImageFromGoogle(`${s} product photo OR Товар ${s}`);
    if (alt) return alt;
  } catch (e) {
    log.warn('purchase:cse_error', e as Error);
  }
  try {
    const s = title.replace(/^(покупка|товар|product)\s+/i, '').trim();
    const ov = await fetchFirstImageFromOpenverse(`${s} product photo`);
    if (ov) return ov;
  } catch (e) {
    log.warn('purchase:openverse_error', e as Error);
  }
  return fallbackImageFromUnsplash(title);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function runCoverBackfill(limitPerKind = 50): Promise<void> {
  const start = Date.now();
  let updated = 0;
  try {
    // Books
    try {
      const books = await db.books.toArray();
      const missing = books.filter((b) => !b.coverUrl).slice(0, limitPerKind);
      for (const b of missing) {
        const url = await resolveBookCover(b.title);
        if (url) { await db.books.update(b.id, { coverUrl: url }); updated++; }
        await sleep(120);
      }
    } catch (e) { log.warn('backfill:books_error', e as Error); }
    // Movies
    try {
      const movies = await db.movies.toArray();
      const missing = movies.filter((m) => !m.coverUrl).slice(0, limitPerKind);
      for (const m of missing) {
        const url = await resolveMoviePoster(m.title);
        if (url) { await db.movies.update(m.id, { coverUrl: url }); updated++; }
        await sleep(120);
      }
    } catch (e) { log.warn('backfill:movies_error', e as Error); }
    // Games
    try {
      const games = await db.games.toArray();
      const missing = games.filter((g) => !g.coverUrl).slice(0, limitPerKind);
      for (const g of missing) {
        const url = await resolveGameCover(g.title);
        if (url) { await db.games.update(g.id, { coverUrl: url }); updated++; }
        await sleep(120);
      }
    } catch (e) { log.warn('backfill:games_error', e as Error); }
    // Purchases
    try {
      const purchases = await db.purchases.toArray();
      const missing = purchases.filter((p) => !p.coverUrl).slice(0, limitPerKind);
      for (const p of missing) {
        const url = await resolvePurchaseImage(p.title);
        if (url) { await db.purchases.update(p.id, { coverUrl: url }); updated++; }
        await sleep(120);
      }
    } catch (e) { log.warn('backfill:purchases_error', e as Error); }
  } finally {
    log.info('backfill:done', { updated, ms: Date.now() - start });
  }
}
