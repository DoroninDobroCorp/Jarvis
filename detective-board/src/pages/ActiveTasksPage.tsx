import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import type { TaskNode, Recurrence } from '../types';
import { getLogger } from '../logger';
import { computeNextDueDate } from '../recurrence';

export const ActiveTasksPage: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
  const updateNode = useAppStore((s) => s.updateNode);
  const addTask = useAppStore((s) => s.addTask);
  const revealNode = useAppStore((s) => s.revealNode);
  const navigate = useNavigate();
  const log = getLogger('ActiveTasks');

  // Inline edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editDesc, setEditDesc] = useState<string>('');

  const activeTasks = useMemo(() => {
    const prioRank = (p: TaskNode['priority'] | undefined) => (
      p === 'high' ? 0 : p === 'med' ? 1 : p === 'low' ? 2 : 3
    );
    return nodes
      .filter((n): n is TaskNode => n.type === 'task' && (n.status === 'in_progress' || n.status === 'active'))
      .slice()
      .sort((a, b) => {
        const ay = a.dueDate ? a.dueDate.slice(0, 10) : '9999-12-31';
        const by = b.dueDate ? b.dueDate.slice(0, 10) : '9999-12-31';
        if (ay !== by) return ay.localeCompare(by); // сначала по дате (день)
        // одинаковый день: по времени (если указано)
        const at = a.dueDate ? new Date(a.dueDate).getTime() % 86400000 : 0;
        const bt = b.dueDate ? new Date(b.dueDate).getTime() % 86400000 : 0;
        if (at !== bt) return at - bt;
        // дальше по приоритету
        const ap = prioRank(a.priority);
        const bp = prioRank(b.priority);
        if (ap !== bp) return ap - bp;
        // стабилизация по названию
        return (a.title || '').localeCompare(b.title || '');
      });
  }, [nodes]);

  const grouped = useMemo(() => {
    const groups = new Map<string, TaskNode[]>();
    const order: string[] = [];
    activeTasks.forEach((t) => {
      const key = t.dueDate ? t.dueDate.slice(0, 10) : '__NO_DATE__';
      const arr = groups.get(key) || [];
      arr.push(t);
      groups.set(key, arr);
      if (!order.includes(key)) order.push(key);
    });
    const dateKeys = order.filter((k) => k !== '__NO_DATE__'); // порядок как в отсортированных задачах
    const result: Array<{ key: string; label: string; tasks: TaskNode[] }> = [];
    dateKeys.forEach((k) => {
      const d = new Date(k + 'T00:00:00Z'); // UTC, чтобы не прыгать из-за TZ
      const label = d.toLocaleDateString('ru-RU', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
      result.push({ key: k, label, tasks: groups.get(k)! });
    });
    if (groups.has('__NO_DATE__')) {
      result.push({ key: '__NO_DATE__', label: 'Без срока', tasks: groups.get('__NO_DATE__')! });
    }
    return result;
  }, [activeTasks]);

  const groupPathById = useMemo(() => {
    const pathMap = new Map<string, string>();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    const resolvePath = (groupId: string): string => {
      const cached = pathMap.get(groupId);
      if (cached) return cached;
      const node = nodesById.get(groupId);
      if (!node || node.type !== 'group') {
        pathMap.set(groupId, '');
        return '';
      }
      const parentNode = node.parentId ? nodesById.get(node.parentId) : undefined;
      const parentPath = parentNode && parentNode.type === 'group' ? resolvePath(parentNode.id) : '';
      const namePart = (node.name || '').trim() || 'Без названия';
      const fullPath = parentPath ? `${parentPath} / ${namePart}` : namePart;
      pathMap.set(groupId, fullPath);
      return fullPath;
    };

    nodes.forEach((node) => {
      if (node.type === 'group') {
        resolvePath(node.id);
      }
    });

    return pathMap;
  }, [nodes]);


  useEffect(() => {
    log.info('activeTasks:update', { count: activeTasks.length });
  }, [activeTasks.length, log]);

  return (
    <div className="active-page">
      <div className="active-page__header">
        <Link to="/" className="tool-link" title="Назад к доске" aria-label="Назад к доске">← Назад к доске</Link>
        <h2>Активные задачи</h2>
      </div>
      <div className="active-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {grouped.map((g) => (
          <React.Fragment key={g.key}>
            {/* Заголовок даты на всю ширину грида */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #ccc', margin: '12px 0 8px', position: 'relative' }}>
              <span data-testid="date-header" data-date-key={g.key} style={{ position: 'absolute', top: -10, left: 0, background: '#fff', padding: '0 6px', fontSize: 12, color: '#666' }}>{g.label}</span>
            </div>
            {/* Карточки задач этой даты, раскладка по колонкам */}
            {g.tasks.map((t) => {
              const prioBg = t.priority === 'high'
                ? '#2a1518' // dark reddish
                : t.priority === 'med'
                ? '#2a2515' // dark yellowish
                : t.priority === 'low'
                ? '#152a1b' // dark greenish
                : '#161a1e'; // default dark
              const prioBorder = t.priority === 'high'
                ? '#592029'
                : t.priority === 'med'
                ? '#5a4a1f'
                : t.priority === 'low'
                ? '#204a2d'
                : '#1f2b34';
              const parentGroupName = t.parentId ? (groupPathById.get(t.parentId) || 'Без группы') : 'Без группы';
              return (
                <div
                  key={t.id}
                  className="active-item"
                  title={`Группа: ${parentGroupName}`}
                  aria-label={`Группа: ${parentGroupName}`}
                  data-group-label={g.label}
                  data-parent-group={parentGroupName}
                  style={{ position: 'relative', background: prioBg, border: `1px solid ${prioBorder}`, borderRadius: 10, padding: 10 }}
              >
                {(t.status === 'in_progress' || t.status === 'active') && t.isActual !== false ? (
                  <div
                    title="Требует внимания"
                    aria-label="Требует внимания"
                    data-testid="attention-badge"
                    style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: '#000', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, lineHeight: 1, boxShadow: '0 1px 4px rgba(0,0,0,0.35)', zIndex: 2, border: '1px solid #222', pointerEvents: 'none' }}
                  >⏳</div>
                ) : null}
                {/* Title + description with inline editing */}
                {editId === t.id ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={async (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); await updateNode(t.id, { title: editTitle, description: editDesc }); setEditId(null); } }}
                      placeholder="Название задачи"
                      style={{ fontSize: 18, fontWeight: 800, padding: '6px 8px', background: '#0f1418', color: '#fff', border: '1px solid #27323a', borderRadius: 8 }}
                    />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Описание (необязательно)"
                      style={{ fontSize: 13, padding: '6px 8px', minHeight: 48, background: '#0f1418', color: '#ddd', border: '1px solid #27323a', borderRadius: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="tool-btn" onClick={async () => { await updateNode(t.id, { title: editTitle, description: editDesc }); setEditId(null); }}>Сохранить</button>
                      <button className="tool-btn" onClick={() => setEditId(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="active-item__title"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18, fontWeight: 800, cursor: 'pointer' }}
                      title="Редактировать задачу"
                      onClick={() => { setEditId(t.id); setEditTitle(t.title || ''); setEditDesc(t.description || ''); }}
                    >
                      {t.title}
                    </div>
                    {t.description ? <div className="active-item__desc" style={{ fontSize: 13, color: '#aeb7bf' }}>{t.description}</div> : null}
                  </>
                )}
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Array.isArray(t.subtasks) && t.subtasks.length > 0 ? (
                    t.subtasks.map((s, idx) => (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={!!s.done}
                          onChange={(e) => {
                            const next = [...(t.subtasks || [])];
                            next[idx] = { ...next[idx], done: e.target.checked };
                            void useAppStore.getState().updateNode(t.id, { subtasks: next });
                          }}
                        />
                        <span style={{ textDecoration: s.done ? 'line-through' : undefined }}>{s.title}</span>
                      </label>
                    ))
                  ) : null}
                  {/* Divider and compact toolbar with emojis */}
                  <div style={{ height: 1, background: '#25313a', margin: '8px 0' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      className="tool-btn"
                      title="Добавить подзадачу"
                      style={{ padding: '4px 8px' }}
                      onClick={() => {
                        const title = window.prompt('Название подзадачи');
                        if (!title || !title.trim()) return;
                        const id = Math.random().toString(36).slice(2);
                        const next = [...(t.subtasks || []), { id, title: title.trim(), done: false, createdAt: Date.now() }];
                        void updateNode(t.id, { subtasks: next });
                      }}
                    >
                      ➕
                    </button>
                    <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #2b3a45, transparent)' }} />
                    <button
                      className="tool-btn"
                      title="Отметить выполненной"
                      style={{ padding: '4px 8px' }}
                      onClick={async () => {
                        const ask = window.prompt('Дата выполнения (YYYY-MM-DD или YYYY-MM-DD HH:mm). Пусто — сейчас:');
                        let completedTs = Date.now();
                        if (ask && ask.trim()) {
                          const s = ask.trim();
                          const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                          const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
                          if (m1) {
                            const [_, yy, mm, dd] = m1;
                            completedTs = new Date(Number(yy), Number(mm) - 1, Number(dd), 12, 0, 0).getTime();
                          } else if (m2) {
                            const [_, yy, mm, dd, HH, MM] = m2;
                            completedTs = new Date(Number(yy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), 0).getTime();
                          }
                        }
                        if (t.recurrence && (t.recurrence as Recurrence).kind !== 'none') {
                          const base = t.dueDate ? new Date(t.dueDate) : new Date();
                          base.setDate(base.getDate() + 1);
                          const nextDue = computeNextDueDate(t.recurrence as Recurrence, base);
                          await updateNode(t.id, { status: 'done', completedAt: completedTs });
                          await addTask({
                            title: t.title,
                            description: t.description,
                            priority: t.priority,
                            durationMinutes: t.durationMinutes,
                            status: 'active',
                            color: t.color,
                            parentId: t.parentId ?? null,
                            x: t.x,
                            y: t.y,
                            dueDate: nextDue ?? undefined,
                            recurrence: t.recurrence as Recurrence,
                            textSize: t.textSize,
                            iconEmoji: t.iconEmoji,
                            subtasks: Array.isArray(t.subtasks)
                              ? t.subtasks.map((s) => ({ id: Math.random().toString(36).slice(2), title: s.title, done: false, createdAt: Date.now() }))
                              : undefined,
                          });
                        } else {
                          await updateNode(t.id, { status: 'done', completedAt: completedTs });
                        }
                      }}
                    >
                      ✅
                    </button>
                  </div>
                </div>
                <div className="active-item__meta">
                  {t.dueDate ? (
                    <span className="badge">⏰ {new Date(t.dueDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  ) : null}
                  <button className="tool-btn" style={{ marginLeft: 8 }} onClick={() => { revealNode(t.id); navigate('/'); }}>Открыть на доске</button>
                </div>
              </div>
            )})}
          </React.Fragment>
        ))}
        {activeTasks.length === 0 ? <div className="empty">Нет активных задач</div> : null}
      </div>

    </div>
  );
};

export default ActiveTasksPage;
