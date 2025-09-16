/* Simple structured logger with scopes and levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Initialize sane defaults as early as possible to avoid stale noisy settings
// causing performance issues before main.tsx runs.
try {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    const logParam = url.searchParams.get('log');
    const diagParam = url.searchParams.get('diag');
    const lvl = (logParam && ['debug', 'info', 'warn', 'error'].includes(logParam)) ? logParam : 'info';
    const diag = diagParam === '1' ? '1' : '0';
    localStorage.setItem('LOG_LEVEL', lvl);
    localStorage.setItem('DEBUG_DIAG', diag);
  }
} catch {
  // ignore
}

function getGlobalLevel(): LogLevel {
  if (typeof window !== 'undefined') {
    const maybe = (window as unknown as { __LOG_LEVEL__?: unknown }).__LOG_LEVEL__;
    const fromStorage = localStorage.getItem('LOG_LEVEL');
    const lvl = (typeof maybe === 'string' ? maybe : undefined) || fromStorage || undefined;
    if (lvl && ['debug', 'info', 'warn', 'error'].includes(lvl)) return lvl as LogLevel;
  }
  return 'debug';
}

export function getLogger(scope: string) {
  const base = `[${scope}]`;
  const level = getGlobalLevel();
  const min = LEVELS[level];
  let mirror = false;
  try { mirror = typeof window !== 'undefined' && localStorage.getItem('DEBUG_DIAG') === '1'; } catch { mirror = false; }
  const mirrorSend = (lvl: LogLevel, parts: unknown[]) => {
    if (!mirror) return;
    try {
      const payload = { scope, lvl, ts: Date.now(), parts };
      const body = JSON.stringify(payload);
      if (navigator && 'sendBeacon' in navigator) {
        (navigator as Navigator).sendBeacon('/__log', new Blob([body], { type: 'application/json' }));
      } else {
        // Fire-and-forget in dev
        void fetch('/__log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, mode: 'no-cors' as RequestMode });
      }
    } catch {
      // ignore
    }
  };
  const format = (args: unknown[]) => {
    try {
      return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    } catch {
      return args.map(String).join(' ');
    }
  };
  const out = (lvl: LogLevel, ...args: unknown[]) => {
    const ts = new Date().toISOString();
    const msg = `${ts} ${base} ${format(args)}`;
    if (LEVELS[lvl] < min) return;
    // Use console methods but ensure visibility of debug in some browsers
    if (lvl === 'debug') console.log(msg);
    else if (lvl === 'info') console.info(msg);
    else if (lvl === 'warn') console.warn(msg);
    else console.error(msg);
    mirrorSend(lvl, args);
  };
  return {
    debug: (...args: unknown[]) => out('debug', ...args),
    info: (...args: unknown[]) => out('info', ...args),
    warn: (...args: unknown[]) => out('warn', ...args),
    error: (...args: unknown[]) => out('error', ...args),
  };
}
