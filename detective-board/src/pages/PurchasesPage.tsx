import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { PurchaseItem } from '../types';
import { getLogger } from '../logger';
import { fetchFirstImageFromGoogle, fallbackImageFromUnsplash, buildFallbackList, fetchFirstImageFromOpenverse } from '../imageSearch';
import SmartImage from '../components/SmartImage';
import ExtrasSwitcher from '../components/ExtrasSwitcher';
import { useGamificationStore } from '../gamification';
import type { TaskPathInfo } from '../taskUtils';

export const PurchasesPage: React.FC = () => {
  const log = getLogger('PurchasesPage');
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});
  const enqueueManualCompletion = useGamificationStore((s) => s.enqueueManualCompletion);
  const removeManualCompletion = useGamificationStore((s) => s.removeManualCompletion);

  const buildCompletionId = (itemId: string, completedAt: number) => `purchase:${itemId}:${completedAt}`;

  const buildCompletionInfo = (item: PurchaseItem, completionId: string): TaskPathInfo => ({
    id: completionId,
    title: item.title,
    status: 'done',
    dueDate: undefined,
    isActual: true,
    description: item.comment,
    priority: undefined,
    parentPath: ['Покупки'],
    iconEmoji: '🛍️',
  });

  const load = async () => {
    const all = await db.purchases.orderBy('createdAt').reverse().toArray();
    setItems(all.filter((x) => x.status !== 'done'));
  };

  useEffect(() => { void load(); }, []);

  // Автозаполнение отсутствующих картинок при монтировании
  useEffect(() => {
    void (async () => {
      try {
        const list = await db.purchases.toArray();
        const missing = list.filter((p) => !p.coverUrl);
        for (const p of missing) {
          const url = await fetchProductImage(p.title);
          if (url) {
            await db.purchases.update(p.id, { coverUrl: url });
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

  const fetchProductImage = async (t: string): Promise<string | undefined> => {
    try {
      const s = t.replace(/^(покупка|товар|product)\s+/i, '').trim();
      const alt = await fetchFirstImageFromGoogle(`${s} product photo OR Товар ${s}`);
      if (alt) return alt;
    } catch (e) {
      log.warn('fetchProductImage:error', e as Error);
    }
    try {
      const s = t.replace(/^(покупка|товар|product)\s+/i, '').trim();
      const ov = await fetchFirstImageFromOpenverse(`${s} product photo`);
      if (ov) return ov;
    } catch (e) {
      log.warn('fetchProductImage:openverse_error', e as Error);
    }
    return fallbackImageFromUnsplash(t);
  };

  const addItem = async () => {
    const t = title.trim();
    if (!t) return;
    setLoading(true);
    try {
      const id = uuidv4();
      const coverUrl = await fetchProductImage(t);
      const item: PurchaseItem = { id, title: t, comment: comment.trim() || undefined, coverUrl, createdAt: Date.now(), status: 'active' };
      await db.purchases.add(item);
      setTitle('');
      setComment('');
      await load();
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (id: string) => {
    await db.purchases.delete(id);
    await load();
  };

  const toggleDone = async (p: PurchaseItem) => {
    const done = p.status === 'done';
    if (done) {
      await db.purchases.update(p.id, { status: 'active', completedAt: undefined });
      if (typeof p.completedAt === 'number') {
        removeManualCompletion(buildCompletionId(p.id, p.completedAt));
      }
    } else {
      const completedAt = Date.now();
      await db.purchases.update(p.id, { status: 'done', completedAt });
      const completionId = buildCompletionId(p.id, completedAt);
      const info = buildCompletionInfo(p, completionId);
      enqueueManualCompletion({ id: completionId, info, completedAt });
    }
    await load();
  };

  const setCoverFromFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const input = e.target;
    const id = input.getAttribute('data-id');
    const file = input.files?.[0];
    if (!id || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await db.purchases.update(id, { coverUrl: String(reader.result) });
      setUrlEdits((s) => ({ ...s, [id]: '' }));
      await load();
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  const saveCoverUrl = async (id: string) => {
    const u = (urlEdits[id] || '').trim();
    if (!u) return;
    await db.purchases.update(id, { coverUrl: u });
    await load();
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" className="tool-link" aria-label="Назад к доске">← Назад к доске</Link>
          <h1 style={{ margin: 0 }}>Покупки</h1>
        </div>
        <ExtrasSwitcher />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 680, marginBottom: 16 }}>
        <input placeholder="Что купить" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => { void addItem(); }} disabled={loading}>Добавить</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map((p) => (
          <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}>
            <SmartImage
              urls={buildFallbackList('purchase', p.title, p.coverUrl)}
              alt={p.title}
              query={!p.coverUrl ? `${p.title} product photo` : undefined}
              style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
              onResolved={(url) => {
                if (url && !url.startsWith('data:') && url !== p.coverUrl) {
                  void db.purchases.update(p.id, { coverUrl: url });
                }
              }}
            />
            <div style={{ fontWeight: 700, color: '#000', marginBottom: 4 }}>{p.title}</div>
            {p.comment ? <div style={{ color: '#555', marginBottom: 8 }}>{p.comment}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(p.createdAt).toLocaleDateString()}</span>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                {p.status === 'done' ? <span className="badge">✅ Выполнено</span> : null}
                <button title="Обложка" aria-label="Обложка" onClick={() => setOpenControls((s) => ({ ...s, [p.id]: !s[p.id] }))}>🖼</button>
                <button title={p.status === 'done' ? 'Вернуть' : 'Выполнено'} aria-label={p.status === 'done' ? 'Вернуть' : 'Выполнено'} onClick={() => { void toggleDone(p); }}>{p.status === 'done' ? '↩️' : '✅'}</button>
                <button title="Удалить" aria-label="Удалить" onClick={() => { if (confirm('Удалить покупку?')) { void removeItem(p.id); } }}>🗑️</button>
              </div>
            </div>
            {openControls[p.id] ? (
              <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} placeholder="Обложка (URL)" value={urlEdits[p.id] ?? ''} onChange={(e) => setUrlEdits((s) => ({ ...s, [p.id]: e.target.value }))} />
                  <button onClick={() => { void saveCoverUrl(p.id); }}>Сохранить</button>
                </div>
                <div>
                  <label style={{ display: 'inline-block' }}>
                    <span style={{ marginRight: 8 }}>Загрузить файл</span>
                    <input data-id={p.id} type="file" accept="image/*" onChange={setCoverFromFile} />
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

export default PurchasesPage;
