import { db } from './db';
import { getLogger } from './logger';
import type { AnyNode, LinkThread, User, BookItem, MovieItem } from './types';
import { useAppStore } from './store';

export type BackupData = {
  $schema?: string;
  version: 1;
  exportedAt: string; // ISO
  nodes: AnyNode[];
  links: LinkThread[];
  users: User[];
  books: BookItem[];
  movies: MovieItem[];
};

const log = getLogger('backup');

function makeFilename() {
  const iso = new Date().toISOString().replace(/[:]/g, '-');
  return `detective-board-backup-${iso}.json`;
}

export async function exportBackup(): Promise<void> {
  const [nodes, links, users, books, movies] = await Promise.all([
    db.nodes.toArray(),
    db.links.toArray(),
    db.users.toArray(),
    db.books.toArray(),
    db.movies.toArray(),
  ]);
  const data: BackupData = {
    $schema: 'https://example.local/detective-board/backup.schema.json',
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes,
    links,
    users,
    books,
    movies,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = makeFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    log.info('export:done', { nodes: nodes.length, links: links.length, users: users.length, books: books.length, movies: movies.length });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importBackup(file: File, mode: 'replace' | 'merge' = 'replace'): Promise<void> {
  const text = await file.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new Error('Некорректный JSON'); }
  const data = json as Partial<BackupData>;
  if (!data || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
    throw new Error('Неподдерживаемый формат бэкапа');
  }
  const nodes = data.nodes as AnyNode[];
  const links = data.links as LinkThread[];
  const users = Array.isArray(data.users) ? (data.users as User[]) : [];
  const books = Array.isArray(data.books) ? (data.books as BookItem[]) : [];
  const movies = Array.isArray(data.movies) ? (data.movies as MovieItem[]) : [];

  if (mode === 'replace') {
    await db.transaction('rw', [db.nodes, db.links, db.users, db.books, db.movies], async () => {
      await db.nodes.clear();
      await db.links.clear();
      await db.users.clear();
      await db.books.clear();
      await db.movies.clear();
      if (nodes.length) await db.nodes.bulkAdd(nodes);
      if (links.length) await db.links.bulkAdd(links);
      if (users.length) await db.users.bulkAdd(users);
      if (books.length) await db.books.bulkAdd(books);
      if (movies.length) await db.movies.bulkAdd(movies);
    });
    useAppStore.setState({
      nodes,
      links,
      users,
      selection: [],
      linkSelection: [],
      historyPast: [],
      historyFuture: [],
      currentParentId: null,
    });
    log.info('import:replace:done', { nodes: nodes.length, links: links.length, users: users.length, books: books.length, movies: movies.length });
  } else {
    // merge: просто дозаписываем id-совместимые сущности, конфликты по id заменяются (put)
    await db.transaction('rw', [db.nodes, db.links, db.users, db.books, db.movies], async () => {
      if (nodes.length) await db.nodes.bulkPut(nodes);
      if (links.length) await db.links.bulkPut(links);
      if (users.length) await db.users.bulkPut(users);
      if (books.length) await db.books.bulkPut(books);
      if (movies.length) await db.movies.bulkPut(movies);
    });
    // синхронизируем стор с БД
    const [n2, l2, u2] = await Promise.all([db.nodes.toArray(), db.links.toArray(), db.users.toArray()]);
    useAppStore.setState((s) => ({
      nodes: n2,
      links: l2,
      users: u2,
      selection: [],
      linkSelection: [],
      historyPast: [],
      historyFuture: [],
      currentParentId: s.currentParentId,
    }));
    log.info('import:merge:done', { nodes: nodes.length, links: links.length, users: users.length, books: books.length, movies: movies.length });
  }
}
