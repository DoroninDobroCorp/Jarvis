import { create } from 'zustand';
import { db } from './db';
import type { AnyNode, GroupNode, LinkThread, TaskNode, Tool, TaskStatus } from './types';
import { v4 as uuidv4 } from 'uuid';

export interface AppState {
  nodes: AnyNode[];
  links: LinkThread[];
  users: { id: string; name: string; emoji?: string }[];

  viewport: { x: number; y: number; scale: number };
  currentParentId: string | null; // null = root

  tool: Tool;
  selection: string[]; // selected node ids

  // init/load
  initialized: boolean;
  init: () => Promise<void>;

  // CRUD nodes
  addTask: (partial: Partial<Omit<TaskNode, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'width' | 'height'>>) => Promise<string>;
  addGroup: (name: string, position?: { x: number; y: number }) => Promise<string>;
  updateNode: (id: string, patch: Partial<AnyNode>) => Promise<void>;
  moveNode: (id: string, x: number, y: number) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
  deleteSelection: () => Promise<void>;
  groupSelection: (name?: string) => Promise<string | null>;

  // links
  addLink: (fromId: string, toId: string, color?: string) => Promise<string>;
  removeLink: (id: string) => Promise<void>;

  // navigation
  enterGroup: (id: string) => void;
  goUp: () => void;

  // ui
  setTool: (t: Tool) => void;
  setSelection: (ids: string[]) => void;
  setViewport: (vp: { x: number; y: number; scale: number }) => void;

  // helpers
  visibleNodes: () => AnyNode[];
  getNode: (id: string) => AnyNode | undefined;
  groupHasActive: (groupId: string) => boolean;
}

function now() {
  return Date.now();
}

export const useAppStore = create<AppState>((set, get) => ({
  nodes: [],
  links: [],
  users: [],

  viewport: { x: 0, y: 0, scale: 1 },
  currentParentId: null,

  tool: 'select',
  selection: [],

  initialized: false,
  init: async () => {
    try {
      const [nodes, links, users] = await Promise.all([
        db.nodes.toArray(),
        db.links.toArray(),
        db.users.toArray(),
      ]);

      if (nodes.length === 0) {
        // seed demo data
        const rootTask1: TaskNode = {
          id: uuidv4(),
          type: 'task',
          parentId: null,
          x: 200,
          y: 200,
          width: 200,
          height: 140,
          title: 'Начать доску',
          description: 'Добавить задачи и объединить в группы',
          status: 'in_progress',
          color: '#E8D8A6',
          assigneeEmoji: '🧠',
          createdAt: now(),
          updatedAt: now(),
        };
        const rootGroup: GroupNode = {
          id: uuidv4(),
          type: 'group',
          parentId: null,
          x: 520,
          y: 260,
          width: 220,
          height: 220,
          name: 'Закупки',
          color: '#9CC5B0',
          createdAt: now(),
          updatedAt: now(),
        };
        const innerTask: TaskNode = {
          id: uuidv4(),
          type: 'task',
          parentId: rootGroup.id,
          x: 40,
          y: 30,
          width: 200,
          height: 140,
          title: 'Поставщик X',
          description: 'Согласовать партию Y',
          status: 'inactive',
          color: '#F1C0B9',
          assigneeEmoji: '🧑‍💼',
          createdAt: now(),
          updatedAt: now(),
        };
        await db.nodes.bulkAdd([rootTask1, rootGroup, innerTask]);
        set({ nodes: [rootTask1, rootGroup, innerTask], links, users, initialized: true });
      } else {
        set({ nodes, links, users, initialized: true });
      }
    } catch (err) {
      // Fallback to in-memory state (no persistence)
      console.error('IndexedDB init failed, using in-memory state', err);
      const rootTask1: TaskNode = {
        id: uuidv4(),
        type: 'task',
        parentId: null,
        x: 200,
        y: 200,
        width: 200,
        height: 140,
        title: 'Начать доску',
        description: 'Добавить задачи и объединить в группы',
        status: 'in_progress',
        color: '#E8D8A6',
        assigneeEmoji: '🧠',
        createdAt: now(),
        updatedAt: now(),
      };
      const rootGroup: GroupNode = {
        id: uuidv4(),
        type: 'group',
        parentId: null,
        x: 520,
        y: 260,
        width: 220,
        height: 220,
        name: 'Закупки',
        color: '#9CC5B0',
        createdAt: now(),
        updatedAt: now(),
      };
      const innerTask: TaskNode = {
        id: uuidv4(),
        type: 'task',
        parentId: rootGroup.id,
        x: 40,
        y: 30,
        width: 200,
        height: 140,
        title: 'Поставщик X',
        description: 'Согласовать партию Y',
        status: 'inactive',
        color: '#F1C0B9',
        assigneeEmoji: '🧑‍💼',
        createdAt: now(),
        updatedAt: now(),
      };
      set({ nodes: [rootTask1, rootGroup, innerTask], links: [], users: [], initialized: true });
    }
  },

  deleteSelection: async () => {
    const ids = new Set(get().selection);
    if (ids.size === 0) return;
    const all = get().nodes;
    const toRemove = new Set<string>();
    const collect = (nid: string) => {
      toRemove.add(nid);
      all.filter((n) => n.parentId === nid).forEach((child) => collect(child.id));
    };
    Array.from(ids).forEach((id) => collect(id));
    await db.nodes.bulkDelete(Array.from(toRemove));
    set((s) => ({
      nodes: s.nodes.filter((n) => !toRemove.has(n.id)),
      selection: [],
    }));

    const linksToRemove = get().links.filter((l) => toRemove.has(l.fromId) || toRemove.has(l.toId)).map((l) => l.id);
    if (linksToRemove.length) {
      await db.links.bulkDelete(linksToRemove);
      set((s) => ({ links: s.links.filter((l) => !linksToRemove.includes(l.id)) }));
    }
  },

  groupSelection: async (name) => {
    const parentId = get().currentParentId;
    const selectedIds = new Set(get().selection);
    const levelNodes = get().nodes.filter((n) => n.parentId === parentId && selectedIds.has(n.id));
    if (levelNodes.length === 0) return null;

    // compute bounding box
    const minX = Math.min(...levelNodes.map((n) => n.x));
    const minY = Math.min(...levelNodes.map((n) => n.y));
    const maxX = Math.max(...levelNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...levelNodes.map((n) => n.y + n.height));
    const pad = 30;
    const w = maxX - minX;
    const h = maxY - minY;
    const size = Math.max(w, h) + pad * 2;
    const gx = minX - pad;
    const gy = minY - pad;

    const id = uuidv4();
    const group: GroupNode = {
      id,
      type: 'group',
      parentId,
      x: gx,
      y: gy,
      width: size,
      height: size,
      name: name || 'Группа',
      color: '#9CC5B0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // persist group
    await db.nodes.add(group);

    // reparent children into group with local coordinates
    const updatedChildren: AnyNode[] = levelNodes.map((n) => ({
      ...n,
      parentId: id,
      x: n.x - gx,
      y: n.y - gy,
      updatedAt: Date.now(),
    }));
    await db.nodes.bulkPut(updatedChildren);

    set((s) => ({
      nodes: [
        ...s.nodes
          .filter((n) => !levelNodes.some((ln) => ln.id === n.id)),
        group,
        ...updatedChildren,
      ],
      selection: [id],
    }));

    return id;
  },

  addTask: async (partial) => {
    const id = uuidv4();
    const node: TaskNode = {
      id,
      type: 'task',
      parentId: partial.parentId ?? get().currentParentId ?? null,
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      width: 200,
      height: 140,
      title: partial.title ?? 'Новая задача',
      description: partial.description,
      assigneeId: partial.assigneeId,
      assigneeEmoji: partial.assigneeEmoji ?? '🙂',
      dueDate: partial.dueDate,
      priority: partial.priority ?? 'med',
      durationMinutes: partial.durationMinutes,
      status: (partial.status as TaskStatus) ?? 'inactive',
      color: partial.color ?? '#E8D8A6',
      createdAt: now(),
      updatedAt: now(),
    };
    await db.nodes.add(node);
    set((s) => ({ nodes: [...s.nodes, node] }));
    return id;
  },

  addGroup: async (name, position) => {
    const id = uuidv4();
    const node: GroupNode = {
      id,
      type: 'group',
      parentId: get().currentParentId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      width: 200,
      height: 200,
      name: name || 'Группа',
      color: '#AEC6CF',
      createdAt: now(),
      updatedAt: now(),
    };
    await db.nodes.add(node);
    set((s) => ({ nodes: [...s.nodes, node] }));
    return id;
  },

  updateNode: async (id, patch) => {
    const prev = get().nodes.find((n) => n.id === id);
    if (!prev) return;
    const next = { ...prev, ...patch, updatedAt: now() } as AnyNode;
    await db.nodes.put(next);
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? next : n)) }));
  },

  moveNode: async (id, x, y) => {
    const prev = get().nodes.find((n) => n.id === id);
    if (!prev) return;
    const next = { ...prev, x, y, updatedAt: now() } as AnyNode;
    await db.nodes.put(next);
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? next : n)) }));
  },

  removeNode: async (id) => {
    // Remove node and its descendants
    const all = get().nodes;
    const toRemove = new Set<string>();
    const collect = (nid: string) => {
      toRemove.add(nid);
      all.filter((n) => n.parentId === nid).forEach((child) => collect(child.id));
    };
    collect(id);
    await db.nodes.bulkDelete(Array.from(toRemove));
    set((s) => ({ nodes: s.nodes.filter((n) => !toRemove.has(n.id)) }));

    // Remove links connected to any removed node
    const linksToRemove = get().links.filter((l) => toRemove.has(l.fromId) || toRemove.has(l.toId)).map((l) => l.id);
    if (linksToRemove.length) {
      await db.links.bulkDelete(linksToRemove);
      set((s) => ({ links: s.links.filter((l) => !linksToRemove.includes(l.id)) }));
    }
  },

  addLink: async (fromId, toId, color = '#C94545') => {
    if (fromId === toId) return '';
    const id = uuidv4();
    const link: LinkThread = { id, fromId, toId, color };
    await db.links.add(link);
    set((s) => ({ links: [...s.links, link] }));
    return id;
  },

  removeLink: async (id) => {
    await db.links.delete(id);
    set((s) => ({ links: s.links.filter((l) => l.id !== id) }));
  },

  enterGroup: (id) => {
    const node = get().nodes.find((n) => n.id === id && n.type === 'group');
    if (!node) return;
    set({ currentParentId: id });
  },
  goUp: () => {
    const curr = get().currentParentId;
    if (!curr) return;
    const group = get().nodes.find((n) => n.id === curr && n.type === 'group') as GroupNode | undefined;
    const parentId = group?.parentId ?? null;
    set({ currentParentId: parentId });
  },

  setTool: (t) => set({ tool: t }),
  setSelection: (ids) => set({ selection: ids }),
  setViewport: (vp) => set({ viewport: vp }),

  visibleNodes: () => {
    const parentId = get().currentParentId;
    return get().nodes.filter((n) => n.parentId === parentId);
  },
  getNode: (id) => get().nodes.find((n) => n.id === id),

  groupHasActive: (groupId: string): boolean => {
    const all = get().nodes;
    const children = all.filter((n) => n.parentId === groupId);
    for (const ch of children) {
      if (ch.type === 'task' && ch.status === 'in_progress') return true;
      if (ch.type === 'group' && get().groupHasActive(ch.id)) return true;
    }
    return false;
  },
}));
