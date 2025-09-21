import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { MovieItem } from '../types';
import { getLogger } from '../logger';
import { fetchFirstImageFromGoogle, fallbackImageFromUnsplash, buildFallbackList } from '../imageSearch';
import SmartImage from '../components/SmartImage';
import ExtrasSwitcher from '../components/ExtrasSwitcher';
import { useGamificationStore } from '../gamification';
import type { TaskPathInfo } from '../taskUtils';

export const MoviesPage: React.FC = () => {
  const log = getLogger('MoviesPage');
  const [items, setItems] = useState<MovieItem[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});
  const enqueueManualCompletion = useGamificationStore((s) => s.enqueueManualCompletion);
  const removeManualCompletion = useGamificationStore((s) => s.removeManualCompletion);

  const buildCompletionId = (itemId: string, completedAt: number) => `movie:${itemId}:${completedAt}`;

  const buildCompletionInfo = (item: MovieItem, completionId: string): TaskPathInfo => ({
    id: completionId,
    title: item.title,
    status: 'done',
    dueDate: undefined,
    isActual: true,
    description: item.comment,
    priority: undefined,
    parentPath: ['Фильмы'],
    iconEmoji: '🎬',
  });

  const load = async () => {
    const all = await db.movies.orderBy('createdAt').reverse().toArray();
    setItems(all.filter((x) => x.status !== 'done'));
  };

  useEffect(() => { void load(); }, []);

  // On mount: try to autofill missing posters for existing items
  useEffect(() => {
    void (async () => {
      try {
        const list = await db.movies.toArray();
        const missing = list.filter((m) => !m.coverUrl);
        for (const m of missing) {
          const url = await fetchPoster(m.title);
          if (url) {
            await db.movies.update(m.id, { coverUrl: url });
          }
        }
        if (missing.length) {
          await load();
        }
      } catch (e) {
        log.warn('autofill_posters:error', e as Error);
      }
    })();
  }, []);

  const fetchPoster = async (t: string): Promise<string | undefined> => {
    try {
      const q = encodeURIComponent(t);
      const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=movie&limit=1`);
      const j = await r.json();
      const res = j.results?.[0];
      let art: string | undefined = res?.artworkUrl100 || res?.artworkUrl60;
      if (typeof art === 'string') {
        art = art.replace('http://', 'https://');
        // upscale to 600x600 if possible
        art = art.replace(/100x100bb\.jpg$/, '600x600bb.jpg');
        return art;
      }
    } catch (e) {
      log.warn('fetchPoster:error', e as Error);
    }
    // Fallback: Google Custom Search Image
    try {
      const alt = await fetchFirstImageFromGoogle(`${t} movie poster OR Фильм ${t}`);
      if (alt) return alt;
    } catch (e) {
      log.warn('fetchPoster:google_fallback_error', e as Error);
    }
    // Final fallback: Unsplash Source (no key required)
    return fallbackImageFromUnsplash(t);
  };

  const addItem = async () => {
    const t = title.trim();
    if (!t) return;
    setLoading(true);
    try {
      const id = uuidv4();
      const coverUrl = await fetchPoster(t);
      const item: MovieItem = { id, title: t, comment: comment.trim() || undefined, coverUrl, createdAt: Date.now(), status: 'active' };
      await db.movies.add(item);
      setTitle('');
      setComment('');
      await load();
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (id: string) => {
    await db.movies.delete(id);
    await load();
  };

  const toggleDone = async (m: MovieItem) => {
    const done = m.status === 'done';
    if (done) {
      await db.movies.update(m.id, { status: 'active', completedAt: undefined });
      if (typeof m.completedAt === 'number') {
        removeManualCompletion(buildCompletionId(m.id, m.completedAt));
      }
    } else {
      const completedAt = Date.now();
      await db.movies.update(m.id, { status: 'done', completedAt });
      const completionId = buildCompletionId(m.id, completedAt);
      const info = buildCompletionInfo(m, completionId);
      enqueueManualCompletion({ id: completionId, info, completedAt });
    }
    await load();
  };

  const setPosterFromFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const input = e.target;
    const id = input.getAttribute('data-id');
    const file = input.files?.[0];
    if (!id || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await db.movies.update(id, { coverUrl: String(reader.result) });
      setUrlEdits((s) => ({ ...s, [id]: '' }));
      await load();
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  const savePosterUrl = async (id: string) => {
    const u = (urlEdits[id] || '').trim();
    if (!u) return;
    await db.movies.update(id, { coverUrl: u });
    await load();
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" className="tool-link" aria-label="Назад к доске">← Назад к доске</Link>
          <h1 style={{ margin: 0 }}>Фильмы</h1>
        </div>
        <ExtrasSwitcher />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 680, marginBottom: 16 }}>
        <input placeholder="Название фильма" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => { void addItem(); }} disabled={loading}>Добавить</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map((m) => (
          <div key={m.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}>
            <SmartImage
              urls={buildFallbackList('movie', m.title, m.coverUrl)}
              alt={m.title}
              style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
              onResolved={(url) => {
                if (url && !url.startsWith('data:') && url !== m.coverUrl) {
                  void db.movies.update(m.id, { coverUrl: url });
                }
              }}
            />
            <div style={{ fontWeight: 700, color: '#000', marginBottom: 4 }}>{m.title}</div>
            {m.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{m.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                {m.status === 'done' ? <span className="badge">✅ Выполнено</span> : null}
                <button title="Постер" aria-label="Постер" onClick={() => setOpenControls((s) => ({ ...s, [m.id]: !s[m.id] }))}>🖼</button>
                <button title={m.status === 'done' ? 'Вернуть' : 'Выполнено'} aria-label={m.status === 'done' ? 'Вернуть' : 'Выполнено'} onClick={() => { void toggleDone(m); }}>{m.status === 'done' ? '↩️' : '✅'}</button>
                <button title="Удалить" aria-label="Удалить" onClick={() => { if (confirm('Удалить фильм?')) { void removeItem(m.id); } }}>🗑️</button>
              </div>
            </div>
            {openControls[m.id] ? (
              <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} placeholder="Постер (URL)" value={urlEdits[m.id] ?? ''} onChange={(e) => setUrlEdits((s) => ({ ...s, [m.id]: e.target.value }))} />
                  <button onClick={() => { void savePosterUrl(m.id); }}>Сохранить</button>
                </div>
                <div>
                  <label style={{ display: 'inline-block' }}>
                    <span style={{ marginRight: 8 }}>Загрузить файл</span>
                    <input data-id={m.id} type="file" accept="image/*" onChange={setPosterFromFile} />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MoviesPage;
