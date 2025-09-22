import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import type { TaskNode, BookItem, MovieItem, GameItem, PurchaseItem } from '../types';
import { getLogger } from '../logger';
import { db } from '../db';
import SmartImage from '../components/SmartImage';
import { buildFallbackList } from '../imageSearch';
import { useGamificationStore } from '../gamification';
import { ymd } from '../wellbeing';

type ManualCategory = 'book' | 'movie' | 'game' | 'purchase';

type ManualItem = BookItem | MovieItem | GameItem | PurchaseItem;

type CompletedEntry =
  | {
      kind: 'task';
      key: string;
      completedAt: number | null;
      xp?: number;
      node: TaskNode;
    }
  | {
      kind: 'manual';
      key: string;
      completedAt: number | null;
      xp?: number;
      category: ManualCategory;
      item: ManualItem;
    };

interface CompletedGroup {
  key: string;
  label: string;
  xp: number;
  entries: CompletedEntry[];
}

function xpBadgeValue(amount: number | undefined): string {
  if (typeof amount !== 'number') return 'XP: —';
  if (amount === 0) return 'XP: 0';
  return amount > 0 ? `XP: +${amount}` : `XP: ${amount}`;
}

const CompletedTasksPage: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
  const removeNode = useAppStore((s) => s.removeNode);
  const revealNode = useAppStore((s) => s.revealNode);
  const completions = useGamificationStore((s) => s.completions);
  const xpHistory = useGamificationStore((s) => s.xpHistory);
  const navigate = useNavigate();
  const log = getLogger('CompletedTasks');

  const [books, setBooks] = useState<BookItem[]>([]);
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);

  const completionByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    completions.forEach((info) => {
      map.set(info.id, info.xp);
    });
    return map;
  }, [completions]);

  const xpByDay = useMemo(() => {
    const map = new Map<string, number>();
    xpHistory.forEach((entry) => {
      const key = ymd(new Date(entry.ts));
      const prev = map.get(key) ?? 0;
      map.set(key, prev + entry.amount);
    });
    return map;
  }, [xpHistory]);

  const manualXpAmount = useCallback((category: ManualCategory, item: ManualItem) => {
    if (typeof item.completedAt !== 'number') return undefined;
    const key = `${category}:${item.id}:${item.completedAt}`;
    return completionByTaskId.get(key);
  }, [completionByTaskId]);

  const doneTasks = useMemo(() => {
    return nodes
      .filter((n): n is TaskNode => n.type === 'task' && n.status === 'done')
      .slice()
      .sort((a, b) => {
        const at = typeof a.completedAt === 'number' ? a.completedAt : a.updatedAt ?? 0;
        const bt = typeof b.completedAt === 'number' ? b.completedAt : b.updatedAt ?? 0;
        return bt - at;
      });
  }, [nodes]);

  useEffect(() => {
    log.info('doneTasks:update', { count: doneTasks.length });
  }, [doneTasks.length, log]);

  useEffect(() => {
    void (async () => {
      const [b, m, g, p] = await Promise.all([
        db.books.toArray(),
        db.movies.toArray(),
        db.games.toArray(),
        db.purchases.toArray().catch(() => [] as PurchaseItem[]),
      ]);
      setBooks(b.filter((x) => x.status === 'done'));
      setMovies(m.filter((x) => x.status === 'done'));
      setGames(g.filter((x) => x.status === 'done'));
      setPurchases(p.filter((x) => x.status === 'done'));
    })();
  }, []);

  const combinedEntries = useMemo(() => {
    const entries: CompletedEntry[] = [];

    doneTasks.forEach((task) => {
      const completedAt = typeof task.completedAt === 'number'
        ? task.completedAt
        : typeof task.updatedAt === 'number'
          ? task.updatedAt
          : task.createdAt ?? null;
      entries.push({
        kind: 'task',
        key: `task:${task.id}`,
        completedAt,
        xp: completionByTaskId.get(task.id),
        node: task,
      });
    });

    const manualCollections: Array<{ category: ManualCategory; items: ManualItem[] }> = [
      { category: 'book', items: books },
      { category: 'movie', items: movies },
      { category: 'game', items: games },
      { category: 'purchase', items: purchases },
    ];

    manualCollections.forEach(({ category, items }) => {
      items.forEach((item) => {
        const completedAt = typeof item.completedAt === 'number' ? item.completedAt : item.createdAt ?? null;
        entries.push({
          kind: 'manual',
          key: `${category}:${item.id}`,
          completedAt,
          xp: manualXpAmount(category, item),
          category,
          item,
        });
      });
    });

    return entries.sort((a, b) => {
      const at = a.completedAt ?? 0;
      const bt = b.completedAt ?? 0;
      return bt - at;
    });
  }, [books, movies, games, purchases, doneTasks, manualXpAmount]);

  const groups: CompletedGroup[] = useMemo(() => {
    const map = new Map<string, CompletedEntry[]>();
    combinedEntries.forEach((entry) => {
      // Use local date key (YYYY-MM-DD) to avoid UTC shifting to previous day
      const key = entry.completedAt ? ymd(new Date(entry.completedAt)) : '__NO_DATE__';
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    });
    const keys = Array.from(map.keys());
    const dateMs = (s: string) => {
      const [yy, mm, dd] = s.split('-').map(Number);
      return new Date(yy, (mm || 1) - 1, dd || 1).getTime();
    };
    keys.sort((a, b) => {
      if (a === '__NO_DATE__') return 1;
      if (b === '__NO_DATE__') return -1;
      return dateMs(b) - dateMs(a);
    });
    return keys.map((key) => {
      const entries = (map.get(key) ?? []).slice().sort((a, b) => {
        const at = a.completedAt ?? 0;
        const bt = b.completedAt ?? 0;
        return bt - at;
      });
      const isNoDate = key === '__NO_DATE__';
      const label = isNoDate
        ? 'Без даты'
        : (() => {
            const [yy, mm, dd] = key.split('-').map(Number);
            const d = new Date(yy, (mm || 1) - 1, dd || 1);
            return d.toLocaleDateString('ru-RU', {
              weekday: 'short',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            });
          })();
      const xp = isNoDate
        ? entries.reduce((sum, entry) => sum + (entry.xp ?? 0), 0)
        : xpByDay.get(key) ?? 0;
      return { key, label, xp, entries };
    });
  }, [combinedEntries, xpByDay]);

  async function handleDeleteManual(category: ManualCategory, id: string) {
    const confirmMsg = 'Удалить элемент навсегда?';
    if (!window.confirm(confirmMsg)) return;
    if (category === 'book') {
      await db.books.delete(id);
      setBooks((arr) => arr.filter((item) => item.id !== id));
    } else if (category === 'movie') {
      await db.movies.delete(id);
      setMovies((arr) => arr.filter((item) => item.id !== id));
    } else if (category === 'game') {
      await db.games.delete(id);
      setGames((arr) => arr.filter((item) => item.id !== id));
    } else {
      await db.purchases.delete(id);
      setPurchases((arr) => arr.filter((item) => item.id !== id));
    }
  }

  return (
    <div className="active-page">
      <div className="active-page__header">
        <Link to="/" className="tool-link" title="Назад к доске" aria-label="Назад к доске">← Назад к доске</Link>
        <h2>Выполненное</h2>
      </div>
      <div
        className="active-list"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}
      >
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            <div
              style={{
                gridColumn: '1 / -1',
                borderTop: '1px solid #ccc',
                margin: '16px 0 8px',
                position: 'relative',
                paddingTop: 6,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: -12,
                  left: 0,
                  background: '#fff',
                  padding: '0 8px',
                  fontSize: 12,
                  color: '#555',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{group.label}</span>
                <span className="badge" style={{ background: group.xp >= 0 ? '#e6f4ea' : '#fdebea', color: group.xp >= 0 ? '#246b35' : '#a13737' }}>
                  {xpBadgeValue(group.xp)}
                </span>
              </span>
            </div>
            {group.entries.map((entry) => {
              const completedAt = entry.completedAt;
              const timeLabel = typeof completedAt === 'number'
                ? new Date(completedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                : null;
              if (entry.kind === 'task') {
                const task = entry.node;
                return (
                  <div
                    key={entry.key}
                    className="active-item"
                    data-item-type="task"
                    data-xp-amount={typeof entry.xp === 'number' ? entry.xp : 'none'}
                    title={task.description || task.title}
                    aria-label={task.title}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="badge">Задача</span>
                      <span className="badge" style={{ background: entry.xp && entry.xp < 0 ? '#fdebea' : '#e6f4ea', color: entry.xp && entry.xp < 0 ? '#a13737' : '#246b35' }}>
                        {xpBadgeValue(entry.xp)}
                      </span>
                    </div>
                    <div className="active-item__title">{task.title}</div>
                    {task.description ? <div className="active-item__desc">{task.description}</div> : null}
                    {Array.isArray(task.subtasks) && task.subtasks.length > 0 ? (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {task.subtasks.map((s) => (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                            <input type="checkbox" checked={!!s.done} readOnly />
                            <span style={{ textDecoration: s.done ? 'line-through' : undefined }}>{s.title}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="active-item__meta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      {timeLabel ? <span className="badge">⏱ {timeLabel}</span> : null}
                      <button
                        className="tool-btn"
                        title="Открыть на доске"
                        aria-label="Открыть на доске"
                        onClick={() => { revealNode(task.id); navigate('/'); }}
                      >
                        🔍
                      </button>
                      <button
                        className="tool-btn"
                        title="Удалить"
                        aria-label="Удалить"
                        onClick={async () => {
                          if (window.confirm('Удалить задачу навсегда?')) {
                            await removeNode(task.id);
                          }
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              }

              const { item, category, xp } = entry;
              const labelMap: Record<ManualCategory, string> = {
                book: 'Книга',
                movie: 'Фильм',
                game: 'Игра',
                purchase: 'Покупка',
              };
              return (
                <div
                  key={entry.key}
                  className="active-item"
                  data-item-type={category}
                  data-xp-amount={typeof xp === 'number' ? xp : 'none'}
                  title={item.comment || item.title}
                  aria-label={item.title}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="badge">{labelMap[category]}</span>
                    <span className="badge" style={{ background: xp && xp < 0 ? '#fdebea' : '#e6f4ea', color: xp && xp < 0 ? '#a13737' : '#246b35' }}>
                      {xpBadgeValue(xp)}
                    </span>
                  </div>
                  <SmartImage
                    urls={buildFallbackList(category, item.title, item.coverUrl)}
                    alt={item.title}
                    style={{ width: '100%', height: 212, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
                  />
                  <div className="active-item__title">{item.title}</div>
                  {item.comment ? <div className="active-item__desc">{item.comment}</div> : null}
                  <div className="active-item__meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    {timeLabel ? <span className="badge">⏱ {timeLabel}</span> : null}
                    <button
                      className="tool-btn"
                      title="Удалить"
                      aria-label="Удалить"
                      onClick={() => { void handleDeleteManual(category, item.id); }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
        {combinedEntries.length === 0 ? <div className="empty" style={{ gridColumn: '1 / -1' }}>Нет выполненных элементов</div> : null}
      </div>
    </div>
  );
};

export default CompletedTasksPage;
