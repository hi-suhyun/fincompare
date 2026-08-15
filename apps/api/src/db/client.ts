import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

/**
 * @libsql/client 의 Client 를 직접 import 하지 않는다.
 * 진입점에 따라 그 이름이 안 보여서, 빌드 환경마다 타입 에러가 갈린다.
 * 반환형에서 끌어오면 어디서 검사하든 같은 타입이 나온다.
 */
type LibsqlClient = ReturnType<typeof createClient>;

/**
 * libSQL(SQLite 호환) 클라이언트.
 *
 * 이 도구는 각자 자기 컴퓨터에서 돌린다. DB 는 로컬 SQLite 파일 하나다 —
 * 받은 공시·주가가 그 파일에 쌓이고, 두 번째 조회부터는 네트워크를 타지 않는다.
 *
 * DATABASE_URL 형식:
 *   file:./data/dev.db        로컬 파일 (기본)
 *   :memory:                  테스트
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

  const client: LibsqlClient = remote
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
