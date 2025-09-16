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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.title}</div>
            {b.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{b.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(b.createdAt).toLocaleDateString()}</span>
              <button onClick={() => { if (confirm('Удалить книгу?')) { void removeItem(b.id); } }}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BooksPage;
