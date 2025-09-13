import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AnyNode, LinkThread, User } from './types';

export class DetectiveDB extends Dexie {
  nodes!: Table<AnyNode, string>;
  links!: Table<LinkThread, string>;
  users!: Table<User, string>;

  constructor() {
    super('detective_board_db');
    this.version(1).stores({
      nodes: 'id, parentId, type, updatedAt',
      links: 'id, fromId, toId',
      users: 'id, name',
    });
  }
}

export const db = new DetectiveDB();
