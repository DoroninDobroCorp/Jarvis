import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store';
import type { TaskNode } from '../types';

export const ActiveTasksPage: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);

  const activeTasks = useMemo(() =>
    nodes.filter((n): n is TaskNode => n.type === 'task' && n.status === 'in_progress')
      .sort((a, b) => {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      })
  , [nodes]);

  return (
    <div className="active-page">
      <div className="active-page__header">
        <Link to="/" className="tool-link">← Назад к доске</Link>
        <h2>Активные задачи</h2>
      </div>
      <div className="active-list">
        {activeTasks.map((t) => (
          <div key={t.id} className="active-item">
            <div className="active-item__title">{t.assigneeEmoji ?? '🙂'} {t.assigneeName ? `${t.assigneeName}: ` : ''}{t.title}</div>
            {t.description ? <div className="active-item__desc">{t.description}</div> : null}
            <div className="active-item__meta">
              {t.dueDate ? <span className="badge">Срок: {t.dueDate.slice(0,10)}</span> : <span className="badge badge--muted">Без срока</span>}
              {t.priority ? <span className={`badge badge--${t.priority}`}>Приоритет: {t.priority}</span> : null}
            </div>
          </div>
        ))}
        {activeTasks.length === 0 ? <div className="empty">Нет активных задач</div> : null}
      </div>
    </div>
  );
};

export default ActiveTasksPage;
