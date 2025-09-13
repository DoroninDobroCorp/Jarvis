import React from 'react';
import { useAppStore } from '../store';
import { Link } from 'react-router-dom';

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

  return (
    <div className="toolbar">
      <div className="tool-group">
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Выделение">🖱️</ToolButton>
        <ToolButton active={tool === 'pan'} onClick={() => setTool('pan')} title="Панорамирование">✋</ToolButton>
        <ToolButton active={tool === 'add-task'} onClick={() => setTool('add-task')} title="Добавить задачу">📝</ToolButton>
        <ToolButton active={tool === 'add-group'} onClick={() => setTool('add-group')} title="Добавить группу">🟢</ToolButton>
        <ToolButton active={tool === 'link'} onClick={() => setTool('link')} title="Соединить ниткой">🧵</ToolButton>
      </div>
      <div className="tool-group">
        <ToolButton onClick={() => groupSelection()} title="Сгруппировать в шар">🎯 Группа</ToolButton>
        <ToolButton onClick={() => deleteSelection()} title="Удалить выбранное">🗑️ Удалить</ToolButton>
        <ToolButton onClick={() => goUp()} title="Вверх по уровню">⬆️ Назад</ToolButton>
      </div>
      <div className="tool-group">
        <Link to="/active" className="tool-link" title="Активные задачи">🔥 Активные</Link>
      </div>
    </div>
  );
};

export default Toolbar;
