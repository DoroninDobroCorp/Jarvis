import React, { useRef, useState } from 'react';
import { useAppStore } from '../store';
import { Link, useNavigate } from 'react-router-dom';
import { getLogger } from '../logger';
import { exportBackup, importBackup } from '../exportImport';

const log = getLogger('Toolbar');

const ToolButton: React.FC<{
  active?: boolean;
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    className={`tool-btn ${active ? 'active' : ''}`}
    onClick={onClick}
    title={title}
    aria-label={title}
  >
    {children}
  </button>
);

export const Toolbar: React.FC = () => {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const groupSelection = useAppStore((s) => s.groupSelection);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const goUp = useAppStore((s) => s.goUp);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const perfModeOverride = useAppStore((s) => s.perfModeOverride);
  const setPerfModeOverride = useAppStore((s) => s.setPerfModeOverride);
  const resetAll = useAppStore((s) => s.resetAll);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const onPickFile = (mode: 'replace' | 'merge') => {
    setImportMode(mode);
    fileRef.current?.click();
  };
  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      log.info('import:start', { name: f.name, size: f.size, mode: importMode });
      await importBackup(f, importMode);
      log.info('import:done', { mode: importMode });
      // сбрасываем значение, чтобы можно было повторно выбрать тот же файл
      e.target.value = '';
      alert('Импорт завершён');
    } catch (err) {
      console.error(err);
      alert('Ошибка импорта: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const toggle = (next: Parameters<typeof setTool>[0]) => {
    setTool(tool === next ? 'none' : next);
  };

  return (
    <div className="toolbar">
      <div className="tool-group">
        <ToolButton active={tool === 'add-task'} onClick={() => { log.debug('setTool', { to: 'add-task' }); toggle('add-task'); }} title="Добавить задачу">📝</ToolButton>
        <ToolButton active={tool === 'add-group'} onClick={() => { log.debug('setTool', { to: 'add-group' }); toggle('add-group'); }} title="Добавить группу-шар">🟢</ToolButton>
        <ToolButton active={tool === 'add-person-employee'} onClick={() => { log.debug('setTool', { to: 'add-person-employee' }); toggle('add-person-employee'); }} title="Добавить сотрудника">👤</ToolButton>
        <ToolButton active={tool === 'add-person-partner'} onClick={() => { log.debug('setTool', { to: 'add-person-partner' }); toggle('add-person-partner'); }} title="Добавить партнёра">🤝</ToolButton>
        <ToolButton active={tool === 'add-person-bot'} onClick={() => { log.debug('setTool', { to: 'add-person-bot' }); toggle('add-person-bot'); }} title="Добавить бота">🤖</ToolButton>
        <ToolButton active={tool === 'link'} onClick={() => { log.debug('setTool', { to: 'link' }); toggle('link'); }} title="Соединить ниткой">🧵</ToolButton>
      </div>
      <div className="tool-group">
        <ToolButton onClick={() => { log.info('groupSelection:click'); void groupSelection(); }} title="Сгруппировать в шар">🎯 Группа</ToolButton>
        <ToolButton onClick={() => { log.info('deleteSelection:click'); void deleteSelection(); }} title="Удалить выбранное">🗑️ Удалить</ToolButton>
        <ToolButton onClick={() => { log.info('goUp:click'); goUp(); }} title="Вверх по уровню">⬆️ Назад</ToolButton>
      </div>
      <div className="tool-group">
        <Link to="/active" className="tool-link" title="Активные задачи" aria-label="Активные задачи">🔥 Активные</Link>
        <div style={{ marginLeft: 12 }}>
          <label style={{ color: 'var(--text)', marginRight: 6 }}>Допстраницы</label>
          <select aria-label="Допстраницы" onChange={(e) => { const v = e.target.value; if (v) { navigate(v); e.currentTarget.selectedIndex = 0; } }}>
            <option value="">— выбрать —</option>
            <option value="/books">Книги</option>
            <option value="/movies">Фильмы</option>
          </select>
        </div>
        <div style={{ marginLeft: 12, display: 'inline-flex', gap: 6 }}>
          <button className="tool-btn" title="Отменить (Cmd/Ctrl+Z)" onClick={() => { void undo(); }}>↶ Отменить</button>
          <button className="tool-btn" title="Вернуть (Shift+Cmd/Ctrl+Z / Ctrl+Y)" onClick={() => { void redo(); }}>↷ Вернуть</button>
          <button className="tool-btn" title="Полноэкранный режим" onClick={() => {
            if (!document.fullscreenElement) {
              void document.documentElement.requestFullscreen();
            } else {
              void document.exitFullscreen();
            }
          }}>⛶ Полноэкранно</button>
          <select aria-label="Режим производительности" title="Режим производительности" value={perfModeOverride} onChange={(e) => setPerfModeOverride(e.target.value as 'auto' | 'perf' | 'super')}>
            <option value="auto">Авто</option>
            <option value="perf">Эконом</option>
            <option value="super">Суперэконом</option>
          </select>
          <button className="tool-btn" title="Очистить всю базу" onClick={() => { if (confirm('Очистить все данные? Это действие необратимо.')) { void resetAll(); } }}>🗑 Очистить всё</button>
          <span style={{ width: 8 }} />
          <button className="tool-btn" title="Экспорт в JSON" onClick={() => { log.info('export:click'); void exportBackup(); }}>⤓ Экспорт</button>
          <button className="tool-btn" title="Импорт (заменить данные)" onClick={() => onPickFile('replace')}>⤒ Импорт (замена)</button>
          <button className="tool-btn" title="Импорт (слияние/merge)" onClick={() => onPickFile('merge')}>⤒ Импорт (merge)</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onFileChange} />
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
