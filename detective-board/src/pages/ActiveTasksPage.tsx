import React, { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import type { TaskNode } from '../types';
import { getLogger } from '../logger';

export const ActiveTasksPage: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
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
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (ad !== bd) return ad - bd; // раньше срок — выше
        // одинаковая дата: по важности (high > med > low)
        const ap = prioRank(a.priority);
        const bp = prioRank(b.priority);
        if (ap !== bp) return ap - bp;
        // стабилизируем по названию, чтобы порядок был предсказуем
        return (a.title || '').localeCompare(b.title || '');
      });
  }, [nodes]);

  const grouped = useMemo(() => {
    const groups = new Map<string, TaskNode[]>();
    activeTasks.forEach((t) => {
      const key = t.dueDate ? t.dueDate.slice(0, 10) : '__NO_DATE__';
      const arr = groups.get(key) || [];
      arr.push(t);
      groups.set(key, arr);
    });
    const dateKeys = Array.from(groups.keys()).filter((k) => k !== '__NO_DATE__').sort();
    const result: Array<{ key: string; label: string; tasks: TaskNode[] }> = [];
    dateKeys.forEach((k) => result.push({ key: k, label: k, tasks: groups.get(k)! }));
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
              <span style={{ position: 'absolute', top: -10, left: 0, background: '#fff', padding: '0 6px', fontSize: 12, color: '#666' }}>{g.label}</span>
            </div>
            {/* Карточки задач этой даты, раскладка по колонкам */}
            {g.tasks.map((t) => (
              <div key={t.id} className="active-item">
                <div className="active-item__title">{t.title}</div>
                {t.description ? <div className="active-item__desc">{t.description}</div> : null}
                <div className="active-item__meta">
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
