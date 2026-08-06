import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * `DATABASE_URL` 은 `file:./data/dev.db` 형식을 받는다.
 * `:memory:` 를 넘기면 인메모리 DB — 테스트용.
 */
function resolveDbPath(url: string): string {
  if (url === ':memory:') return ':memory:';
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

export function createDb(url: string, options: { migrateOnStart?: boolean } = {}) {
  const path = resolveDbPath(url);

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  // WAL 은 읽기와 쓰기가 서로를 막지 않게 한다. 백필 중에도 조회가 되어야 한다.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  if (options.migrateOnStart !== false) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  return { db, sqlite, close: () => sqlite.close() };
}
