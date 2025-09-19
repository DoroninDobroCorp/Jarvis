import React, { useEffect, useMemo } from 'react';
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
            {g.tasks.map((t) => (
              <div key={t.id} className="active-item">
                <div className="active-item__title">{t.title}</div>
                {t.description ? <div className="active-item__desc">{t.description}</div> : null}
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
                  ) : (
                    <div style={{ color: '#888', fontSize: 12 }}>Подзадач пока нет</div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      placeholder="Новая подзадача"
                      style={{ flex: 1 }}
                      onKeyDown={(e) => {
                        const inp = e.target as HTMLInputElement;
                        if (e.key === 'Enter' && inp.value.trim()) {
                          const id = Math.random().toString(36).slice(2);
                          const next = [...(t.subtasks || []), { id, title: inp.value.trim(), done: false, createdAt: Date.now() }];
                          void updateNode(t.id, { subtasks: next });
                          inp.value = '';
                        }
                      }}
                    />
                    <button className="tool-btn" onClick={(e) => {
                      const inputEl = (e.currentTarget.previousSibling as HTMLInputElement);
                      const value = inputEl && 'value' in inputEl ? inputEl.value.trim() : '';
                      if (!value) return;
                      const id = Math.random().toString(36).slice(2);
                      const next = [...(t.subtasks || []), { id, title: value, done: false, createdAt: Date.now() }];
                      void updateNode(t.id, { subtasks: next });
                      inputEl.value = '';
                    }}>Добавить</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <button className="tool-btn" onClick={async () => {
                    const nowTs = Date.now();
                    if (t.recurrence && (t.recurrence as Recurrence).kind !== 'none') {
                      const base = t.dueDate ? new Date(t.dueDate) : new Date();
                      base.setDate(base.getDate() + 1); // строго после текущей даты
                      const nextDue = computeNextDueDate(t.recurrence as Recurrence, base);
                      await updateNode(t.id, { status: 'done', completedAt: nowTs });
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
                      await updateNode(t.id, { status: 'done', completedAt: nowTs });
                    }
                  }}>Сделано</button>
                </div>
                <div className="active-item__meta">
                  {t.dueDate ? (
                    <span className="badge">⏰ {new Date(t.dueDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  ) : null}
                  {t.priority ? <span className={`badge badge--${t.priority}`}>Приоритет: {t.priority}</span> : null}
                  <button className="tool-btn" style={{ marginLeft: 8 }} onClick={() => { revealNode(t.id); navigate('/'); }}>Открыть на доске</button>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
        {activeTasks.length === 0 ? <div className="empty">Нет активных задач</div> : null}
      </div>

    </div>
  );
};

export default ActiveTasksPage;
