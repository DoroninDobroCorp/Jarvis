import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { MovieItem } from '../types';
import { getLogger } from '../logger';

export const MoviesPage: React.FC = () => {
  const log = getLogger('MoviesPage');
  const [items, setItems] = useState<MovieItem[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});

  const load = async () => {
    const all = await db.movies.orderBy('createdAt').reverse().toArray();
    setItems(all);
  };

  useEffect(() => { void load(); }, []);

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
    return undefined;
  };

  const addItem = async () => {
    const t = title.trim();
    if (!t) return;
    setLoading(true);
    try {
      const id = uuidv4();
      const coverUrl = await fetchPoster(t);
      const item: MovieItem = { id, title: t, comment: comment.trim() || undefined, coverUrl, createdAt: Date.now() };
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/" className="tool-link" aria-label="Назад к доске">← Назад к доске</Link>
        <h1 style={{ margin: 0 }}>Фильмы</h1>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 680, marginBottom: 16 }}>
        <input placeholder="Название фильма" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => { void addItem(); }} disabled={loading}>Добавить</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map((m) => (
          <div key={m.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}>
            {m.coverUrl ? (
              <img src={m.coverUrl} alt={m.title} style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }} />
            ) : (
              <div style={{ width: '100%', height: 260, background: '#f2f2f2', borderRadius: 6, marginBottom: 8, display: 'grid', placeItems: 'center' }}>Нет постера</div>
            )}
            <div style={{ fontWeight: 700, color: '#000', marginBottom: 4 }}>{m.title}</div>
            {m.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{m.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                <button title="Постер" aria-label="Постер" onClick={() => setOpenControls((s) => ({ ...s, [m.id]: !s[m.id] }))}>🖼</button>
                <button onClick={() => { if (confirm('Удалить фильм?')) { void removeItem(m.id); } }}>Удалить</button>
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
