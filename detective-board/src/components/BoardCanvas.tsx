import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group as KonvaGroup, Circle, Rect, Text, Image as KonvaImage, Arrow } from 'react-konva';
import { useAppStore } from '../store';
import type { AnyNode, GroupNode, TaskNode, PersonNode, TaskStatus } from '../types';
import { getLogger } from '../logger';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function useHtmlImage(url?: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    let alive = true;
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { if (alive) setImg(image); };
    image.onerror = () => { if (alive) setImg(null); };
    image.src = url;
    return () => { alive = false; };
  }, [url]);
  return img;
}

function computeNodeCenter(n: AnyNode) {
  return { cx: n.x + n.width / 2, cy: n.y + n.height / 2 };
}

function rectsIntersect(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Compute point on node border towards another node center (for nice arrow anchoring)
function computeAnchorTowards(n: AnyNode, target: AnyNode) {
  const c1 = computeNodeCenter(n);
  const c2 = computeNodeCenter(target);
  const dx = c2.cx - c1.cx;
  const dy = c2.cy - c1.cy;
  if (n.type === 'task') {
    const hw = n.width / 2;
    const hh = n.height / 2;
    const s = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh) || 1;
    return { x: c1.cx + dx / s, y: c1.cy + dy / s };
  } else {
    const r = Math.min(n.width, n.height) / 2;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return { x: c1.cx + ux * r, y: c1.cy + uy * r };
  }
}

// Compute point on node border towards arbitrary world point
function computeAnchorTowardsPoint(n: AnyNode, p: { x: number; y: number }) {
  const c1 = computeNodeCenter(n);
  const dx = p.x - c1.cx;
  const dy = p.y - c1.cy;
  if (n.type === 'task') {
    const hw = n.width / 2;
    const hh = n.height / 2;
    const s = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh) || 1;
    return { x: c1.cx + dx / s, y: c1.cy + dy / s };
  } else {
    const r = Math.min(n.width, n.height) / 2;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return { x: c1.cx + ux * r, y: c1.cy + uy * r };
  }
}

function nodeDisplayName(n: AnyNode): string {
  if (n.type === 'task') return (n as TaskNode).title;
  if (n.type === 'person') return (n as PersonNode).name;
  return (n as GroupNode).name;
}

// Estimate multiline font size to fit into a given box (approximate, fast)
function estimateTaskFont(text: string, base: number, contentW: number, contentH: number, lineH = 1.15) {
  let s = base;
  const minS = 10;
  // up to 3 refinement iterations to converge
  for (let i = 0; i < 3; i++) {
    const charW = 0.6 * s || 1; // average char width heuristic
    const charsPerLine = Math.max(1, Math.floor(contentW / charW));
    const parts = String(text || '').split('\n');
    let lines = 0;
    for (const part of parts) {
      const len = Math.max(1, part.length);
      lines += Math.max(1, Math.ceil(len / charsPerLine));
    }
    const requiredH = lines * s * lineH;
    if (requiredH <= contentH + 0.5) break;
    const ratio = contentH / requiredH;
    s = Math.max(minS, Math.floor(s * Math.max(0.5, ratio)));
  }
  return s;
}

// Fit single-line title into a given width by shrinking font size (keeps ellipsis as a fallback)
function fitTitleFontSingleLine(text: string, base: number, width: number) {
  const len = (text || '').length;
  if (len === 0) return base;
  const approxMax = width / (0.6 * len);
  return clamp(Math.floor(Math.min(base, approxMax)), 10, 64);
}

export const BoardCanvas: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
  const currentParentId = useAppStore((s) => s.currentParentId);
  const visibleNodes = useMemo(() => nodes.filter((n) => n.parentId === currentParentId), [nodes, currentParentId]);
  const links = useAppStore((s) => s.links);
  const viewport = useAppStore((s) => s.viewport);
  const setViewport = useAppStore((s) => s.setViewport);
  const moveNode = useAppStore((s) => s.moveNode);
  const moveNodeLocal = useAppStore((s) => s.moveNodeLocal);
  const setSelection = useAppStore((s) => s.setSelection);
  const selection = useAppStore((s) => s.selection);
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const addLink = useAppStore((s) => s.addLink);
  const enterGroup = useAppStore((s) => s.enterGroup);
  const addTask = useAppStore((s) => s.addTask);
  const addGroup = useAppStore((s) => s.addGroup);
  const addPerson = useAppStore((s) => s.addPerson);
  const linkSelection = useAppStore((s) => s.linkSelection);
  const setLinkSelection = useAppStore((s) => s.setLinkSelection);
  const editingNodeId = useAppStore((s) => s.editingNodeId);
  const setEditingNodeId = useAppStore((s) => s.setEditingNodeId);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const perfModeOverride = useAppStore((s) => s.perfModeOverride);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const log = getLogger('BoardCanvas');
  const diag = useMemo(() => {
    try { return localStorage.getItem('DEBUG_DIAG') === '1'; } catch { return false; }
  }, []);

  const { width, height } = useWindowSize();

  const stageRef = useRef<Konva.Stage | null>(null);
  const levelGroupRef = useRef<Konva.Group | null>(null);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const lastDist = useRef<number>(0);
  const lassoClickGuardRef = useRef<boolean>(false);
  const [pendingLinkFrom, setPendingLinkFrom] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [linkCtxMenu, setLinkCtxMenu] = useState<{ x: number; y: number; linkId: string } | null>(null);
  const [lasso, setLasso] = useState<null | { x: number; y: number; w: number; h: number; additive: boolean }>(null);
  const [hoveredStub, setHoveredStub] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const didAutoCenter = useRef<boolean>(false);

  // Поиск свободного места на уровне (newParentId) рядом с базовой точкой
  const findFreeSpot = useCallback((baseX: number, baseY: number, w: number, h: number, newParentId: string | null): { x: number; y: number } => {
    const atLevel = nodes.filter((n) => n.parentId === newParentId);
    const collides = (x: number, y: number) => atLevel.some((n) => rectsIntersect(x, y, w, h, n.x, n.y, n.width, n.height));
    // компактная спираль вокруг базовой точки
    const step = 16;
    let ring = 0;
    const maxRings = 10; // ~160px от базовой точки
    while (ring < maxRings) {
      const span = step * (ring + 1);
      for (let dx = -span; dx <= span; dx += step) {
        for (let dy = -span; dy <= span; dy += step) {
          const x = baseX + dx;
          const y = baseY + dy;
          if (!collides(x, y)) return { x, y };
        }
      }
      ring++;
    }
    // если не нашли рядом — возвращаем базовую точку (лучше близко, даже с пересечением)
    return { x: baseX, y: baseY };
  }, [nodes]);

  // World origin of current level (for nested groups): used to convert world -> local
  const levelOrigin = useMemo(() => {
    if (!currentParentId) return { x: 0, y: 0 };
    const grp = nodes.find((n) => n.id === currentParentId) as GroupNode | undefined;
    if (!grp) return { x: 0, y: 0 };
    let x = grp.x, y = grp.y; let p = grp.parentId; const visited = new Set<string>(); let hops = 0;
    while (p && !visited.has(p) && hops < 1000) { visited.add(p); const g = nodes.find((nn) => nn.id === p) as GroupNode | undefined; if (!g) break; x += g.x; y += g.y; p = g.parentId; hops++; }
    return { x, y };
  }, [currentParentId, nodes]);

  // Автоцентровка по "центру массы" видимых узлов один раз на старте/при входе в группу
  const levelBBox = useMemo(() => {
    if (visibleNodes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }, [visibleNodes]);

  // Сброс флага автоцентра ДО вычисления нового центра уровня, чтобы избежать видимого прыжка
  useLayoutEffect(() => {
    didAutoCenter.current = false;
  }, [currentParentId]);

  useLayoutEffect(() => {
    if (!levelBBox) return;
    if (!didAutoCenter.current) {
      const s = viewport.scale;
      const nx = width / 2 - (levelOrigin.x + levelBBox.cx) * s;
      const ny = height / 2 - (levelOrigin.y + levelBBox.cy) * s;
      setViewport({ x: nx, y: ny, scale: s });
      didAutoCenter.current = true;
      log.info('autocenter', { level: currentParentId, center: { x: levelBBox.cx, y: levelBBox.cy } });
    }
  }, [levelBBox, levelOrigin.x, levelOrigin.y, viewport.scale, width, height, setViewport, currentParentId, log]);

  

  // Если в группе нет детей — один раз центрируем локальный (0,0) в центр экрана, чтобы не было "пустоты"
  useLayoutEffect(() => {
    if (!currentParentId) return; // на корне не трогаем
    if (visibleNodes.length === 0 && !didAutoCenter.current) {
      const s = viewport.scale;
      const targetX = width / 2 - levelOrigin.x * s;
      const targetY = height / 2 - levelOrigin.y * s;
      if (viewport.x !== targetX || viewport.y !== targetY) {
        setViewport({ x: targetX, y: targetY, scale: s });
      }
      didAutoCenter.current = true;
      log.debug('autocenter:empty-level', { parent: currentParentId });
    }
  }, [currentParentId, visibleNodes.length, levelOrigin.x, levelOrigin.y, width, height, viewport.scale, viewport.x, viewport.y, setViewport, log]);

  // Принудительный редроу Stage при смене уровня/viewport/видимых узлов (фикс пустоты до первого действия)
  useEffect(() => {
    try {
      const s = stageRef.current as unknown as { batchDraw?: () => void } | null;
      s?.batchDraw?.();
    } catch {}
  }, [currentParentId, visibleNodes.length, viewport.x, viewport.y, viewport.scale]);

  const ctxNode = useMemo(() => (ctxMenu ? nodes.find((n) => n.id === ctxMenu.nodeId) : null), [ctxMenu, nodes]);

  // HUD-подсказка для связей рядом с курсором
  const [hoverHUD, setHoverHUD] = useState<{ x: number; y: number; text: string } | null>(null);
  const showLinkHud = useMemo(() => tool === 'link', [tool]);

  // Безрыжковое центрирование: вычисляем целевые x/y для уровня и используем их сразу на первом кадре
  const lastLevelRef = useRef<string | '__INIT__' | null>('__INIT__');
  const desiredViewport = useMemo(() => {
    const s = viewport.scale;
    if (visibleNodes.length > 0 && levelBBox) {
      return { x: width / 2 - (levelOrigin.x + levelBBox.cx) * s, y: height / 2 - (levelOrigin.y + levelBBox.cy) * s };
    }
    return { x: width / 2 - levelOrigin.x * s, y: height / 2 - levelOrigin.y * s };
  }, [levelBBox, levelOrigin.x, levelOrigin.y, visibleNodes.length, width, height, viewport.scale]);
  const isNewLevel = lastLevelRef.current !== currentParentId;
  const notSynced = Math.abs(viewport.x - desiredViewport.x) > 0.5 || Math.abs(viewport.y - desiredViewport.y) > 0.5;
  const initializing = isNewLevel || (!didAutoCenter.current) || notSynced;
  const stageX = initializing ? desiredViewport.x : viewport.x;
  const stageY = initializing ? desiredViewport.y : viewport.y;
  useLayoutEffect(() => {
    if (lastLevelRef.current !== currentParentId) {
      setViewport({ x: desiredViewport.x, y: desiredViewport.y, scale: viewport.scale });
      didAutoCenter.current = true;
      lastLevelRef.current = currentParentId;
    }
  }, [currentParentId, desiredViewport.x, desiredViewport.y, setViewport, viewport.scale]);

  // wheel zoom
  const onWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.05;
    const stage = stageRef.current!;
    const oldScale = stage.scaleX();

    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    setViewport({ x: newPos.x, y: newPos.y, scale: newScale });
    log.debug('wheel', { oldScale, newScale, pointer: { x: pointer?.x, y: pointer?.y }, newPos });
  }, [viewport.x, viewport.y, setViewport, log]);

  // drag to pan when tool=pan or when space pressed
  const isPanningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const clickedOnStage = e.target === e.target.getStage();
    if (!clickedOnStage) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    // Точное преобразование указателя в локальные координаты уровня
    let lx: number, ly: number;
    const grp = levelGroupRef.current;
    if (grp) {
      const t = grp.getAbsoluteTransform().copy();
      t.invert();
      const p = t.point(pointer);
      lx = p.x; ly = p.y;
    } else {
      const sx = stageRef.current ? stageRef.current.x() : viewport.x;
      const sy = stageRef.current ? stageRef.current.y() : viewport.y;
      const sc = stageRef.current ? stageRef.current.scaleX() : viewport.scale;
      const worldX = (pointer.x - sx) / sc;
      const worldY = (pointer.y - sy) / sc;
      lx = worldX - levelOrigin.x;
      ly = worldY - levelOrigin.y;
    }
    // Ctrl/Cmd -> рамочный выбор (локальные координаты уровня)
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const additive = true; // всегда мультивыделение
      setLasso({ x: lx, y: ly, w: 0, h: 0, additive });
      isPanningRef.current = false;
      lastPosRef.current = null;
      log.debug('lasso:start', { lx, ly });
      return;
    }
    // иначе панорамирование
    isPanningRef.current = true;
    lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    log.debug('pan:start', { x: e.evt.clientX, y: e.evt.clientY });
  }, [viewport.x, viewport.y, viewport.scale, log]);

  const onMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    // lasso
    if (lasso) {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      let lx: number, ly: number;
      const grp = levelGroupRef.current;
      if (grp) {
        const t = grp.getAbsoluteTransform().copy();
        t.invert();
        const p = t.point(pointer);
        lx = p.x; ly = p.y;
      } else {
        const sx = stageRef.current ? stageRef.current.x() : viewport.x;
        const sy = stageRef.current ? stageRef.current.y() : viewport.y;
        const sc = stageRef.current ? stageRef.current.scaleX() : viewport.scale;
        const worldX = (pointer.x - sx) / sc;
        const worldY = (pointer.y - sy) / sc;
        lx = worldX - levelOrigin.x;
        ly = worldY - levelOrigin.y;
      }
      setLasso((prev) => (prev ? { ...prev, w: lx - prev.x, h: ly - prev.y } : prev));
      return;
    }
    // pan
    if (!isPanningRef.current) return;
    const last = lastPosRef.current;
    if (!last) return;
    const dx = e.evt.clientX - last.x;
    const dy = e.evt.clientY - last.y;
    lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    setViewport({ x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale });
    log.debug('pan:move', { dx, dy });
  }, [lasso, viewport, setViewport, log]);

  const onMouseUp = useCallback(() => {
    if (lasso) {
      // финал lasso — выделяем объекты
      const rx = Math.min(lasso.x, lasso.x + lasso.w);
      const ry = Math.min(lasso.y, lasso.y + lasso.h);
      const rw = Math.abs(lasso.w);
      const rh = Math.abs(lasso.h);
      const idsInRect = visibleNodes
        .filter((n) => rectsIntersect(n.x, n.y, n.width, n.height, rx, ry, rw, rh))
        .map((n) => n.id);
      if (lasso.additive) {
        const next = new Set(selection);
        idsInRect.forEach((id) => next.add(id));
        setSelection(Array.from(next));
      } else {
        setSelection(idsInRect);
      }
      setLasso(null);
      log.info('lasso:apply', { count: idsInRect.length });
      // предотвратить немедленный сброс выделения кликом по Stage после рамочного выбора
      lassoClickGuardRef.current = true;
      return;
    }
    isPanningRef.current = false;
    log.debug('pan:end');
  }, [lasso, visibleNodes, selection, setSelection, log]);

  // touch for pan/pinch
  const onTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches && touches.length >= 2) {
      // pinch-zoom
      const p1 = touches[0];
      const p2 = touches[1];
      const center = { x: (p1.clientX + p2.clientX) / 2, y: (p1.clientY + p2.clientY) / 2 };
      const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      if (!lastCenter.current) {
        lastCenter.current = center;
        lastDist.current = dist;
        return;
      }
      const newScale = viewport.scale * (dist / lastDist.current);
      const pointTo = {
        x: (center.x - viewport.x) / viewport.scale,
        y: (center.y - viewport.y) / viewport.scale,
      };
      const newPos = {
        x: center.x - pointTo.x * newScale,
        y: center.y - pointTo.y * newScale,
      };
      setViewport({ x: newPos.x, y: newPos.y, scale: newScale });
      lastCenter.current = center;
      lastDist.current = dist;
      log.debug('pinch', { newScale, center });
    } else {
      const touch1 = touches && touches[0];
      if (touch1) {
        // pan
        if (!lastPosRef.current) {
          lastPosRef.current = { x: touch1.clientX, y: touch1.clientY };
          return;
        }
        const dx = touch1.clientX - lastPosRef.current.x;
        const dy = touch1.clientY - lastPosRef.current.y;
        lastPosRef.current = { x: touch1.clientX, y: touch1.clientY };
        setViewport({ x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale });
        log.debug('touch:pan', { dx, dy });
      }
    }
  }, [viewport, setViewport, log]);

  const onTouchEnd = useCallback(() => {
    lastCenter.current = null;
    lastDist.current = 0;
    lastPosRef.current = null;
    log.debug('touch:end');
  }, [log]);

  // удалены старые обработчики перетаскивания (перенесено ниже в мульти-логике)

  const handleNodeClick = useCallback((id: string, ev?: KonvaEventObject<MouseEvent>) => {
    if (tool !== 'link') {
      const evt = ev?.evt as MouseEvent | undefined;
      const shift = !!(evt && (evt.shiftKey || evt.metaKey || evt.ctrlKey));
      if (shift) {
        const next = new Set<string>(selection);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelection(Array.from(next));
      } else {
        setSelection([id]);
      }
      log.info('node:click', { id, tool });
    } else if (tool === 'link') {
      if (!pendingLinkFrom) {
        setPendingLinkFrom(id);
        setSelection([id]);
        log.info('link:start', { from: id });
      } else if (pendingLinkFrom && pendingLinkFrom !== id) {
        void addLink(pendingLinkFrom, id);
        setPendingLinkFrom(null);
        setSelection([]);
        log.info('link:connect', { from: pendingLinkFrom, to: id });
      }
    } else if (tool === 'add-task' || tool === 'add-group' || tool === 'add-person-employee' || tool === 'add-person-partner' || tool === 'add-person-bot') {
      // ignore clicks in create modes
    }
  }, [tool, pendingLinkFrom, addLink, setSelection, selection, log]);

  const handleNodeDblClick = useCallback((node: AnyNode) => {
    if (node.type === 'group') {
      enterGroup(node.id);
      log.info('group:enter', { id: node.id });
    } else if (node.type === 'task' || node.type === 'person') {
      setEditingNodeId(node.id);
      log.info('edit:start', { id: node.id, type: node.type });
    }
  }, [enterGroup, setEditingNodeId, log]);

  // Проекция узла на текущий уровень: если узел глубже — возвращаем ближайшую группу-предка, находящуюся на текущем уровне; если узел вне нашей ветки — null
  const projectToLevel = useCallback((nodeId: string): AnyNode | null => {
    const n0 = nodes.find((n) => n.id === nodeId);
    if (!n0) return null;
    if (n0.parentId === currentParentId) return n0; // уже на уровне
    // если это группа, возможно сама группа лежит на уровне как дочерняя следующей группы
    let p = n0.parentId;
    const visited = new Set<string>();
    let hops = 0;
    while (p && !visited.has(p) && hops < 1000) {
      visited.add(p);
      const g = nodes.find((nn) => nn.id === p && nn.type === 'group') as GroupNode | undefined;
      if (!g) break;
      if (g.parentId === currentParentId) return g; // ближайшая группа на уровне
      p = g.parentId;
      hops++;
    }
    return null;
  }, [nodes, currentParentId]);

  // Ссылки, отрисованные на текущем уровне (сквозные связи поднимаются до группы)
  const renderedLinks = useMemo(() => {
    const t0 = performance.now();
    const list: Array<{ base: typeof links[number]; from: AnyNode; to: AnyNode }> = [];
    try {
      links.forEach((l) => {
        const fromProj = projectToLevel(l.fromId);
        const toProj = projectToLevel(l.toId);
        if (fromProj && toProj && fromProj.id !== toProj.id) {
          list.push({ base: l, from: fromProj, to: toProj });
        }
      });
    } finally {
      const dt = performance.now() - t0;
      if (dt > 20 && diag) log.warn('perf:renderedLinks:slow', { ms: Math.round(dt), linksInput: links.length, linksOutput: list.length });
    }
    return list;
  }, [links, projectToLevel, diag, log]);

  // Performance mode: упрощаем отрисовку при больших графах или сильном отдалении
  const basePerf = useMemo(() => (
    visibleNodes.length > 300 || links.length > 600 || viewport.scale < 0.35
  ), [visibleNodes.length, links.length, viewport.scale]);
  const baseSuper = useMemo(() => (
    visibleNodes.length > 800 || links.length > 1600 || viewport.scale < 0.2
  ), [visibleNodes.length, links.length, viewport.scale]);
  const { perfMode, superPerfMode } = useMemo(() => {
    if (perfModeOverride === 'perf') return { perfMode: true, superPerfMode: false };
    if (perfModeOverride === 'super') return { perfMode: true, superPerfMode: true };
    return { perfMode: basePerf, superPerfMode: baseSuper };
  }, [perfModeOverride, basePerf, baseSuper]);
  const linksToRender = useMemo(() => {
    if (superPerfMode) return renderedLinks.slice(0, 600);
    if (perfMode) return renderedLinks.slice(0, 2000);
    return renderedLinks;
  }, [renderedLinks, perfMode, superPerfMode]);

  useEffect(() => {
    if (!diag) return;
    log.info('perf:mode', { perfMode, superPerfMode, nodes: visibleNodes.length, linksTotal: links.length, scale: Number(viewport.scale.toFixed(3)), renderLinks: linksToRender.length });
  }, [perfMode, superPerfMode, visibleNodes.length, links.length, viewport.scale, linksToRender.length, diag, log]);

  useEffect(() => {
    log.debug('visible:update', { nodes: visibleNodes.length, links: renderedLinks.length, parent: currentParentId, tool });
  }, [visibleNodes, renderedLinks, currentParentId, tool, log]);

  // Мультиперетаскивание: запоминаем стартовые позиции выбранных узлов
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const handleNodeDragStart = useCallback((nodeId: string) => {
    const ids = selection.includes(nodeId) ? selection : [nodeId];
    const map = new Map<string, { x: number; y: number }>();
    ids.forEach((id) => {
      const n = nodes.find((nn) => nn.id === id);
      if (n) map.set(id, { x: n.x, y: n.y });
    });
    dragStartRef.current = map;
  }, [selection, nodes]);

  const handleNodeDragMove = useCallback((nodeId: string, e: KonvaEventObject<DragEvent>) => {
    const base = dragStartRef.current.get(nodeId);
    const t = e.target;
    if (!base) {
      // fallback: двигать только один узел
      moveNodeLocal(nodeId, t.x(), t.y());
      return;
    }
    const dx = t.x() - base.x;
    const dy = t.y() - base.y;
    dragStartRef.current.forEach((pos, id) => {
      moveNodeLocal(id, pos.x + dx, pos.y + dy);
    });
  }, [moveNodeLocal]);

  // Вспомогательная функция репарентинга одного узла с правилами
  const reparentOne = useCallback(async (nodeObj: AnyNode, newX: number, newY: number, forcedGroup?: GroupNode | null) => {
    const all = useAppStore.getState().nodes;
    const parentId = useAppStore.getState().currentParentId;
    const isGroupNode = nodeObj.type === 'group';
    const cx = newX + nodeObj.width / 2;
    const cy = newY + nodeObj.height / 2;
    const isDescendant = (candidateId: string, possibleAncestorId: string): boolean => {
      let p = (all.find((n) => n.id === candidateId) as AnyNode | undefined)?.parentId;
      const visited = new Set<string>();
      let hops = 0;
      while (p && !visited.has(p) && hops < 1000) {
        if (p === possibleAncestorId) return true;
        visited.add(p);
        const next = (all.find((n) => n.id === p) as AnyNode | undefined)?.parentId || null;
        p = next;
        hops++;
      }
      return false;
    };

    // определяем целевую группу на уровне (либо принудительную)
    const levelGroups = all.filter((n): n is GroupNode => n.type === 'group' && n.parentId === parentId);
    const insideGroup = forcedGroup || levelGroups.find((g) => {
      const r = Math.min(g.width, g.height) / 2;
      const gx = g.x + r;
      const gy = g.y + r;
      const d = Math.hypot(cx - gx, cy - gy);
      return d <= r;
    }) || null;

    if (insideGroup && nodeObj.parentId !== insideGroup.id) {
      if (isGroupNode) return; // не репарентим группы перетаскиванием, чтобы не "исчезали"
      if (isDescendant(insideGroup.id, nodeObj.id)) return; // не допускаем циклы для прочих
      // Ставим узел поближе к месту дропа внутри группы: к исходной точке, но с учётом отступа и занятости
      const margin = 12;
      let candX = newX - insideGroup.x;
      let candY = newY - insideGroup.y;
      candX = Math.max(margin, Math.min(insideGroup.width - nodeObj.width - margin, candX));
      candY = Math.max(margin, Math.min(insideGroup.height - nodeObj.height - margin, candY));
      const spot = findFreeSpot(candX, candY, nodeObj.width, nodeObj.height, insideGroup.id);
      const clampX = Math.max(margin, Math.min(insideGroup.width - nodeObj.width - margin, spot.x));
      const clampY = Math.max(margin, Math.min(insideGroup.height - nodeObj.height - margin, spot.y));
      await useAppStore.getState().updateNode(nodeObj.id, { parentId: insideGroup.id, x: clampX, y: clampY });
      log.info('reparent:into-group', { node: nodeObj.id, group: insideGroup.id });
      return;
    }

    // авто-вынос из группы на уровень выше: только для НЕ-групп и с порогом
    // и только если мы НЕ на уровне этой группы (иначе внутри группы узлы не должны "исчезать")
    const isChildOfGroup = !!nodeObj.parentId && !!all.find((n) => n.id === nodeObj.parentId && n.type === 'group');
    if (!isGroupNode && isChildOfGroup && nodeObj.parentId !== parentId) {
      const g = all.find((n) => n.id === nodeObj.parentId) as GroupNode | undefined;
      if (g) {
        const r = Math.min(g.width, g.height) / 2;
        const halfW = nodeObj.width / 2;
        const halfH = nodeObj.height / 2;
        const margin = 16;
        // Текущий уровень — это уровень группы?
        if (parentId === g.id) {
          // Мы ВНУТРИ группы: cx,cy заданы в локальных координатах группы.
          const dLocal = Math.hypot(cx - r, cy - r);
          const thresholdLocal = r + Math.max(halfW, halfH) * 0.35;
          if (dLocal > thresholdLocal) {
            const angle = Math.atan2(cy - r, cx - r);
            const gxParent = g.x + r;
            const gyParent = g.y + r;
            const outCx = gxParent + Math.cos(angle) * (r + margin + halfW);
            const outCy = gyParent + Math.sin(angle) * (r + margin + halfH);
            const baseX = outCx - halfW;
            const baseY = outCy - halfH;
            const spot = findFreeSpot(baseX, baseY, nodeObj.width, nodeObj.height, g.parentId);
            await useAppStore.getState().updateNode(nodeObj.id, { parentId: g.parentId, x: spot.x, y: spot.y });
            log.info('reparent:out-of-group', { node: nodeObj.id, from: g.id, to: g.parentId });
          }
        } else {
          // Мы на уровне родителя группы: cx,cy уже в координатах родителя.
          const gxParent = g.x + r;
          const gyParent = g.y + r;
          const dParent = Math.hypot(cx - gxParent, cy - gyParent);
          const thresholdParent = r + Math.max(halfW, halfH) * 0.35;
          if (dParent > thresholdParent) {
            const angle = Math.atan2(cy - gyParent, cx - gxParent);
            const outCx = gxParent + Math.cos(angle) * (r + margin + halfW);
            const outCy = gyParent + Math.sin(angle) * (r + margin + halfH);
            const baseX = outCx - halfW;
            const baseY = outCy - halfH;
            const spot = findFreeSpot(baseX, baseY, nodeObj.width, nodeObj.height, g.parentId);
            await useAppStore.getState().updateNode(nodeObj.id, { parentId: g.parentId, x: spot.x, y: spot.y });
            log.info('reparent:out-of-group', { node: nodeObj.id, from: g.id, to: g.parentId });
          }
        }
      }
    }
  }, [log]);

  const handleNodeDragEnd = useCallback((node: AnyNode, e: KonvaEventObject<DragEvent>) => {
    const t = e.target; const newX = t.x(); const newY = t.y();
    const base = dragStartRef.current.get(node.id);
    // Определяем целевую группу по лидеру
    const all = useAppStore.getState().nodes;
    const parentId = useAppStore.getState().currentParentId;
    const cx = newX + node.width / 2; const cy = newY + node.height / 2;
    const levelGroups = all.filter((n): n is GroupNode => n.type === 'group' && n.parentId === parentId);
    const leaderInside = levelGroups.find((g) => {
      const r = Math.min(g.width, g.height) / 2; const gx = g.x + r; const gy = g.y + r; return Math.hypot(cx - gx, cy - gy) <= r;
    }) || null;

    if (!base || dragStartRef.current.size <= 1) {
      // одиночный перетаск
      void moveNode(node.id, newX, newY).then(async () => { await reparentOne(node, newX, newY, leaderInside); });
      dragStartRef.current.clear();
      return;
    }
    // мультиперетаск: двигаем все по относительному смещению лидера
    const dx = newX - base.x; const dy = newY - base.y;
    const ids = Array.from(dragStartRef.current.keys());
    // Сначала фиксируем новые позиции
    Promise.all(ids.map(async (id) => {
      const pos = dragStartRef.current.get(id)!;
      await moveNode(id, pos.x + dx, pos.y + dy);
    })).then(async () => {
      // затем репарентим: если лидер вошёл в группу — всем одну группу
      for (const id of ids) {
        const n = useAppStore.getState().nodes.find((nn) => nn.id === id);
        if (!n) continue;
        const pos = dragStartRef.current.get(id)!;
        const nx = pos.x + dx, ny = pos.y + dy;
        await reparentOne(n as AnyNode, nx, ny, leaderInside);
      }
      dragStartRef.current.clear();
    });
  }, [moveNode, reparentOne]);

  // Keyboard shortcuts: F — тумблер режима связей, T/G/E/R/B — инструменты добавления
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      if (editingNodeId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selection.length === 0 && linkSelection.length === 0) return;
        const ok = window.confirm('Удалить выбранное?');
        if (!ok) return;
        void deleteSelection();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          void redo();
        } else {
          void undo();
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        void redo();
      } else if (e.key === 'Escape') {
        setSelection([]);
        setLinkSelection([]);
        setEditingNodeId(null);
        setCtxMenu(null);
        setLinkCtxMenu(null);
      } else if (e.key === 'f' || e.key === 'F') {
        const now = useAppStore.getState().tool;
        const next = now === 'link' ? 'none' : 'link';
        setTool(next);
        if (next !== 'link') setPendingLinkFrom(null);
        log.debug('hotkey:F:toggle', { from: now, to: next });
      } else {
        // Добавление: T/G/E/R/B — тумблер инструментов
        const k = e.key.toLowerCase();
        const map: Record<string, typeof tool> = {
          't': 'add-task',
          'g': 'add-group',
          'e': 'add-person-employee',
          'r': 'add-person-partner',
          'b': 'add-person-bot',
        } as const;
        if (k in map) {
          const desired = map[k];
          const now = useAppStore.getState().tool;
          const next = now === desired ? 'none' : desired;
          setTool(next);
          log.debug('hotkey:add:toggle', { key: k, from: now, to: next });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteSelection, setSelection, setLinkSelection, setEditingNodeId, editingNodeId, selection.length, linkSelection.length, undo, redo, setTool, log]);

  // Inline editor overlay
  const editingNode = useMemo(() => nodes.find((n) => n.id === editingNodeId), [nodes, editingNodeId]);
  const [editValue, setEditValue] = useState('');
  useEffect(() => {
    if (editingNode) {
      if (editingNode.type === 'task') {
        const t = editingNode as TaskNode;
        const combined = t.description ? `${t.title}\n\n${t.description}` : t.title;
        setEditValue(combined);
      } else {
        setEditValue((editingNode as PersonNode).name);
      }
    } else {
      setEditValue('');
    }
  }, [editingNode]);

  const commitEdit = useCallback(async () => {
    if (!editingNode) return;
    if (editingNode.type === 'task') {
      // Разбиваем текст: до первой пустой строки — заголовок; остальное — описание
      const parts = editValue.replace(/\r\n/g, '\n').split(/\n\n+/);
      const title = parts[0] ?? '';
      const description = parts.slice(1).join('\n\n') || undefined;
      await useAppStore.getState().updateNode(editingNode.id, { title, description });
    } else if (editingNode.type === 'person') {
      await useAppStore.getState().updateNode(editingNode.id, { name: editValue });
    }
    setEditingNodeId(null);
    log.info('edit:commit', { id: editingNode.id });
  }, [editingNode, editValue, setEditingNodeId, log]);

  const editorStyle = useMemo(() => {
    if (!editingNode) return undefined;
    // учитываем смещение родительской группы
    let baseX = editingNode.x;
    let baseY = editingNode.y;
    if (editingNode.parentId) {
      const parent = nodes.find((n) => n.id === editingNode.parentId && n.type === 'group') as GroupNode | undefined;
      if (parent) {
        baseX += parent.x;
        baseY += parent.y;
      }
    }
    const screenX = baseX * viewport.scale + viewport.x + 12;
    const screenY = baseY * viewport.scale + viewport.y + 8;
    const w = Math.max(80, Math.min(600, editingNode.width * viewport.scale - 24));
    return {
      position: 'fixed' as const,
      left: `${screenX}px`,
      top: `${screenY}px`,
      width: `${w}px`,
      zIndex: 1000,
    };
  }, [editingNode, viewport, nodes]);

  return (
    <div className="board-canvas" style={{ position: 'fixed', inset: 0 }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        x={stageX}
        y={stageY}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ background: 'var(--paper-bg)' }}
        onClick={(e) => {
          // Create nodes on empty space click in creation tools
          const stage = e.target.getStage();
          if (!stage) return;
          const clickedOnEmpty = e.target === stage;
          if (!clickedOnEmpty) return;
          if (tool === 'none') {
            if (lassoClickGuardRef.current) { lassoClickGuardRef.current = false; return; }
            setSelection([]);
            setCtxMenu(null);
            if (lasso) return; // не сбрасываем при рамочном
            return;
          }
          const isAddPerson = tool === 'add-person-employee' || tool === 'add-person-partner' || tool === 'add-person-bot';
          if (tool === 'add-task' || tool === 'add-group' || isAddPerson) {
            (async () => {
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              // Локальные координаты уровня через абсолютный трансформ группы
              let lx: number, ly: number;
              const grp = levelGroupRef.current;
              if (grp) {
                const t = grp.getAbsoluteTransform().copy();
                t.invert();
                const p = t.point(pointer);
                lx = p.x; ly = p.y;
              } else {
                const sx = stageRef.current ? stageRef.current.x() : viewport.x;
                const sy = stageRef.current ? stageRef.current.y() : viewport.y;
                const sc = stageRef.current ? stageRef.current.scaleX() : viewport.scale;
                const worldX = (pointer.x - sx) / sc;
                const worldY = (pointer.y - sy) / sc;
                lx = worldX - levelOrigin.x;
                ly = worldY - levelOrigin.y;
              }
              if (tool === 'add-task') {
                const id = await addTask({ x: lx, y: ly });
                setSelection([id]);
                log.info('create:task', { id, lx, ly });
              } else if (tool === 'add-group') {
                const id = await addGroup('Группа', { x: lx, y: ly });
                setSelection([id]);
                log.info('create:group', { id, lx, ly });
              } else if (isAddPerson) {
                const role = tool === 'add-person-partner' ? 'partner' : tool === 'add-person-bot' ? 'bot' : 'employee';
                const name = role === 'partner' ? 'Партнер' : role === 'bot' ? 'Бот' : 'Сотрудник';
                const id = await addPerson(name, role, { x: lx, y: ly });
                setSelection([id]);
                log.info('create:person', { id, lx, ly, role });
              }
              // one-shot tool: выключаем после создания
              setTool('none');
            })();
          }
        }}
      >
        <Layer>
          <KonvaGroup ref={levelGroupRef} x={levelOrigin.x} y={levelOrigin.y}>
            {/* Lasso rectangle */}
            {lasso ? (
              <Rect
                x={Math.min(lasso.x, lasso.x + lasso.w)}
                y={Math.min(lasso.y, lasso.y + lasso.h)}
                width={Math.abs(lasso.w)}
                height={Math.abs(lasso.h)}
                fill={"rgba(80,120,255,0.12)"}
                stroke={"rgba(80,120,255,0.8)"}
                strokeWidth={1}
                dash={[6, 4]}
              />
            ) : null}
            {linksToRender.map(({ base: l, from, to }) => {
            const a = computeAnchorTowards(from, to);
            const b = computeAnchorTowards(to, from);
            const useBezier = !perfMode;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - 30;
            const hasReverse = links.some((r) => r.fromId === l.toId && r.toId === l.fromId);
            const stroke = l.color || '#C94545';
            return (
              <React.Fragment key={`rl-${l.id}`}>
                <Arrow
                  points={useBezier ? [a.x, a.y, mx, my, b.x, b.y] : [a.x, a.y, b.x, b.y]}
                  stroke={stroke}
                  strokeWidth={linkSelection.includes(l.id) ? 4 : 2}
                  tension={useBezier ? 0.5 : 0}
                  bezier={useBezier}
                  pointerLength={18}
                  pointerWidth={18}
                  fill={stroke}
                  pointerAtBeginning={(l.dir || 'one') === 'both' || hasReverse}
                  hitStrokeWidth={40}
                  perfectDrawEnabled={false}
                  shadowColor={perfMode ? undefined : '#00000080'}
                  shadowBlur={perfMode ? 0 : (linkSelection.includes(l.id) ? 10 : 6)}
                  onMouseEnter={(ev) => {
                    setHoveredLink(l.id);
                    if (showLinkHud) setHoverHUD({ x: ev.evt.clientX, y: ev.evt.clientY, text: `${nodeDisplayName(from)} ${(l.dir==='both'||hasReverse)?'↔':'→'} ${nodeDisplayName(to)}` });
                  }}
                  onMouseMove={(ev) => {
                    if (showLinkHud && hoveredLink === l.id) setHoverHUD({ x: ev.evt.clientX, y: ev.evt.clientY, text: `${nodeDisplayName(from)} ${(l.dir==='both'||hasReverse)?'↔':'→'} ${nodeDisplayName(to)}` });
                  }}
                  onMouseLeave={() => { setHoveredLink((p) => (p === l.id ? null : p)); setHoverHUD(null); }}
                  onClick={(ev) => {
                    const evt = ev.evt as MouseEvent;
                    if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
                      const next = new Set<string>(linkSelection);
                      if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
                      setLinkSelection(Array.from(next));
                    } else {
                      setLinkSelection([l.id]);
                    }
                    log.info('link:select', { id: l.id });
                  }}
                  onContextMenu={(ev) => {
                    ev.evt.preventDefault();
                    setLinkSelection([l.id]);
                    setLinkCtxMenu({ x: ev.evt.clientX, y: ev.evt.clientY, linkId: l.id });
                  }}
                />
              </React.Fragment>
            );
          })}

          {/* кросс-уровневые связи: штрихи с подписями */}
          {(() => {
            if (superPerfMode) return null; // в супермоде не рисуем стабы, чтобы не нагружать
            const idSet = new Set(visibleNodes.map((n) => n.id));
            const findNode = (id: string) => nodes.find((n) => n.id === id);
            const parentWorld = (() => {
              if (!currentParentId) return { x: 0, y: 0 };
              const grp = nodes.find((n) => n.id === currentParentId) as GroupNode | undefined;
              if (!grp) return { x: 0, y: 0 };
              const getWorld = (n: AnyNode): { x: number; y: number } => {
                let x = n.x, y = n.y; let p = n.parentId;
                const visited = new Set<string>(); let hops = 0;
                while (p && !visited.has(p) && hops < 1000) {
                  visited.add(p);
                  const pg = nodes.find((nn) => nn.id === p) as GroupNode | undefined; if (!pg) break;
                  x += pg.x; y += pg.y; p = pg.parentId; hops++;
                }
                return { x, y };
              };
              return getWorld(grp);
            })();
            const getWorldCenter = (n: AnyNode) => {
              let x = n.x, y = n.y; let p = n.parentId;
              const visited = new Set<string>(); let hops = 0;
              while (p && !visited.has(p) && hops < 1000) { const pg = nodes.find((nn) => nn.id === p) as GroupNode | undefined; if (!pg) break; visited.add(p); x += pg.x; y += pg.y; p = pg.parentId; hops++; }
              return { x: x + n.width / 2, y: y + n.height / 2 };
            };
            const toLocal = (w: { x: number; y: number }) => ({ x: w.x - parentWorld.x, y: w.y - parentWorld.y });
            const t0 = performance.now();
            const list: React.ReactNode[] = [];
            links.forEach((l) => {
              const a = findNode(l.fromId); const b = findNode(l.toId);
              if (!a || !b) return;
              const aVisible = idSet.has(a.id); const bVisible = idSet.has(b.id);
              // Если обе стороны проецируются на текущий уровень — отрисовано как стрелка выше
              const aProj = projectToLevel(a.id);
              const bProj = projectToLevel(b.id);
              if (aProj && bProj) return;
              if (!aVisible && !bVisible) return; // не относимся к текущему уровню
              const visibleNode = aVisible ? a : b;
              const hiddenNode = aVisible ? b : a;
              // обе точки в координатах текущего уровня
              const vWorld = getWorldCenter(visibleNode);
              const vLocal = toLocal(vWorld);
              const hWorld = getWorldCenter(hiddenNode);
              const hLocal = toLocal(hWorld);
              // направляющий вектор
              const dx = hLocal.x - vLocal.x; const dy = hLocal.y - vLocal.y; const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              // якорим старт по границе видимого узла в сторону скрытого
              const start = computeAnchorTowardsPoint(visibleNode, hLocal);
              const ex = start.x + ux * 60; const ey = start.y + uy * 60; // 60px штрих
              const label = nodeDisplayName(hiddenNode);
              list.push(
                <React.Fragment key={`stub-${l.id}`}>
                  {/* стрелочка усеченная: направление с учетом ориентации */}
                  {(() => {
                    const dir = l.dir || 'one';
                    const points = (() => {
                      if (dir === 'both') return [start.x, start.y, ex, ey];
                      // если from виден, рисуем от видимого наружу; иначе — к видимому внутрь
                      return aVisible ? [start.x, start.y, ex, ey] : [ex, ey, start.x, start.y];
                    })();
                    return (
                      <Arrow points={points} stroke={l.color || '#C94545'} fill={l.color || '#C94545'} strokeWidth={2} dash={[8, 6]} pointerLength={14} pointerWidth={14}
                        perfectDrawEnabled={false}
                        shadowColor={perfMode ? undefined : '#00000080'} shadowBlur={perfMode ? 0 : 6}
                        hitStrokeWidth={40}
                        onMouseEnter={(ev) => { setHoveredStub(l.id); if (showLinkHud) setHoverHUD({ x: ev.evt.clientX, y: ev.evt.clientY, text: `${(l.dir||'one')==='both' ? '↔' : '→'} ${label}` }); }}
                        onMouseMove={(ev) => { if (showLinkHud && hoveredStub === l.id) setHoverHUD({ x: ev.evt.clientX, y: ev.evt.clientY, text: `${(l.dir||'one')==='both' ? '↔' : '→'} ${label}` }); }}
                        onMouseLeave={() => { setHoveredStub((p) => (p === l.id ? null : p)); setHoverHUD(null); }} />
                    );
                  })()}
                </React.Fragment>
              );
            });
            const dt = performance.now() - t0;
            if (dt > 20 && diag) log.warn('perf:stubs:slow', { ms: Math.round(dt), links: links.length, stubs: list.length });
            return list;
          })()}

          {visibleNodes.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              selected={selection.includes(n.id)}
              onDragStart={() => handleNodeDragStart(n.id)}
              onDragMove={(e) => handleNodeDragMove(n.id, e)}
              onDragEnd={(e) => handleNodeDragEnd(n, e)}
              onClick={(e) => { handleNodeClick(n.id, e); }}
              onDblClick={() => handleNodeDblClick(n)}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                setSelection([n.id]);
                setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, nodeId: n.id });
              }}
            />
          ))}
          </KonvaGroup>
        </Layer>
      </Stage>
      {ctxMenu && ctxNode ? (
        <div
          style={{ position: 'fixed', left: Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 360)), top: Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 480)), background: '#222', color: '#fff', padding: 8, borderRadius: 6, zIndex: 1001, minWidth: 240, maxHeight: Math.max(240, window.innerHeight - 16), overflowY: 'auto', boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {ctxNode.type === 'task' ? (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Задача</div>
              <label style={{ display: 'block', marginBottom: 6 }}>Цвет
                <input type="color" style={{ width: '100%' }} value={(ctxNode as TaskNode).color || '#E8D8A6'} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { color: e.target.value }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Смайлик
                <input style={{ width: '100%' }} value={(ctxNode as TaskNode).iconEmoji || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { iconEmoji: e.target.value }); }} placeholder="🧩" />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Дедлайн
                <input type="date" style={{ width: '100%' }} value={(ctxNode as TaskNode).dueDate ? (ctxNode as TaskNode).dueDate!.slice(0,10) : ''} onChange={(e) => { const v = e.target.value ? new Date(e.target.value).toISOString() : undefined; void useAppStore.getState().updateNode(ctxNode.id, { dueDate: v }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Срочность
                <select style={{ width: '100%' }} value={(ctxNode as TaskNode).priority || 'med'} onChange={(e) => { const val = e.target.value as 'low'|'med'|'high'; void useAppStore.getState().updateNode(ctxNode.id, { priority: val }); }}>
                  <option value="low">Низкая</option>
                  <option value="med">Средняя</option>
                  <option value="high">Высокая</option>
                </select>
              </label>
              <fieldset className="inspector__fieldset" style={{ marginBottom: 6 }}>
                <legend style={{ fontSize: 12, color: '#ccc' }}>Текст</legend>
                <label className="radio" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={typeof (ctxNode as TaskNode).textSize !== 'number'}
                    onChange={(e) => {
                      const auto = e.target.checked;
                      if (auto) {
                        void useAppStore.getState().updateNode(ctxNode.id, { textSize: undefined });
                      } else {
                        const t = ctxNode as TaskNode;
                        const base = Math.round(Math.min(t.width / 5, t.height / 2.4));
                        void useAppStore.getState().updateNode(ctxNode.id, { textSize: Math.max(10, Math.min(72, base)) });
                      }
                    }}
                  />
                  <span>Авто размер текста</span>
                </label>
                <label style={{ display: 'block' }}>
                  Размер текста
                  <input
                    type="range"
                    min={10}
                    max={72}
                    step={1}
                    disabled={typeof (ctxNode as TaskNode).textSize !== 'number'}
                    value={(ctxNode as TaskNode).textSize ?? 16}
                    onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { textSize: Number(e.target.value) }); }}
                  />
                </label>
              </fieldset>
              <label style={{ display: 'block', marginBottom: 6 }}>Исполнитель (имя)
                <input style={{ width: '100%' }} value={(ctxNode as TaskNode).assigneeName || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { assigneeName: e.target.value }); }} placeholder="Имя" />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Исполнитель (эмодзи)
                <input style={{ width: '100%' }} value={(ctxNode as TaskNode).assigneeEmoji || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { assigneeEmoji: e.target.value }); }} placeholder="🙂" />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Статус
                <select style={{ width: '100%' }} value={(ctxNode as TaskNode).status} onChange={(e) => { const val = e.target.value as TaskStatus; void useAppStore.getState().updateNode(ctxNode.id, { status: val }); }}>
                  <option value="active">Активная</option>
                  <option value="in_progress">В процессе</option>
                  <option value="deferred">Отложенная</option>
                  <option value="inactive">Неактивная</option>
                  <option value="done">Сделана</option>
                </select>
              </label>
              <button onClick={() => { if (window.confirm('Удалить выбранное?')) { void deleteSelection(); setCtxMenu(null); } }} style={{ display: 'block', width: '100%', marginTop: 8 }}>Удалить</button>
              {ctxNode.parentId ? (
                <button style={{ display: 'block', width: '100%', marginTop: 6 }} onClick={async () => {
                  const all = useAppStore.getState().nodes;
                  const parent = all.find((n) => n.id === ctxNode.parentId) as GroupNode | undefined;
                  if (!parent) return;
                  const newParentId: string | null = parent.parentId ?? null;
                  // координаты на уровне выше = локальные + координаты группы
                  const baseX = (ctxNode as TaskNode).x + parent.x;
                  const baseY = (ctxNode as TaskNode).y + parent.y;
                  const spot = findFreeSpot(baseX, baseY, (ctxNode as TaskNode).width, (ctxNode as TaskNode).height, newParentId);
                  await useAppStore.getState().updateNode(ctxNode.id, { parentId: newParentId, x: spot.x, y: spot.y });
                  setCtxMenu(null);
                }}>Вывести из группы</button>
              ) : null}
            </div>
          ) : ctxNode.type === 'group' ? (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Группа</div>
              <label style={{ display: 'block', marginBottom: 6 }}>Название
                <input style={{ width: '100%' }} value={(ctxNode as GroupNode).name} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { name: e.target.value }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Описание
                <textarea style={{ width: '100%' }} value={(ctxNode as GroupNode).description || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { description: e.target.value }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 6 }}>Цвет
                <input type="color" style={{ width: '100%' }} value={(ctxNode as GroupNode).color || '#AEC6CF'} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { color: e.target.value }); }} />
              </label>
              <fieldset className="inspector__fieldset" style={{ marginBottom: 6 }}>
                <legend style={{ fontSize: 12, color: '#ccc' }}>Заголовок</legend>
                <label className="radio" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={typeof (ctxNode as GroupNode).titleSize !== 'number'}
                    onChange={(e) => {
                      const auto = e.target.checked;
                      if (auto) {
                        void useAppStore.getState().updateNode(ctxNode.id, { titleSize: undefined });
                      } else {
                        void useAppStore.getState().updateNode(ctxNode.id, { titleSize: 24 });
                      }
                    }}
                  />
                  <span>Авто размер заголовка</span>
                </label>
                <label style={{ display: 'block' }}>
                  Размер заголовка
                  <input
                    type="range"
                    min={10}
                    max={64}
                    step={1}
                    disabled={typeof (ctxNode as GroupNode).titleSize !== 'number'}
                    value={(ctxNode as GroupNode).titleSize ?? 24}
                    onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { titleSize: Number(e.target.value) }); }}
                  />
                </label>
              </fieldset>
              <button onClick={() => { if (window.confirm('Удалить выбранное?')) { void deleteSelection(); setCtxMenu(null); } }} style={{ display: 'block', width: '100%', marginTop: 8 }}>Удалить</button>
              {ctxNode.parentId ? (
                <button style={{ display: 'block', width: '100%', marginTop: 6 }} onClick={async () => {
                  const all = useAppStore.getState().nodes;
                  const parent = all.find((n) => n.id === ctxNode.parentId) as GroupNode | undefined;
                  if (!parent) return;
                  const newParentId: string | null = parent.parentId ?? null;
                  const baseX = (ctxNode as GroupNode).x + parent.x;
                  const baseY = (ctxNode as GroupNode).y + parent.y;
                  const size = Math.max((ctxNode as GroupNode).width, (ctxNode as GroupNode).height);
                  const spot = findFreeSpot(baseX, baseY, size, size, newParentId);
                  await useAppStore.getState().updateNode(ctxNode.id, { parentId: newParentId, x: spot.x, y: spot.y });
                  setCtxMenu(null);
                }}>Вывести из группы</button>
              ) : null}
            </div>
          ) : ctxNode.type === 'person' ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Контакты</div>
              <label style={{ display: 'block', marginBottom: 4 }}>Email
                <input style={{ width: '100%' }} value={(ctxNode as PersonNode).contacts?.email || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { contacts: { ...(ctxNode as PersonNode).contacts, email: e.target.value } }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>Телефон
                <input style={{ width: '100%' }} value={(ctxNode as PersonNode).contacts?.phone || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { contacts: { ...(ctxNode as PersonNode).contacts, phone: e.target.value } }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>Заметки
                <textarea style={{ width: '100%' }} value={(ctxNode as PersonNode).contacts?.notes || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { contacts: { ...(ctxNode as PersonNode).contacts, notes: e.target.value } }); }} />
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>Фото (URL)
                <input style={{ width: '100%' }} value={(ctxNode as PersonNode).avatarUrl || ''} onChange={(e) => { void useAppStore.getState().updateNode(ctxNode.id, { avatarUrl: e.target.value }); }} placeholder="https://..." />
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>Загрузить фото
                <input type="file" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => { if (ctxNode) { void useAppStore.getState().updateNode(ctxNode.id, { avatarUrl: String(reader.result) }); } };
                  reader.readAsDataURL(file);
                }} />
              </label>
              <button onClick={() => { if (window.confirm('Удалить выбранное?')) { void deleteSelection(); setCtxMenu(null); } }} style={{ display: 'block', width: '100%', marginTop: 8 }}>Удалить</button>
              {ctxNode.parentId ? (
                <button style={{ display: 'block', width: '100%', marginTop: 6 }} onClick={async () => {
                  const all = useAppStore.getState().nodes;
                  const parent = all.find((n) => n.id === ctxNode.parentId) as GroupNode | undefined;
                  if (!parent) return;
                  const newParentId: string | null = parent.parentId ?? null;
                  const baseX = (ctxNode as PersonNode).x + parent.x;
                  const baseY = (ctxNode as PersonNode).y + parent.y;
                  const size = Math.max((ctxNode as PersonNode).width, (ctxNode as PersonNode).height);
                  const spot = findFreeSpot(baseX, baseY, size, size, newParentId);
                  await useAppStore.getState().updateNode(ctxNode.id, { parentId: newParentId, x: spot.x, y: spot.y });
                  setCtxMenu(null);
                }}>Вывести из группы</button>
              ) : null}
            </div>
          ) : null}
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => setCtxMenu(null)}>Закрыть</button>
          </div>
        </div>
      ) : null}
      {/* HUD-подсказка для связей: фиксированный размер рядом с курсором */}
      {hoverHUD && showLinkHud ? (
        <div style={{ position: 'fixed', left: hoverHUD.x + 12, top: hoverHUD.y + 12, background: '#fff', color: '#111', padding: '2px 6px', borderRadius: 4, boxShadow: '0 2px 10px rgba(0,0,0,0.2)', fontSize: 13, pointerEvents: 'none', zIndex: 1002 }}>
          {hoverHUD.text}
        </div>
      ) : null}
      {linkCtxMenu ? (
        <div
          style={{ position: 'fixed', left: Math.max(8, Math.min(linkCtxMenu.x, window.innerWidth - 360)), top: Math.max(8, Math.min(linkCtxMenu.y, window.innerHeight - 320)), background: '#222', color: '#fff', padding: 8, borderRadius: 6, zIndex: 1001, minWidth: 240, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Связь</div>
          <label style={{ display: 'block', marginBottom: 6 }}>Цвет
            <input type="color" style={{ width: '100%' }} value={(useAppStore.getState().links.find((l) => l.id === linkCtxMenu.linkId)?.color) || '#C94545'} onChange={(e) => { void useAppStore.getState().updateLink(linkCtxMenu.linkId, { color: e.target.value }); }} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>Направление
            <select style={{ width: '100%' }} value={(useAppStore.getState().links.find((l) => l.id === linkCtxMenu.linkId)?.dir) || 'one'} onChange={(e) => { const dir = e.target.value as 'one' | 'both'; void useAppStore.getState().updateLink(linkCtxMenu.linkId, { dir }); }}>
              <option value="one">Однонаправленная</option>
              <option value="both">Двунаправленная</option>
            </select>
          </label>
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => setLinkCtxMenu(null)}>Закрыть</button>
          </div>
        </div>
      ) : null}
      {editingNode && editorStyle ? (
        editingNode.type === 'task' ? (
          <textarea
            style={{ ...(editorStyle as React.CSSProperties), height: `${Math.max(40, editingNode.height * viewport.scale - 24)}px`, resize: 'none' }}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => void commitEdit()}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void commitEdit(); } else if (e.key === 'Escape') { setEditingNodeId(null); } }}
            autoFocus
          />
        ) : (
          <input
            style={editorStyle as React.CSSProperties}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => void commitEdit()}
            onKeyDown={(e) => { if (e.key === 'Enter') { void commitEdit(); } else if (e.key === 'Escape') { setEditingNodeId(null); } }}
            autoFocus
          />
        )
      ) : null}
    </div>
  );
};

const NodeShape: React.FC<{
  node: AnyNode;
  selected: boolean;
  onDragStart: (e: KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onDblClick: () => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void;
}> = ({ node, selected, onDragStart, onDragMove, onDragEnd, onClick, onDblClick, onContextMenu }) => {
  const isTask = node.type === 'task';
  const isGroup = node.type === 'group';
  const isPerson = node.type === 'person';
  const updateNode = useAppStore((s) => s.updateNode);
  const groupHasActive = useAppStore((s) => s.groupHasActive);
  const personAvatarUrl = node.type === 'person' ? (node as PersonNode).avatarUrl : undefined;
  const img = useHtmlImage(personAvatarUrl);

  if (isTask) {
    const t = node as TaskNode;
    const padX = Math.max(8, Math.round(t.width * 0.06));
    const padY = Math.max(6, Math.round(t.height * 0.05));
    const contentW = Math.max(0, t.width - padX * 2);
    const contentH = Math.max(0, t.height - padY * 2);
    const textStr = `${t.iconEmoji ? t.iconEmoji + ' ' : ''}${t.assigneeEmoji ?? ''} ${t.assigneeName ? t.assigneeName + ': ' : ''}${t.title}${t.description ? '\n\n' + t.description : ''}`;
    const baseFs = clamp(Math.min(t.width / 5, t.height / 2.4), 12, 72);
    const fs = typeof t.textSize === 'number' ? t.textSize : estimateTaskFont(textStr, baseFs, contentW, contentH, 1.15);
    return (
      <KonvaGroup
        x={t.x}
        y={t.y}
        draggable
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onClick={(e) => onClick(e)}
        onDblClick={() => onDblClick()}
        onDblTap={() => onDblClick()}
        onContextMenu={onContextMenu}
      >
        <Rect
          width={t.width}
          height={t.height}
          fill={t.color || '#E8D8A6'}
          cornerRadius={8}
          shadowColor={'#00000099'}
          shadowBlur={selected ? 16 : 8}
          shadowOffset={{ x: 2, y: 3 }}
          stroke={selected ? '#F05A5A' : '#00000030'}
          strokeWidth={selected ? 2 : 1}
        />
        {/* clipped text area to prevent overflow */}
        <KonvaGroup x={padX} y={padY} clip={{ x: 0, y: 0, width: contentW, height: contentH }}>
          <Text
            x={0}
            y={0}
            width={contentW}
            height={contentH}
            text={textStr}
            fontSize={fs}
            fill={'#3B2F2F'}
            align="left"
            verticalAlign="top"
            wrap="word"
            lineHeight={1.15}
          />
        </KonvaGroup>
        {/* status dot when in_progress */}
        {t.status === 'in_progress' ? (
          <Circle x={t.width - 12} y={12} radius={6} fill={'#FF6B6B'} shadowBlur={8} />
        ) : null}

        {/* resize handle (bottom-right): хит-зона 15% от размеров */}
        {selected ? (
          <>
            {/* видимый маркер */}
            <Rect x={t.width - 14} y={t.height - 14} width={14} height={14} fill={'#6e5548'} cornerRadius={3} stroke={'#00000060'} strokeWidth={1} />
            {/* увеличенная хит-зона, адаптивная к зуму */}
            {(() => {
              const hitW = Math.max(8, Math.round(t.width * 0.15));
              const hitH = Math.max(8, Math.round(t.height * 0.15));
              return (
                <Rect
                  x={t.width - hitW}
                  y={t.height - hitH}
                  width={hitW}
                  height={hitH}
                  opacity={0.001}
                  draggable
                  onDragStart={(e) => { e.cancelBubble = true; }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const hx = e.target.x();
                    const hy = e.target.y();
                    const minW = 120, minH = 80, maxW = 1600, maxH = 1200;
                    const newW = Math.max(minW, Math.min(maxW, hx + hitW));
                    const newH = Math.max(minH, Math.min(maxH, hy + hitH));
                    void updateNode(t.id, { width: newW, height: newH });
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: t.width - hitW, y: t.height - hitH }); }}
                />
              );
            })()}
          </>
        ) : null}
      </KonvaGroup>
    );
  }

  if (isGroup) {
    const g = node as GroupNode;
    const r = Math.min(g.width, g.height) / 2;
    const baseGroup = clamp(r / 1.6, 12, 64);
    const titleWidth = Math.max(0, g.width - 16);
    const groupFs = typeof g.titleSize === 'number' ? g.titleSize : fitTitleFontSingleLine(g.name, baseGroup, titleWidth);
    const hasActive = groupHasActive(g.id);
    return (
      <KonvaGroup
        x={g.x}
        y={g.y}
        draggable
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onClick={(e) => onClick(e as unknown as KonvaEventObject<MouseEvent>)}
        onDblClick={() => onDblClick()}
        onDblTap={() => onDblClick()}
        onContextMenu={onContextMenu}
      >
        <Circle
          radius={r}
          x={r}
          y={r}
          fill={g.color || '#AEC6CF'}
          shadowColor={'#00000099'}
          shadowBlur={10}
          stroke={'#00000040'}
          strokeWidth={1}
        />
        {/* title */}
        <Text x={8} y={r - groupFs / 2} width={titleWidth} align="center" text={g.name} fontSize={groupFs} fill={'#2B1F1F'} fontStyle="bold" wrap="none" ellipsis />
        {/* active indicator */}
        {hasActive ? (
          <Circle x={g.width - 12} y={12} radius={6} fill={'#FF6B6B'} shadowBlur={8} />
        ) : null}

        {/* resize handle for group (keeps square) — 15% от размеров */}
        {selected ? (
          <>
            <Circle x={g.width - 10} y={g.height - 10} radius={8} fill={'#6e5548'} stroke={'#00000060'} strokeWidth={1} />
            {(() => {
              const hitW = Math.max(8, Math.round(g.width * 0.15));
              const hitH = Math.max(8, Math.round(g.height * 0.15));
              return (
                <Rect
                  x={g.width - hitW}
                  y={g.height - hitH}
                  width={hitW}
                  height={hitH}
                  opacity={0.001}
                  draggable
                  onDragStart={(e) => { e.cancelBubble = true; }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const hx = e.target.x();
                    const hy = e.target.y();
                    const minS = 100, maxS = 1600;
                    const size = Math.max(minS, Math.min(maxS, Math.max(hx + hitW, hy + hitH)));
                    void updateNode(g.id, { width: size, height: size });
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: g.width - hitW, y: g.height - hitH }); }}
                />
              );
            })()}
          </>
        ) : null}
      </KonvaGroup>
    );
  }

  if (isPerson) {
    const p = node as PersonNode;
    const r = Math.min(p.width, p.height) / 2;
    const nameFs = clamp(p.width / 4, 12, 48);
    return (
      <KonvaGroup
        x={p.x}
        y={p.y}
        draggable
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onClick={(e) => onClick(e as unknown as KonvaEventObject<MouseEvent>)}
        onDblClick={() => onDblClick()}
        onDblTap={() => onDblClick()}
        onContextMenu={onContextMenu}
      >
        {/* avatar background circle */}
        <Circle
          radius={r}
          x={r}
          y={r}
          fill={p.color || '#B3E5FC'}
          shadowColor={'#00000099'}
          shadowBlur={10}
          stroke={selected ? '#F05A5A' : '#00000040'}
          strokeWidth={selected ? 2 : 1}
        />
        {/* avatar image or emoji covering whole circle */}
        {img ? (
          <KonvaGroup x={0} y={0} clipFunc={(ctx) => { ctx.arc(r, r, r, 0, Math.PI * 2, false); }}>
            <KonvaImage image={img} x={0} y={0} width={p.width} height={p.height} />
          </KonvaGroup>
        ) : (
          <Text x={0} y={0} width={p.width} height={p.height} text={p.avatarEmoji || '👤'} fontSize={r * 1.8} align="center" verticalAlign="middle" />
        )}
        <Text x={4} y={p.height + 4} width={Math.max(0, p.width - 8)} align="center" text={p.name} fontSize={nameFs} fill={'#2B1F1F'} wrap="none" ellipsis />
        {selected ? (
          <>
            <Rect x={p.width - 14} y={p.height - 14} width={14} height={14} fill={'#6e5548'} cornerRadius={3} stroke={'#00000060'} strokeWidth={1} />
            {(() => {
              const hitW = Math.max(8, Math.round(p.width * 0.15));
              const hitH = Math.max(8, Math.round(p.height * 0.15));
              return (
                <Rect
                  x={p.width - hitW}
                  y={p.height - hitH}
                  width={hitW}
                  height={hitH}
                  opacity={0.001}
                  draggable
                  onDragStart={(e) => { e.cancelBubble = true; }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const hx = e.target.x();
                    const hy = e.target.y();
                    const minS = 80, maxS = 800;
                    const size = Math.max(minS, Math.min(maxS, Math.max(hx + hitW, hy + hitH)));
                    void updateNode(p.id, { width: size, height: size });
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: p.width - hitW, y: p.height - hitH }); }}
                />
              );
            })()}
          </>
        ) : null}
      </KonvaGroup>
    );
  }

  return null;
};
