import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { BookItem } from '../types';
import { getLogger } from '../logger';

export const BooksPage: React.FC = () => {
  const log = getLogger('BooksPage');
  const [items, setItems] = useState<BookItem[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});

  const load = async () => {
    const all = await db.books.orderBy('createdAt').reverse().toArray();
    setItems(all);
  };

  useEffect(() => { void load(); }, []);

  const fetchBookCover = async (t: string): Promise<string | undefined> => {
    try {
      const q = encodeURIComponent(`intitle:${t}`);
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`);
      const j = await r.json();
      const vol = j.items?.[0]?.volumeInfo;
      const link = vol?.imageLinks?.thumbnail || vol?.imageLinks?.smallThumbnail;
      if (typeof link === 'string') {
        return link.replace('http://', 'https://');
      }
    } catch (e) {
      log.warn('fetchBookCover:error', e as Error);
    }
    return undefined;
  };

  const addItem = async () => {
    const t = title.trim();
    if (!t) return;
    setLoading(true);
    try {
      const id = uuidv4();
      const coverUrl = await fetchBookCover(t);
      const item: BookItem = { id, title: t, comment: comment.trim() || undefined, coverUrl, createdAt: Date.now() };
      await db.books.add(item);
      setTitle('');
      setComment('');
      await load();
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (id: string) => {
    await db.books.delete(id);
    await load();
  };

  const setCoverFromFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const input = e.target;
    const id = input.getAttribute('data-id');
    const file = input.files?.[0];
    if (!id || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await db.books.update(id, { coverUrl: String(reader.result) });
      setUrlEdits((s) => ({ ...s, [id]: '' }));
      await load();
    };
    reader.readAsDataURL(file);
    // allow re-selecting the same file later
    input.value = '';
  };

  const saveCoverUrl = async (id: string) => {
    const u = (urlEdits[id] || '').trim();
    if (!u) return;
    await db.books.update(id, { coverUrl: u });
    await load();
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/" className="tool-link" aria-label="Назад к доске">← Назад к доске</Link>
        <h1 style={{ margin: 0 }}>Книги</h1>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 680, marginBottom: 16 }}>
        <input placeholder="Название книги" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => { void addItem(); }} disabled={loading}>Добавить</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map((b) => (
          <div key={b.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}>
            {b.coverUrl ? (
              <img src={b.coverUrl} alt={b.title} style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }} />
            ) : (
              <div style={{ width: '100%', height: 260, background: '#f2f2f2', borderRadius: 6, marginBottom: 8, display: 'grid', placeItems: 'center' }}>Нет обложки</div>
            )}
            <div style={{ fontWeight: 700, color: '#000', marginBottom: 4 }}>{b.title}</div>
            {b.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{b.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(b.createdAt).toLocaleDateString()}</span>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                <button title="Обложка" aria-label="Обложка" onClick={() => setOpenControls((s) => ({ ...s, [b.id]: !s[b.id] }))}>🖼</button>
                <button onClick={() => { if (confirm('Удалить книгу?')) { void removeItem(b.id); } }}>Удалить</button>
              </div>
            </div>
            {openControls[b.id] ? (
              <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} placeholder="Обложка (URL)" value={urlEdits[b.id] ?? ''} onChange={(e) => setUrlEdits((s) => ({ ...s, [b.id]: e.target.value }))} />
                  <button onClick={() => { void saveCoverUrl(b.id); }}>Сохранить</button>
                </div>
                <div>
                  <label style={{ display: 'inline-block' }}>
                    <span style={{ marginRight: 8 }}>Загрузить файл</span>
                    <input data-id={b.id} type="file" accept="image/*" onChange={setCoverFromFile} />
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

export default BooksPage;
