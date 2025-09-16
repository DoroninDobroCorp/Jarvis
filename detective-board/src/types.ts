// Global types for the Detective Board app

export type NodeType = 'task' | 'group' | 'person';
export type TaskStatus = 'inactive' | 'in_progress' | 'done' | 'active' | 'deferred';

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
  iconEmoji?: string; // optional decorative emoji for the task itself
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
  description?: string;
}

export type PersonRole = 'employee' | 'partner' | 'bot';

export interface PersonNode extends BaseNode {
  type: 'person';
  role: PersonRole;
  name: string;
  avatarEmoji?: string; // avatar rendered as emoji for simplicity
  color?: string; // color of avatar background
  avatarUrl?: string; // optional photo
  contacts?: {
    email?: string;
    phone?: string;
    notes?: string;
  };
}

export type AnyNode = TaskNode | GroupNode | PersonNode;

export interface LinkThread {
  id: string;
  fromId: string;
  toId: string;
  color?: string; // default red thread
  dir?: 'one' | 'both'; // directionality of the arrow
}

export interface User {
  id: string;
  name: string;
  emoji?: string;
}

export interface BookItem {
  id: string;
  title: string;
  comment?: string;
  coverUrl?: string;
  createdAt: number;
}

export interface MovieItem {
  id: string;
  title: string;
  comment?: string;
  coverUrl?: string;
  createdAt: number;
}

export type Tool =
  | 'none'
  | 'link'
  | 'add-task'
  | 'add-group'
  | 'add-person-employee'
  | 'add-person-partner'
  | 'add-person-bot';
