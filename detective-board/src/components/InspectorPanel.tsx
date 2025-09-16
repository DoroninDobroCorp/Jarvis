import React, { useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import type { AnyNode, GroupNode, TaskNode, TaskStatus, PersonNode, PersonRole } from '../types';
import { getLogger } from '../logger';

export const InspectorPanel: React.FC = () => {
  const selection = useAppStore((s) => s.selection);
  const getNode = useAppStore((s) => s.getNode);
  const updateNode = useAppStore((s) => s.updateNode);
  const enterGroup = useAppStore((s) => s.enterGroup);
  const log = getLogger('Inspector');

  const node = useMemo<AnyNode | undefined>(() => {
    if (selection.length !== 1) return undefined;
    return getNode(selection[0]);
  }, [selection, getNode]);

  useEffect(() => {
    if (!node) {
      log.debug('selection:none');
    } else {
      log.debug('selection:node', { id: node.id, type: node.type });
    }
  }, [node, log]);

  if (!node) {
    return (
      <div className="inspector">
        <div className="inspector__title">Свойства</div>
        <div className="inspector__empty">Нет выделения</div>
      </div>
    );
  }

  if (node.type === 'task') {
    const t = node as TaskNode;
    return (
      <div className="inspector">
        <div className="inspector__title">Задача</div>
        <label>
          Заголовок
          <input value={t.title} onChange={(e) => updateNode(t.id, { title: e.target.value })} />
        </label>
        <label>
          Описание
          <textarea value={t.description || ''} onChange={(e) => updateNode(t.id, { description: e.target.value })} />
        </label>
        <label>
          Исполнитель (смайл)
          <input value={t.assigneeEmoji || ''} onChange={(e) => updateNode(t.id, { assigneeEmoji: e.target.value })} placeholder="🙂" />
        </label>
        <label>
          Имя исполнителя
          <input value={t.assigneeName || ''} onChange={(e) => updateNode(t.id, { assigneeName: e.target.value })} placeholder="Имя" />
        </label>
        <label>
          Цвет стикера
          <input type="color" value={(t.color || '#E8D8A6')} onChange={(e) => updateNode(t.id, { color: e.target.value })} />
        </label>
        <label>
          Срок
          <input type="date" value={t.dueDate ? t.dueDate.slice(0, 10) : ''} onChange={(e) => updateNode(t.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
        </label>
        <label>
          Срочность
          <select
            value={t.priority || 'med'}
            onChange={(e) => updateNode(t.id, { priority: (e.target.value as 'low' | 'med' | 'high') })}
          >
            <option value="low">Низкая</option>
            <option value="med">Средняя</option>
            <option value="high">Высокая</option>
          </select>
        </label>
        <label>
          Длительность (мин)
          <input type="number" value={t.durationMinutes || 0} onChange={(e) => updateNode(t.id, { durationMinutes: Number(e.target.value) || undefined })} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label>
            Ширина
            <input type="number" min={80} max={1200} value={t.width} onChange={(e) => updateNode(t.id, { width: Math.max(80, Math.min(1200, Number(e.target.value))) })} />
          </label>
          <label>
            Высота
            <input type="number" min={60} max={900} value={t.height} onChange={(e) => updateNode(t.id, { height: Math.max(60, Math.min(900, Number(e.target.value))) })} />
          </label>
        </div>
        <fieldset className="inspector__fieldset">
          <legend>Статус</legend>
          <label className="radio">
            <input type="radio" name="status" checked={t.status === 'inactive'} onChange={() => updateNode(t.id, { status: 'inactive' as TaskStatus })} /> Не активна
          </label>
          <label className="radio">
            <input type="radio" name="status" checked={t.status === 'in_progress'} onChange={() => updateNode(t.id, { status: 'in_progress' as TaskStatus })} /> В процессе
          </label>
          <label className="radio">
            <input type="radio" name="status" checked={t.status === 'done'} onChange={() => updateNode(t.id, { status: 'done' as TaskStatus })} /> Выполнена
          </label>
        </fieldset>
      </div>
    );
  }

  if (node.type === 'person') {
    const p = node as PersonNode;
    return (
      <div className="inspector">
        <div className="inspector__title">Человек</div>
        <label>
          Имя
          <input value={p.name} onChange={(e) => updateNode(p.id, { name: e.target.value })} />
        </label>
        <label>
          Роль
          <select value={p.role} onChange={(e) => updateNode(p.id, { role: (e.target.value as PersonRole) })}>
            <option value="employee">Сотрудник</option>
            <option value="partner">Партнёр</option>
            <option value="bot">Бот</option>
          </select>
        </label>
        <label>
          Иконка (emoji)
          <input value={p.avatarEmoji || ''} onChange={(e) => updateNode(p.id, { avatarEmoji: e.target.value })} placeholder="👤/🤝/🤖" />
        </label>
        <label>
          Цвет
          <input type="color" value={p.color || '#B3E5FC'} onChange={(e) => updateNode(p.id, { color: e.target.value })} />
        </label>
        <label>
          Размер (px)
          <input type="number" min={80} max={400} value={p.width} onChange={(e) => {
            const size = Math.max(80, Math.min(400, Number(e.target.value)));
            updateNode(p.id, { width: size, height: size });
          }} />
        </label>
      </div>
    );
  }

  const g = node as GroupNode;
  return (
    <div className="inspector">
      <div className="inspector__title">Группа</div>
      <label>
        Название
        <input value={g.name} onChange={(e) => updateNode(g.id, { name: e.target.value })} />
      </label>
      <label>
        Цвет шара
        <input type="color" value={g.color || '#AEC6CF'} onChange={(e) => updateNode(g.id, { color: e.target.value })} />
      </label>
      <label>
        Размер (px)
        <input type="number" min={80} max={1200} value={g.width} onChange={(e) => {
          const size = Math.max(80, Math.min(1200, Number(e.target.value)));
          updateNode(g.id, { width: size, height: size });
        }} />
      </label>
      <button onClick={() => { log.info('group:open-click', { id: g.id }); enterGroup(g.id); }} title="Открыть группу" aria-label="Открыть группу">Открыть группу</button>
    </div>
  );
};

export default InspectorPanel;
