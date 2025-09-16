import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import './App.css';
import { useAppStore } from './store';
import { BoardCanvas } from './components/BoardCanvas';
import { Toolbar } from './components/Toolbar';
import { InspectorPanel } from './components/InspectorPanel';
import { ActiveTasksPage } from './pages/ActiveTasksPage';
import { BooksPage } from './pages/BooksPage';
import { MoviesPage } from './pages/MoviesPage';
import { getLogger } from './logger';
import { DiagPage } from './pages/DiagPage';

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
  const log = getLogger('App');
  useEffect(() => {
    if (!initialized) {
      log.info('init:request');
      void init();
    }
  }, [init, initialized, log]);
  const loc = useLocation();
  useEffect(() => {
    log.info('route', { path: loc.pathname });
  }, [loc.pathname, log]);
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/active" element={<ActiveTasksPage />} />
      <Route path="/books" element={<BooksPage />} />
      <Route path="/movies" element={<MoviesPage />} />
      <Route path="/diag" element={<DiagPage />} />
    </Routes>
  );
}

export default App
