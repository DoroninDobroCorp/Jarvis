import React, { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import type { TaskNode } from '../types';
import { getLogger } from '../logger';

export const CompletedTasksPage: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
  const removeNode = useAppStore((s) => s.removeNode);
  const revealNode = useAppStore((s) => s.revealNode);
  const navigate = useNavigate();
  const log = getLogger('CompletedTasks');

  const doneTasks = useMemo(() => {
    return nodes
      .filter((n): n is TaskNode => n.type === 'task' && n.status === 'done')
      .slice()
      .sort((a, b) => {
        const at = typeof a.completedAt === 'number' ? a.completedAt : 0;
        const bt = typeof b.completedAt === 'number' ? b.completedAt : 0;
        // новые (позже выполненные) — выше
        return bt - at;
      });
  }, [nodes]);

  const grouped = useMemo(() => {
    const groups = new Map<string, TaskNode[]>();
    doneTasks.forEach((t) => {
      const key = typeof t.completedAt === 'number' ? new Date(t.completedAt).toISOString().slice(0, 10) : '__NO_DATE__';
      const arr = groups.get(key) || [];
      arr.push(t);
      groups.set(key, arr);
    });
    const dateKeys = Array.from(groups.keys())
      .filter((k) => k !== '__NO_DATE__')
      .sort((a, b) => new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime());
    const result: Array<{ key: string; label: string; tasks: TaskNode[] }> = [];
    dateKeys.forEach((k) => {
      const d = new Date(k + 'T00:00:00Z');
      const label = d.toLocaleDateString('ru-RU', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
      result.push({ key: k, label, tasks: groups.get(k)! });
    });
    if (groups.has('__NO_DATE__')) {
      result.push({ key: '__NO_DATE__', label: 'Без даты', tasks: groups.get('__NO_DATE__')! });
    }
    return result;
  }, [doneTasks]);

  useEffect(() => {
    log.info('doneTasks:update', { count: doneTasks.length });
  }, [doneTasks.length, log]);

  return (
    <div className="active-page">
      <div className="active-page__header">
        <Link to="/" className="tool-link" title="Назад к доске" aria-label="Назад к доске">← Назад к доске</Link>
        <h2>Выполненные задачи</h2>
      </div>
      <div className="active-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {grouped.map((g) => (
          <React.Fragment key={g.key}>
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #ccc', margin: '12px 0 8px', position: 'relative' }}>
              <span style={{ position: 'absolute', top: -10, left: 0, background: '#fff', padding: '0 6px', fontSize: 12, color: '#666' }}>{g.label}</span>
            </div>
            {g.tasks.map((t) => (
              <div key={t.id} className="active-item">
                <div className="active-item__title">{t.title}</div>
                {t.description ? <div className="active-item__desc">{t.description}</div> : null}
                {Array.isArray(t.subtasks) && t.subtasks.length > 0 ? (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {t.subtasks.map((s) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                        <input type="checkbox" checked={!!s.done} readOnly />
                        <span style={{ textDecoration: s.done ? 'line-through' : undefined }}>{s.title}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="active-item__meta">
                  {typeof t.completedAt === 'number' ? (
                    <span className="badge">⏱ {new Date(t.completedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  ) : null}
                  <button className="tool-btn" style={{ marginLeft: 8 }} onClick={() => { revealNode(t.id); navigate('/'); }}>Открыть на доске</button>
                  <button className="tool-btn" style={{ marginLeft: 8 }} onClick={async () => { if (window.confirm('Удалить задачу навсегда?')) { await removeNode(t.id); } }}>Удалить навсегда</button>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
        {doneTasks.length === 0 ? <div className="empty">Нет выполненных задач</div> : null}
      </div>
    </div>
  );
};

export default CompletedTasksPage;
