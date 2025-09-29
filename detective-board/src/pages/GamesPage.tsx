import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { GameItem } from '../types';
import { getLogger } from '../logger';
import { buildFallbackList } from '../imageSearch';
import SmartImage from '../components/SmartImage';
import ExtrasSwitcher from '../components/ExtrasSwitcher';
import { useGamificationStore } from '../gamification';
import type { TaskPathInfo } from '../taskUtils';
import { resolveGameCover } from '../coverBackfill';

export const GamesPage: React.FC = () => {
  const log = getLogger('GamesPage');
  const [items, setItems] = useState<GameItem[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});
  const enqueueManualCompletion = useGamificationStore((s) => s.enqueueManualCompletion);
  const removeManualCompletion = useGamificationStore((s) => s.removeManualCompletion);

  const buildCompletionId = (itemId: string, completedAt: number) => `game:${itemId}:${completedAt}`;

  const buildCompletionInfo = (item: GameItem, completionId: string): TaskPathInfo => ({
    id: completionId,
    title: item.title,
    status: 'done',
    dueDate: undefined,
    isActual: true,
    description: item.comment,
    priority: undefined,
    parentPath: ['Игры'],
    iconEmoji: '🎮',
  });

  const load = async () => {
    const all = await db.games.orderBy('createdAt').reverse().toArray();
    setItems(all.filter((x) => x.status !== 'done'));
  };

  useEffect(() => { void load(); }, []);

  // On mount: try to autofill missing covers for existing items
  useEffect(() => {
    void (async () => {
      try {
        const list = await db.games.toArray();
        const missing = list.filter((g) => {
          const url = typeof g.coverUrl === 'string' ? g.coverUrl.trim() : '';
          return !url || url.startsWith('data:');
        });
        for (const g of missing) {
          const url = await resolveGameCover(g.title);
          if (url) {
            await db.games.update(g.id, { coverUrl: url });
          }
        }
        if (missing.length) {
          await load();
        }
      } catch (e) {
        log.warn('autofill_covers:error', e as Error);
      }
    })();
  }, []);

  const addItem = async () => {
    const t = title.trim();
    if (!t) return;
    setLoading(true);
    try {
      const id = uuidv4();
      const coverUrl = await resolveGameCover(t);
      const item: GameItem = { id, title: t, comment: comment.trim() || undefined, coverUrl, createdAt: Date.now(), status: 'active' };
      await db.games.add(item);
      setTitle('');
      setComment('');
      await load();
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (id: string) => {
    await db.games.delete(id);
    await load();
  };

  const toggleDone = async (g: GameItem) => {
    const done = g.status === 'done';
    if (done) {
      await db.games.update(g.id, { status: 'active', completedAt: undefined });
      if (typeof g.completedAt === 'number') {
        removeManualCompletion(buildCompletionId(g.id, g.completedAt));
      }
    } else {
      const completedAt = Date.now();
      await db.games.update(g.id, { status: 'done', completedAt });
      const completionId = buildCompletionId(g.id, completedAt);
      const info = buildCompletionInfo(g, completionId);
      enqueueManualCompletion({ id: completionId, info, completedAt });
    }
  };

  const setCoverFromFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const input = e.target;
    const id = input.getAttribute('data-id');
    const file = input.files?.[0];
    if (!id || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await db.games.update(id, { coverUrl: String(reader.result) });
      setUrlEdits((s) => ({ ...s, [id]: '' }));
      await load();
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  const saveCoverUrl = async (id: string) => {
    const u = (urlEdits[id] || '').trim();
    if (!u) return;
    await db.games.update(id, { coverUrl: u });
    await load();
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" className="tool-link" aria-label="Назад к доске">← Назад к доске</Link>
          <h1 style={{ margin: 0 }}>Игры</h1>
        </div>
        <ExtrasSwitcher />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 680, marginBottom: 16 }}>
        <input placeholder="Название игры" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => { void addItem(); }} disabled={loading}>Добавить</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map((g) => (
          <div key={g.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}>
            <SmartImage
              urls={buildFallbackList('game', g.title, g.coverUrl)}
              alt={g.title}
              query={(!g.coverUrl || (g.coverUrl || '').startsWith('data:')) ? `${g.title} game cover` : undefined}
              style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
              onResolved={(url) => {
                if (url && !url.startsWith('data:') && url !== g.coverUrl) {
                  void db.games.update(g.id, { coverUrl: url });
                }
              }}
            />
            <div style={{ fontWeight: 700, color: '#000', marginBottom: 4 }}>{g.title}</div>
            {g.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{g.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(g.createdAt).toLocaleDateString()}</span>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                {g.status === 'done' ? <span className="badge">✅ Выполнено</span> : null}
                <button title="Обложка" aria-label="Обложка" onClick={() => setOpenControls((s) => ({ ...s, [g.id]: !s[g.id] }))}>🖼</button>
                <button title={g.status === 'done' ? 'Вернуть' : 'Выполнено'} aria-label={g.status === 'done' ? 'Вернуть' : 'Выполнено'} onClick={() => { void toggleDone(g); }}>{g.status === 'done' ? '↩️' : '✅'}</button>
                <button title="Удалить" aria-label="Удалить" onClick={() => { if (confirm('Удалить игру?')) { void removeItem(g.id); } }}>🗑️</button>
              </div>
            </div>
            {openControls[g.id] ? (
              <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} placeholder="Обложка (URL)" value={urlEdits[g.id] ?? ''} onChange={(e) => setUrlEdits((s) => ({ ...s, [g.id]: e.target.value }))} />
                  <button onClick={() => { void saveCoverUrl(g.id); }}>Сохранить</button>
                </div>
                <div>
                  <label style={{ display: 'inline-block' }}>
                    <span style={{ marginRight: 8 }}>Загрузить файл</span>
                    <input data-id={g.id} type="file" accept="image/*" onChange={setCoverFromFile} />
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

export default GamesPage;
