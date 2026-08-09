import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

/**
 * libSQL(SQLite 호환) 클라이언트.
 *
 * 드라이버를 better-sqlite3 대신 libSQL 로 쓰는 이유는 배포 때문이다.
 * Vercel 은 서버리스라 파일시스템이 요청마다 초기화된다 — SQLite 파일을 두면
 * 기업 마스터와 캐시가 통째로 사라진다. libSQL 은 같은 SQL 방언으로
 * 원격 DB(Turso)에 붙을 수 있어서, 로컬은 파일 그대로 두고
 * 배포만 URL 을 바꾸면 된다. Drizzle 을 쓴 덕에 스키마·쿼리는 손대지 않는다.
 *
 * DATABASE_URL 형식:
 *   file:./data/dev.db        로컬 파일
 *   :memory:                  테스트
 *   libsql://xxx.turso.io     원격 (TURSO_AUTH_TOKEN 필요)
 */

export type DbHandle = Awaited<ReturnType<typeof createDb>>;
export type Db = DbHandle['db'];

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

const isRemote = (url: string): boolean =>
  url.startsWith('libsql://') || url.startsWith('https://') || url.startsWith('wss://');

/** 로컬 파일이면 디렉터리를 미리 만들어 둔다. libSQL 은 없는 폴더를 만들지 않는다 */
function prepareLocalFile(url: string): string {
  if (url === ':memory:') return ':memory:';

  const path = url.startsWith('file:') ? url.slice('file:'.length) : url;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  return `file:${absolute}`;
}

export interface CreateDbOptions {
  migrateOnStart?: boolean;
  authToken?: string;
}

export async function createDb(url: string, options: CreateDbOptions = {}) {
  const remote = isRemote(url);

  const client: Client = remote
    ? createClient({
        url,
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      })
    : createClient({ url: prepareLocalFile(url) });

  // 외래키는 기본이 꺼져 있다. 없는 기업의 재무데이터가 들어가면 조용히 고아 행이 된다.
  await client.execute('PRAGMA foreign_keys = ON');

  if (!remote && url !== ':memory:') {
    // 읽기와 쓰기가 서로를 막지 않게 한다. 백필 중에도 조회가 되어야 한다.
    // 원격에서는 서버가 알아서 하므로 보내지 않는다.
    await client.execute('PRAGMA journal_mode = WAL');
  }

  const db = drizzle(client, { schema });

  if (options.migrateOnStart !== false) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  return {
    db,
    client,
    /** 테스트·스크립트에서 raw SQL 이 필요할 때 */
    execute: (sql: string) => client.execute(sql),
    close: () => client.close(),
  };
}
