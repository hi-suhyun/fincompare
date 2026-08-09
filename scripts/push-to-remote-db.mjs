import { createClient } from '@libsql/client';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * 덤프를 원격 DB(Turso)에 올린다.
 *
 * turso CLI 를 쓰지 않는 이유는 설치가 Homebrew 탭 신뢰 설정을 요구해서다.
 * 어차피 앱이 쓰는 것과 같은 클라이언트라, 이걸로 넣으면 연결 설정까지 함께 검증된다.
 *
 * 사용:
 *   DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *     node scripts/push-to-remote-db.mjs dump.sql
 */

const args = process.argv.slice(2);
// 원격에 넣기 전에 로컬 파일로 리허설할 때 쓴다
const allowLocal = args.includes('--allow-local');
/**
 * 덤프에 들어 있는 테이블을 먼저 지운다.
 *
 * 덤프는 CREATE TABLE 부터 들어 있어서, 이미 테이블이 있는 DB 에 그대로
 * 넣으면 "already exists" 로 멈춘다. 억지로 넘겨도 이번엔 기본키가 부딪힌다.
 * 두 번째 이후 올릴 때는 이 플래그가 필요하다.
 */
const reset = args.includes('--reset');
const dumpPath = args.find((a) => !a.startsWith('--'));
const url = process.env['DATABASE_URL'];
const authToken = process.env['TURSO_AUTH_TOKEN'];

if (dumpPath === undefined || url === undefined) {
  console.error('사용: DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/push-to-remote-db.mjs dump.sql');
  process.exit(1);
}
// 오타로 엉뚱한 로컬 파일을 덮어쓰는 걸 막는다
if (!url.startsWith('libsql://') && !url.startsWith('https://') && !allowLocal) {
  console.error(`원격 URL 이 아닙니다: ${url}`);
  console.error('로컬 파일에 넣어 보려면 --allow-local 을 붙이세요.');
  process.exit(1);
}

const client = createClient({ url, ...(authToken === undefined ? {} : { authToken }) });

/**
 * 덤프를 문장 단위로 자른다.
 *
 * 세미콜론으로 그냥 쪼갤 수 없다 — 기업명에 세미콜론이 들어간 문자열 리터럴이 있으면
 * 문장이 잘못 잘린다. 작은따옴표 안인지 추적하면서 자른다.
 * SQLite 는 리터럴 안의 따옴표를 '' 로 이스케이프하므로, 따옴표를 만날 때마다
 * 상태를 뒤집는 것만으로 정확히 맞는다.
 */
async function* statements(path) {
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let buffer = '';
  let inString = false;

  for await (const line of reader) {
    for (const char of line) {
      if (char === "'") inString = !inString;
      buffer += char;
      if (char === ';' && !inString) {
        const statement = buffer.trim();
        buffer = '';
        if (statement !== '') yield statement;
      }
    }
    buffer += '\n';
  }
  const rest = buffer.trim();
  if (rest !== '') yield rest;
}

/** 트랜잭션 제어와 PRAGMA 는 덤프에 섞여 있지만 원격에서는 클라이언트가 알아서 한다 */
const SKIP = /^(BEGIN|COMMIT|ROLLBACK|PRAGMA)\b/i;

const BATCH_SIZE = 200;
let batch = [];
let done = 0;

async function flush() {
  if (batch.length === 0) return;
  await client.batch(batch, 'write');
  done += batch.length;
  batch = [];
  process.stdout.write(`\r  ${done.toLocaleString()} 문장 적용`);
}

console.log(`원격 DB: ${url}`);
console.log(`덤프: ${dumpPath}`);

if (reset) {
  // 덤프가 어떤 테이블을 만드는지 먼저 읽어서, 그 테이블만 지운다.
  // DB 전체를 비우지 않는 이유는 덤프에 없는 테이블까지 날리지 않기 위해서다.
  const tables = new Set();
  for await (const statement of statements(dumpPath)) {
    const match = /^CREATE TABLE (?:IF NOT EXISTS )?[\`"']?([A-Za-z_][A-Za-z0-9_]*)/i.exec(statement);
    if (match?.[1] !== undefined) tables.add(match[1]);
  }

  console.log(`\n교체할 테이블 ${tables.size}개: ${[...tables].join(', ')}`);
  // 외래키를 켠 채로 지우면 순서에 걸린다. 어차피 전부 다시 만든다.
  await client.execute('PRAGMA foreign_keys = OFF');
  for (const table of tables) await client.execute(`DROP TABLE IF EXISTS ${table}`);
  console.log('기존 테이블 삭제 완료\n');
}

for await (const statement of statements(dumpPath)) {
  if (SKIP.test(statement)) continue;
  batch.push(statement);
  if (batch.length >= BATCH_SIZE) await flush();
}
await flush();

console.log('\n\n=== 확인 ===');
for (const table of ['companies', 'company_aliases', 'financial_facts', 'prices']) {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  console.log(`  ${table.padEnd(16)} ${result.rows[0]?.['n']}`);
}

client.close();
