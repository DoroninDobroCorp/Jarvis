// Global types for the Detective Board app

export type NodeType = 'task' | 'group';
export type TaskStatus = 'inactive' | 'in_progress' | 'done';

export interface Viewport {
  x: number;
  y: number;
  scale: number; // 1 = 100%
}

export interface BaseNode {
  id: string;
  type: NodeType;
  parentId: string | null; // null = root level
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskNode extends BaseNode {
  type: 'task';
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeEmoji?: string; // simple emoji avatar
  assigneeName?: string; // display name of assignee
  dueDate?: string; // ISO string
  priority?: 'low' | 'med' | 'high';
  durationMinutes?: number; // optional planned duration
  status: TaskStatus;
  color?: string; // sticky note color
}

export interface GroupNode extends BaseNode {
  type: 'group';
  name: string;
  color?: string; // pastel fill color for bubble
}

export type AnyNode = TaskNode | GroupNode;

export interface LinkThread {
  id: string;
  fromId: string;
  toId: string;
  color?: string; // default red thread
}

export interface User {
  id: string;
  name: string;
  emoji?: string;
}

export type Tool = 'select' | 'pan' | 'link' | 'add-task' | 'add-group';
