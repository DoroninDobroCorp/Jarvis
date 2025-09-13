import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';
import { useAppStore } from './store';
import { BoardCanvas } from './components/BoardCanvas';
import { Toolbar } from './components/Toolbar';
import { InspectorPanel } from './components/InspectorPanel';
import { ActiveTasksPage } from './pages/ActiveTasksPage';

function BoardPage() {
  return (
    <div className="app-shell">
      <Toolbar />
      <InspectorPanel />
      <BoardCanvas />
    </div>
  );
}

function App() {
  const initialized = useAppStore((s) => s.initialized);
  const init = useAppStore((s) => s.init);
  useEffect(() => { if (!initialized) { void init(); } }, [init, initialized]);
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/active" element={<ActiveTasksPage />} />
    </Routes>
  );
}

export default App
