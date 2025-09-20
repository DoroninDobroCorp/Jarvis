import React, { useRef, useState } from 'react';
import { useAppStore } from '../store';
import { Link, useNavigate } from 'react-router-dom';
import { getLogger } from '../logger';
import { exportBackup, importBackup } from '../exportImport';
import AssistantModal from './AssistantModal';

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
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
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

  // Сохранение текущего центра вида как стартового
  const viewport = useAppStore((s) => s.viewport);
  const currentParentId = useAppStore((s) => s.currentParentId);
  const saveStartCenter = () => {
    try {
      const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale;
      const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale;
      const payload = { x: Math.round(cx), y: Math.round(cy), scale: viewport.scale };
      const levelKey = currentParentId ?? '__ROOT__';
      // write per-level map
      try {
        const raw = localStorage.getItem('START_VIEW_BY_LEVEL');
        const map = raw ? (JSON.parse(raw) as Record<string, { x: number; y: number; scale?: number }>) : {};
        map[levelKey] = payload;
        localStorage.setItem('START_VIEW_BY_LEVEL', JSON.stringify(map));
      } catch {}
      // legacy for root
      if (levelKey === '__ROOT__') {
        localStorage.setItem('START_VIEW_CENTER', JSON.stringify(payload));
      }
      log.info('startViewCenter:saved', { levelKey, ...payload });
      alert('Стартовый центр сохранён');
    } catch (e) {
      console.error(e);
      alert('Не удалось сохранить центр');
    }
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
        <ToolButton onClick={() => { log.info('assistant:open'); setAssistantOpen(true); }} title="ИИ-ассистент (аудио)">🤖 Ассистент</ToolButton>
        <ToolButton onClick={() => { log.info('deleteSelection:click'); void deleteSelection(); }} title="Удалить выбранное">🗑️ Удалить</ToolButton>
        <ToolButton onClick={() => { log.info('goUp:click'); goUp(); }} title="Вверх по уровню">⬆️ Назад</ToolButton>
      </div>
      <div className="tool-group">
        <Link to="/active" className="tool-link" title="Активные задачи" aria-label="Активные задачи">🔥 Активные</Link>
        <Link to="/done" className="tool-link" style={{ marginLeft: 8 }} title="Выполненные задачи" aria-label="Выполненные задачи">✅ Выполненные</Link>
        <div style={{ marginLeft: 12 }}>
          <label style={{ color: 'var(--text)', marginRight: 6 }}>Допстраницы</label>
          <select aria-label="Допстраницы" onChange={(e) => { const v = e.target.value; if (v) { navigate(v); e.currentTarget.selectedIndex = 0; } }}>
            <option value="">— выбрать —</option>
            <option value="/books">Книги</option>
            <option value="/movies">Фильмы</option>
            <option value="/games">Игры</option>
            <option value="/purchases">Покупки</option>
          </select>
        </div>
        <div style={{ marginLeft: 12 }}>
          <label style={{ color: 'var(--text)', marginRight: 6 }}>Режим</label>
          <select aria-label="Режим производительности" title="Режим производительности" value={perfModeOverride} onChange={(e) => setPerfModeOverride(e.target.value as 'auto' | 'perf' | 'super')}>
            <option value="auto">Авто</option>
            <option value="perf">Эконом</option>
            <option value="super">Супер</option>
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
          <button className="tool-btn" title="Очистить всю базу" onClick={() => { if (confirm('Очистить все данные? Это действие необратимо.')) { void resetAll(); } }}>🗑 Очистить всё</button>
          <span style={{ width: 8 }} />
          <button className="tool-btn" title="Экспорт в JSON" onClick={() => { log.info('export:click'); void exportBackup(); }}>⤓ Экспорт</button>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button className="tool-btn" title="Импорт / Ещё" onClick={() => setImportMenuOpen((v) => !v)}>☰ Импорт/Ещё</button>
            {importMenuOpen ? (
              <div style={{ position: 'absolute', right: 0, top: '100%', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: 8, minWidth: 220, zIndex: 1000, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>
                <button className="tool-btn" style={{ display: 'block', width: '100%' }} title="Импорт (замена)" onClick={() => { onPickFile('replace'); setImportMenuOpen(false); }}>⤒ Импорт (замена)</button>
                <button className="tool-btn" style={{ display: 'block', width: '100%', marginTop: 6 }} title="Импорт (merge)" onClick={() => { onPickFile('merge'); setImportMenuOpen(false); }}>⤒ Импорт (merge)</button>
                <div style={{ height: 1, background: '#444', margin: '6px 0' }} />
                <button className="tool-btn" style={{ display: 'block', width: '100%' }} title="Запомнить текущий центр вида для старта" onClick={() => { saveStartCenter(); setImportMenuOpen(false); }}>📍</button>
              </div>
            ) : null}
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onFileChange} />
        </div>
      </div>
      {assistantOpen ? (<AssistantModal open={assistantOpen} onClose={() => setAssistantOpen(false)} />) : null}
    </div>
  );
};

export default Toolbar;
