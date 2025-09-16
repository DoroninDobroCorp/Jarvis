import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const lastDist = useRef<number>(0);

  const [pendingLinkFrom, setPendingLinkFrom] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [linkCtxMenu, setLinkCtxMenu] = useState<{ x: number; y: number; linkId: string } | null>(null);
  const [lasso, setLasso] = useState<null | { x: number; y: number; w: number; h: number; additive: boolean }>(null);
  const [hoveredStub, setHoveredStub] = useState<string | null>(null);
  const didAutoCenter = useRef<boolean>(false);

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

  useEffect(() => {
    if (!levelBBox) return;
    if (!didAutoCenter.current) {
      const s = viewport.scale;
      const nx = width / 2 - levelBBox.cx * s;
      const ny = height / 2 - levelBBox.cy * s;
      setViewport({ x: nx, y: ny, scale: s });
      didAutoCenter.current = true;
      log.info('autocenter', { level: currentParentId, center: { x: levelBBox.cx, y: levelBBox.cy } });
    }
  }, [levelBBox, viewport.scale, width, height, setViewport, currentParentId, log]);

  useEffect(() => {
    // При смене уровня снова разрешаем автоцентр
    didAutoCenter.current = false;
  }, [currentParentId]);

  const ctxNode = useMemo(() => (ctxMenu ? nodes.find((n) => n.id === ctxMenu.nodeId) : null), [ctxMenu, nodes]);

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
    const worldX = (pointer.x - viewport.x) / viewport.scale;
    const worldY = (pointer.y - viewport.y) / viewport.scale;
    // Ctrl/Cmd -> рамочный выбор
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const additive = true; // всегда мультивыделение
      setLasso({ x: worldX, y: worldY, w: 0, h: 0, additive });
      isPanningRef.current = false;
      lastPosRef.current = null;
      log.debug('lasso:start', { x: worldX, y: worldY });
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
      const worldX = (pointer.x - viewport.x) / viewport.scale;
      const worldY = (pointer.y - viewport.y) / viewport.scale;
      setLasso((prev) => (prev ? { ...prev, w: worldX - prev.x, h: worldY - prev.y } : prev));
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

  const handleNodeDragMove = useCallback((id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const x = (node.x());
    const y = (node.y());
    moveNodeLocal(id, x, y);
    log.debug('node:drag', { id, x, y });
  }, [moveNodeLocal, log]);

  const handleNodeDragEnd = useCallback((node: AnyNode, e: KonvaEventObject<DragEvent>) => {
    // Сохраняем позицию и пробуем перепривязать к группе/из группы
    const target = e.target;
    const newX = target.x();
    const newY = target.y();
    void moveNode(node.id, newX, newY).then(async () => {
      // reparent rules (только на текущем уровне)
      const all = useAppStore.getState().nodes;
      const parentId = useAppStore.getState().currentParentId;
      // разрешаем репарент групп, но без циклов
      const isChildOfGroup = node.parentId && all.find((n) => n.id === node.parentId && n.type === 'group');
      const isGroupNode = node.type === 'group';
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
      // Вычисляем абсолютные координаты центра
      const absCenter = (() => {
        let ax = newX + (node.width / 2);
        let ay = newY + (node.height / 2);
        if (isChildOfGroup) {
          const g = all.find((n) => n.id === node.parentId) as GroupNode | undefined;
          if (g) { ax += g.x; ay += g.y; }
        }
        return { ax, ay };
      })();
      // Ищем группу на уровне parentId, в которую попал центр
      const levelGroups = all.filter((n): n is GroupNode => n.type === 'group' && n.parentId === parentId);
      const insideGroup = levelGroups.find((g) => {
        const r = Math.min(g.width, g.height) / 2;
        const gx = g.x + r;
        const gy = g.y + r;
        const d = Math.hypot(absCenter.ax - gx, absCenter.ay - gy);
        return d <= r;
      });
      if (insideGroup && node.parentId !== insideGroup.id) {
        if (isGroupNode && isDescendant(insideGroup.id, node.id)) {
          // нельзя поместить группу внутрь самой себя/потомка
          return;
        }
        // Перемещаем в группу: делаем координаты локальными
        const localX = absCenter.ax - insideGroup.x - node.width / 2;
        const localY = absCenter.ay - insideGroup.y - node.height / 2;
        await useAppStore.getState().updateNode(node.id, { parentId: insideGroup.id, x: localX, y: localY });
        log.info('reparent:into-group', { node: node.id, group: insideGroup.id });
        return;
      }
      // Если узел сейчас внутри группы, но центр вне её — вытащим на уровень
      if (isChildOfGroup) {
        const g = all.find((n) => n.id === node.parentId) as GroupNode | undefined;
        if (g) {
          const r = Math.min(g.width, g.height) / 2;
          const gx = g.x + r;
          const gy = g.y + r;
          const d = Math.hypot(absCenter.ax - gx, absCenter.ay - gy);
          if (d > r) {
            // перенос на уровень parentId группы
            const worldX = absCenter.ax - node.width / 2;
            const worldY = absCenter.ay - node.height / 2;
            await useAppStore.getState().updateNode(node.id, { parentId: g.parentId, x: worldX, y: worldY });
            log.info('reparent:out-of-group', { node: node.id, from: g.id, to: g.parentId });
          }
        }
      }
    });
  }, [moveNode, log]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, setSelection, setLinkSelection, setEditingNodeId, editingNodeId, selection.length, linkSelection.length, undo, redo]);

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
        x={viewport.x}
        y={viewport.y}
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
              // convert to world coords
              const worldX = (pointer.x - viewport.x) / viewport.scale;
              const worldY = (pointer.y - viewport.y) / viewport.scale;
              // convert to local coords if внутри группы
              let lx = worldX; let ly = worldY;
              if (currentParentId) {
                let px = 0; let py = 0;
                let p = nodes.find((n) => n.id === currentParentId) as GroupNode | undefined;
                while (p) { px += p.x; py += p.y; p = p.parentId ? (nodes.find((n) => n.id === p!.parentId) as GroupNode | undefined) : undefined; }
                lx = worldX - px; ly = worldY - py;
              }
              if (tool === 'add-task') {
                const id = await addTask({ x: lx, y: ly });
                setSelection([id]);
                log.info('create:task', { id, x: worldX, y: worldY });
              } else if (tool === 'add-group') {
                const id = await addGroup('Группа', { x: lx, y: ly });
                setSelection([id]);
                log.info('create:group', { id, x: worldX, y: worldY });
              } else if (isAddPerson) {
                const role = tool === 'add-person-partner' ? 'partner' : tool === 'add-person-bot' ? 'bot' : 'employee';
                const name = role === 'partner' ? 'Партнер' : role === 'bot' ? 'Бот' : 'Сотрудник';
                const id = await addPerson(name, role, { x: lx, y: ly });
                setSelection([id]);
                log.info('create:person', { id, x: worldX, y: worldY, role });
              }
              // one-shot tool: выключаем после создания
              setTool('none');
            })();
          }
        }}
      >
        <Layer>
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
            const { cx: x1, cy: y1 } = computeNodeCenter(from);
            const { cx: x2, cy: y2 } = computeNodeCenter(to);
            const useBezier = !perfMode;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 - 30; // slight arc
            return (
              <Arrow
                key={`rl-${l.id}`}
                points={useBezier ? [x1, y1, mx, my, x2, y2] : [x1, y1, x2, y2]}
                stroke={l.color || '#C94545'}
                strokeWidth={linkSelection.includes(l.id) ? 4 : 2}
                tension={useBezier ? 0.5 : 0}
                bezier={useBezier}
                pointerLength={12}
                pointerWidth={12}
                fill={l.color || '#C94545'}
                pointerAtBeginning={(l.dir || 'one') === 'both'}
                hitStrokeWidth={40}
                perfectDrawEnabled={false}
                shadowColor={perfMode ? undefined : '#00000080'}
                shadowBlur={perfMode ? 0 : (linkSelection.includes(l.id) ? 10 : 6)}
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
              const vC = computeNodeCenter(visibleNode);
              const vLocal = { x: vC.cx, y: vC.cy };
              const hWorld = getWorldCenter(hiddenNode);
              const hLocal = toLocal(hWorld);
              // направляющий вектор
              const dx = hLocal.x - vLocal.x; const dy = hLocal.y - vLocal.y; const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              const ex = vLocal.x + ux * 60; const ey = vLocal.y + uy * 60; // 60px штрих
              const label = hiddenNode.type === 'task' ? (hiddenNode as TaskNode).title : hiddenNode.type === 'person' ? (hiddenNode as PersonNode).name : (hiddenNode as GroupNode).name;
              list.push(
                <React.Fragment key={`stub-${l.id}`}>
                  {/* стрелочка усеченная: направление с учетом ориентации */}
                  {(() => {
                    const dir = l.dir || 'one';
                    const points = (() => {
                      if (dir === 'both') return [vLocal.x, vLocal.y, ex, ey];
                      // если from виден, рисуем от видимого наружу; иначе — к видимому внутрь
                      return aVisible ? [vLocal.x, vLocal.y, ex, ey] : [ex, ey, vLocal.x, vLocal.y];
                    })();
                    return (
                      <Arrow points={points} stroke={l.color || '#C94545'} fill={l.color || '#C94545'} strokeWidth={2} dash={[8, 6]} pointerLength={10} pointerWidth={10}
                        perfectDrawEnabled={false}
                        shadowColor={perfMode ? undefined : '#00000080'} shadowBlur={perfMode ? 0 : 6}
                        onMouseEnter={() => setHoveredStub(l.id)} onMouseLeave={() => setHoveredStub((p) => (p === l.id ? null : p))} />
                    );
                  })()}
                  {hoveredStub === l.id ? (
                    <Text x={ex + 6} y={ey + 6} text={`→ ${label}`} fontSize={14} fill={'#333'} />
                  ) : null}
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
        </Layer>
      </Stage>
      {ctxMenu && ctxNode ? (
        <div
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, background: '#222', color: '#fff', padding: 8, borderRadius: 6, zIndex: 1001, minWidth: 220, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}
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
              <button onClick={() => { if (window.confirm('Удалить выбранное?')) { void deleteSelection(); setCtxMenu(null); } }} style={{ display: 'block', width: '100%', marginTop: 8 }}>Удалить</button>
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
            </div>
          ) : null}
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => setCtxMenu(null)}>Закрыть</button>
          </div>
        </div>
      ) : null}
      {linkCtxMenu ? (
        <div
          style={{ position: 'fixed', left: linkCtxMenu.x, top: linkCtxMenu.y, background: '#222', color: '#fff', padding: 8, borderRadius: 6, zIndex: 1001, minWidth: 220, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Связь</div>
          <label style={{ display: 'block', marginBottom: 6 }}>Цвет
            <input type="color" style={{ width: '100%' }} value={(useAppStore.getState().links.find((l) => l.id === linkCtxMenu.linkId)?.color) || '#C94545'} onChange={(e) => { void useAppStore.getState().updateLink(linkCtxMenu.linkId, { color: e.target.value }); }} />
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
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onDblClick: () => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void;
}> = ({ node, selected, onDragMove, onDragEnd, onClick, onDblClick, onContextMenu }) => {
  const isTask = node.type === 'task';
  const isGroup = node.type === 'group';
  const isPerson = node.type === 'person';
  const updateNode = useAppStore((s) => s.updateNode);
  const groupHasActive = useAppStore((s) => s.groupHasActive);
  const personAvatarUrl = node.type === 'person' ? (node as PersonNode).avatarUrl : undefined;
  const img = useHtmlImage(personAvatarUrl);

  if (isTask) {
    const t = node as TaskNode;
    const fs = clamp(Math.min(t.width / 5, t.height / 2.4), 16, 40);
    return (
      <KonvaGroup
        x={t.x}
        y={t.y}
        draggable
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
        {/* text fills the rect */}
        <Text
          x={12}
          y={10}
          width={t.width - 24}
          height={t.height - 20}
          text={`${t.iconEmoji ? t.iconEmoji + ' ' : ''}${t.assigneeEmoji ?? ''} ${t.assigneeName ? t.assigneeName + ': ' : ''}${t.title}${t.description ? '\n\n' + t.description : ''}`}
          fontSize={fs}
          fill={'#3B2F2F'}
          align="left"
          verticalAlign="top"
          wrap="word"
          lineHeight={1.15}
        />
        {/* status dot when in_progress */}
        {t.status === 'in_progress' ? (
          <Circle x={t.width - 12} y={12} radius={6} fill={'#FF6B6B'} shadowBlur={8} />
        ) : null}

        {/* resize handle (bottom-right) */}
        {selected ? (
          <Rect
            x={t.width - 14}
            y={t.height - 14}
            width={14}
            height={14}
            fill={'#6e5548'}
            cornerRadius={3}
            stroke={'#00000060'}
            strokeWidth={1}
            draggable
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const hx = e.target.x();
              const hy = e.target.y();
              const minW = 120, minH = 80, maxW = 900, maxH = 700;
              const newW = Math.max(minW, Math.min(maxW, hx + 14));
              const newH = Math.max(minH, Math.min(maxH, hy + 14));
              void updateNode(t.id, { width: newW, height: newH });
            }}
            onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: t.width - 14, y: t.height - 14 }); }}
          />
        ) : null}
      </KonvaGroup>
    );
  }

  if (isGroup) {
    const g = node as GroupNode;
    const r = Math.min(g.width, g.height) / 2;
    const groupFs = clamp(r / 1.6, 16, 48);
    const hasActive = groupHasActive(g.id);
    return (
      <KonvaGroup
        x={g.x}
        y={g.y}
        draggable
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
        <Text x={0} y={r - groupFs / 2} width={g.width} align="center" text={g.name} fontSize={groupFs} fill={'#2B1F1F'} fontStyle="bold" />
        {/* active indicator */}
        {hasActive ? (
          <Circle x={g.width - 12} y={12} radius={6} fill={'#FF6B6B'} shadowBlur={8} />
        ) : null}

        {/* resize handle for group (keeps square) */}
        {selected ? (
          <Circle
            x={g.width - 10}
            y={g.height - 10}
            radius={8}
            fill={'#6e5548'}
            stroke={'#00000060'}
            strokeWidth={1}
            draggable
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const hx = e.target.x();
              const hy = e.target.y();
              const pad = 10;
              const size = Math.max(100, Math.min(900, Math.max(hx + pad, hy + pad)));
              void updateNode(g.id, { width: size, height: size });
            }}
            onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: g.width - 10, y: g.height - 10 }); }}
          />
        ) : null}
      </KonvaGroup>
    );
  }

  if (isPerson) {
    const p = node as PersonNode;
    const r = Math.min(p.width, p.height) / 2;
    const nameFs = clamp(p.width / 4, 16, 36);
    return (
      <KonvaGroup
        x={p.x}
        y={p.y}
        draggable
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
        <Text x={0} y={p.height + 4} width={p.width} align="center" text={p.name} fontSize={nameFs} fill={'#2B1F1F'} />
        {selected ? (
          <Rect
            x={p.width - 14}
            y={p.height - 14}
            width={14}
            height={14}
            fill={'#6e5548'}
            cornerRadius={3}
            stroke={'#00000060'}
            strokeWidth={1}
            draggable
            onDragStart={(e) => { e.cancelBubble = true; }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const hx = e.target.x();
              const hy = e.target.y();
              const minS = 80, maxS = 400;
              const size = Math.max(minS, Math.min(maxS, Math.max(hx + 14, hy + 14)));
              void updateNode(p.id, { width: size, height: size });
            }}
            onDragEnd={(e) => { e.cancelBubble = true; e.target.position({ x: p.width - 14, y: p.height - 14 }); }}
          />
        ) : null}
      </KonvaGroup>
    );
  }

  return null;
};
