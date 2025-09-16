import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './errorOverlay';
import App from './App.tsx';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getLogger } from './logger';

const log = getLogger('main');
try {
  // Force sane defaults on each load to avoid old noisy settings
  const url = new URL(window.location.href);
  const diagParam = url.searchParams.get('diag');
  const logParam = url.searchParams.get('log');
  const lvl = (logParam && ['debug', 'info', 'warn', 'error'].includes(logParam)) ? logParam : 'info';
  const diag = diagParam === '1' ? '1' : '0';
  localStorage.setItem('LOG_LEVEL', lvl);
  localStorage.setItem('DEBUG_DIAG', diag);
} catch (e) {
  log.warn('diag:localStorage:set-failed', { error: String(e instanceof Error ? e.message : e) });
}

// Dev-only: unregister any stale Service Workers and clear Cache Storage for this origin.
// This prevents previously registered SW (e.g., from another app on the same port 5173)
// from hijacking requests and breaking Vite dev HMR / causing freezes.
try {
  if (import.meta.env.DEV && 'serviceWorker' in navigator) {
    const reloaded = sessionStorage.getItem('SW_RELOAD_ONCE') === '1';
    void navigator.serviceWorker.getRegistrations()
      .then(async (regs) => {
        if (Array.isArray(regs) && regs.length > 0) {
          log.warn('sw:cleanup:start', { registrations: regs.length });
          await Promise.allSettled(regs.map((r) => r.unregister()));
          try {
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.allSettled(keys.map((k) => caches.delete(k)));
            }
          } catch (err) {
            log.warn('sw:cleanup:caches-failed', { error: String(err instanceof Error ? err.message : err) });
          }
        }
        // If page is still controlled by any SW, force a one-time reload to detach
        if (navigator.serviceWorker.controller && !reloaded) {
          log.warn('sw:cleanup:reload-once');
          try { sessionStorage.setItem('SW_RELOAD_ONCE', '1'); } catch (e) { void e; }
          setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 0);
          return; // stop here on first pass
        }
        log.info('sw:cleanup:done');
      })
      .catch((err) => {
        log.warn('sw:cleanup:failed', { error: String(err instanceof Error ? err.message : err) });
      });
  }
} catch (err) {
  log.warn('sw:cleanup:init-failed', { error: String(err instanceof Error ? err.message : err) });
}

// Global error / rejection logging
window.addEventListener('error', (e) => {
  log.error('window:error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: String(e.error || '') });
});
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  log.error('window:unhandledrejection', { reason: String(e.reason) });
});

// FPS and long main-thread stall detection (dev only, behind DEBUG_DIAG)
try {
  const diagOn = localStorage.getItem('DEBUG_DIAG') === '1';
  if (diagOn) {
    let frames = 0; let last = performance.now(); let lowFpsStreak = 0; let lastTick = performance.now();
    const tick = () => {
      const now = performance.now();
      frames++;
      if (now - last >= 1000) {
        const fps = Math.round((frames * 1000) / (now - last));
        if (fps < 20) { lowFpsStreak++; } else { lowFpsStreak = 0; }
        if (lowFpsStreak >= 3) {
          log.warn('perf:low-fps', { fps, lowFpsStreak });
          lowFpsStreak = 0;
        }
        frames = 0; last = now;
      }
      if (now - lastTick > 500) {
        log.warn('perf:main-thread-stall', { gapMs: Math.round(now - lastTick) });
      }
      lastTick = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
} catch (e) {
  log.warn('diag:fps-monitor:init-failed', { error: String(e instanceof Error ? e.message : e) });
}

// Long tasks (if supported, behind DEBUG_DIAG)
try {
  const diagOn = localStorage.getItem('DEBUG_DIAG') === '1';
  if (diagOn && 'PerformanceObserver' in window) {
    const po = new PerformanceObserver((list: PerformanceObserverEntryList) => {
      for (const entry of list.getEntries()) {
        const duration = (entry as PerformanceEntry).duration;
        if (entry.entryType === 'longtask' || duration > 50) {
          log.warn('perf:longtask', { name: entry.name, duration: Math.round(duration) });
        }
      }
    });
    try { po.observe({ entryTypes: ['longtask', 'measure'] as string[] }); } catch (e) {
      log.warn('diag:perf-observer:observe-failed', { error: String(e instanceof Error ? e.message : e) });
    }
  }
} catch (e) {
  log.warn('diag:perf-observer:init-failed', { error: String(e instanceof Error ? e.message : e) });
}

log.info('app:start');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>
);

log.info('app:rendered');
