import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Group as KonvaGroup, Circle, Rect, Text } from 'react-konva';
import { useAppStore } from '../store';
import type { AnyNode, GroupNode, TaskNode } from '../types';

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function computeNodeCenter(n: AnyNode) {
  return { cx: n.x + n.width / 2, cy: n.y + n.height / 2 };
}

export const BoardCanvas: React.FC = () => {
  const nodes = useAppStore((s) => s.nodes);
  const currentParentId = useAppStore((s) => s.currentParentId);
  const visibleNodes = useMemo(() => nodes.filter((n) => n.parentId === currentParentId), [nodes, currentParentId]);
  const links = useAppStore((s) => s.links);
  const viewport = useAppStore((s) => s.viewport);
  const setViewport = useAppStore((s) => s.setViewport);
  const moveNode = useAppStore((s) => s.moveNode);
  const setSelection = useAppStore((s) => s.setSelection);
  const selection = useAppStore((s) => s.selection);
  const tool = useAppStore((s) => s.tool);
  const addLink = useAppStore((s) => s.addLink);
  const enterGroup = useAppStore((s) => s.enterGroup);
  const addTask = useAppStore((s) => s.addTask);
  const addGroup = useAppStore((s) => s.addGroup);

  const { width, height } = useWindowSize();

  const stageRef = useRef<any>(null);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const lastDist = useRef<number>(0);

  const [pendingLinkFrom, setPendingLinkFrom] = useState<string | null>(null);

  // wheel zoom
  const onWheel = useCallback((e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.05;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();

    const pointer = stage.getPointerPosition();
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
  }, [viewport.x, viewport.y, setViewport]);

  // drag to pan when tool=pan or when space pressed
  const isPanningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback((e: any) => {
    const isSpace = (e.evt as MouseEvent).buttons === 1 && (e.evt as any).shiftKey === false && (e.evt as any).ctrlKey === false && (e.evt as any).metaKey === false && (e.evt as any).altKey === false && (e.target === e.target.getStage());
    if (tool === 'pan' || isSpace) {
      isPanningRef.current = true;
      lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    }
  }, [tool]);

  const onMouseMove = useCallback((e: any) => {
    if (!isPanningRef.current) return;
    const last = lastPosRef.current;
    if (!last) return;
    const dx = e.evt.clientX - last.x;
    const dy = e.evt.clientY - last.y;
    lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    setViewport({ x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale });
  }, [viewport, setViewport]);

  const onMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // touch for pan/pinch
  const onTouchMove = useCallback((e: any) => {
    const stage = e.target.getStage();
    const positions = stage.getPointerPositions?.() as { x: number; y: number }[] | undefined;
    if (positions && positions.length >= 2) {
      // pinch-zoom
      const p1 = positions[0];
      const p2 = positions[1];
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
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
    } else {
      const touch1 = stage.getPointerPosition();
      if (touch1) {
        // pan
        if (!lastPosRef.current) {
          lastPosRef.current = { x: touch1.x, y: touch1.y };
          return;
        }
        const dx = touch1.x - lastPosRef.current.x;
        const dy = touch1.y - lastPosRef.current.y;
        lastPosRef.current = { x: touch1.x, y: touch1.y };
        setViewport({ x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale });
      }
    }
  }, [viewport, setViewport]);

  const onTouchEnd = useCallback(() => {
    lastCenter.current = null;
    lastDist.current = 0;
    lastPosRef.current = null;
  }, []);

  const handleNodeDragMove = useCallback((id: string, e: any) => {
    const node = e.target;
    const x = (node.x());
    const y = (node.y());
    moveNode(id, x, y);
  }, [moveNode]);

  const handleNodeClick = useCallback((id: string, ev?: any) => {
    if (tool === 'select') {
      const shift = ev?.evt?.shiftKey || ev?.evt?.metaKey || ev?.evt?.ctrlKey;
      if (shift) {
        const next = new Set<string>(selection);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelection(Array.from(next));
      } else {
        setSelection([id]);
      }
    } else if (tool === 'link') {
      if (!pendingLinkFrom) {
        setPendingLinkFrom(id);
        setSelection([id]);
      } else if (pendingLinkFrom && pendingLinkFrom !== id) {
        void addLink(pendingLinkFrom, id);
        setPendingLinkFrom(null);
        setSelection([]);
      }
    } else if (tool === 'add-task' || tool === 'add-group') {
      // ignore clicks in create modes
    }
  }, [tool, pendingLinkFrom, addLink, setSelection, selection]);

  const handleNodeDblClick = useCallback((node: AnyNode) => {
    if (node.type === 'group') {
      enterGroup(node.id);
    }
    // for task: editor is opened externally by selecting and using inspector
  }, [enterGroup]);

  const visibleLinks = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  }, [links, visibleNodes]);

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
          if (tool === 'select') {
            setSelection([]);
            return;
          }
          if (tool === 'add-task' || tool === 'add-group') {
            (async () => {
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              // convert to world coords
              const worldX = (pointer.x - viewport.x) / viewport.scale;
              const worldY = (pointer.y - viewport.y) / viewport.scale;
              if (tool === 'add-task') {
                const id = await addTask({ x: worldX, y: worldY });
                setSelection([id]);
              } else if (tool === 'add-group') {
                const id = await addGroup('Группа', { x: worldX, y: worldY });
                setSelection([id]);
              }
            })();
          }
        }}
      >
        <Layer>
          {visibleLinks.map((l) => {
            const from = visibleNodes.find((n) => n.id === l.fromId)!;
            const to = visibleNodes.find((n) => n.id === l.toId)!;
            const { cx: x1, cy: y1 } = computeNodeCenter(from);
            const { cx: x2, cy: y2 } = computeNodeCenter(to);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 - 30; // slight arc
            return (
              <Line
                key={l.id}
                points={[x1, y1, mx, my, x2, y2]}
                stroke={l.color || '#C94545'}
                strokeWidth={2}
                tension={0.5}
                bezier
                shadowColor={'#00000080'}
                shadowBlur={6}
              />
            );
          })}

          {visibleNodes.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              selected={selection.includes(n.id)}
              onDragMove={(e) => handleNodeDragMove(n.id, e)}
              onClick={(evt: any) => { handleNodeClick(n.id, evt); }}
              onDblClick={() => handleNodeDblClick(n)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

const NodeShape: React.FC<{
  node: AnyNode;
  selected: boolean;
  onDragMove: (e: any) => void;
  onClick: (e?: any) => void;
  onDblClick: (e?: any) => void;
}> = ({ node, selected, onDragMove, onClick, onDblClick }) => {
  const isTask = node.type === 'task';
  const isGroup = node.type === 'group';
  const updateNode = useAppStore((s) => s.updateNode);
  const groupHasActive = useAppStore((s) => s.groupHasActive);

  if (isTask) {
    const t = node as TaskNode;
    return (
      <KonvaGroup
        x={t.x}
        y={t.y}
        draggable
        onDragMove={onDragMove}
        onClick={onClick}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
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
        {/* pin */}
        <Circle x={12} y={12} radius={4} fill={'#B33A3A'} shadowBlur={4} />
        {/* title with assignee */}
        <Text x={12} y={10} text={`${t.assigneeEmoji ?? ''} ${t.assigneeName ? t.assigneeName + ': ' : ''}${t.title}`} fontSize={16} fill={'#3B2F2F'} fontStyle="bold" />
        {/* description */}
        {t.description ? (
          <Text x={12} y={34} width={t.width - 24} text={t.description} fontSize={13} fill={'#3B2F2F'} />
        ) : null}
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
            onDragMove={(e) => {
              const hx = e.target.x();
              const hy = e.target.y();
              const minW = 120, minH = 80, maxW = 900, maxH = 700;
              const newW = Math.max(minW, Math.min(maxW, hx + 14));
              const newH = Math.max(minH, Math.min(maxH, hy + 14));
              void updateNode(t.id, { width: newW, height: newH });
            }}
          />
        ) : null}
      </KonvaGroup>
    );
  }

  if (isGroup) {
    const g = node as GroupNode;
    const r = Math.min(g.width, g.height) / 2;
    const hasActive = groupHasActive(g.id);
    return (
      <KonvaGroup
        x={g.x}
        y={g.y}
        draggable
        onDragMove={onDragMove}
        onClick={onClick}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
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
        <Text x={0} y={r - 8} width={g.width} align="center" text={g.name} fontSize={16} fill={'#2B1F1F'} fontStyle="bold" />
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
            onDragMove={(e) => {
              const hx = e.target.x();
              const hy = e.target.y();
              const pad = 10;
              const size = Math.max(100, Math.min(900, Math.max(hx + pad, hy + pad)));
              void updateNode(g.id, { width: size, height: size });
            }}
          />
        ) : null}
      </KonvaGroup>
    );
  }

  return null;
};
