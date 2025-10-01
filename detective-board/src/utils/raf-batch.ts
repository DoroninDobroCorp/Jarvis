/**
 * Батчинг обновлений через requestAnimationFrame
 * Группирует несколько вызовов в один кадр анимации
 */

let rafId: number | null = null;
let pendingCallbacks: Set<() => void> = new Set();

export function scheduleRAF(callback: () => void): void {
  pendingCallbacks.add(callback);
  
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      const callbacks = Array.from(pendingCallbacks);
      pendingCallbacks.clear();
      rafId = null;
      
      callbacks.forEach(cb => {
        try {
          cb();
        } catch (e) {
          console.error('RAF callback error:', e);
        }
      });
    });
  }
}

export function cancelRAF(callback: () => void): void {
  pendingCallbacks.delete(callback);
}
