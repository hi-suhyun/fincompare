import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * Vercel Build Output API 산출물을 직접 만든다.
 *
 * Vercel 이 api/*.ts 를 알아서 처리하게 두면 배포가 런타임에 죽는다.
 * 트랜스파일만 하고 번들하지 않아서, @fincompare/shared 가 남긴
 * import 가 그 패키지의 src/index.ts 로 향한다 — Node 는 .ts 를 못 읽는다.
 * (packages/shared 는 빌드 산출물 없이 raw .ts 를 그대로 내보낸다.)
 *
 * 그래서 esbuild 로 전부 인라인한 뒤, 완성된 결과를 .vercel/output 에
 * 그대로 놓는다. Vercel 은 이 폴더가 있으면 추론 없이 그대로 배포한다.
 *
 * DB 클라이언트는 아래 alias 로 @libsql/client/web 으로 바꾼다.
 * 네이티브 모듈이 없어 번들이 자기완결적이 된다 — 람다에 node_modules 가
 * 필요 없다.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.vercel/output');
const funcDir = resolve(outDir, 'functions/api/index.func');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });

// ─── 프론트 ────────────────────────────────────────────────
console.log('프론트 빌드…');
execFileSync('pnpm', ['--filter', '@fincompare/web', 'build'], {
  cwd: root,
  stdio: 'inherit',
});
cpSync(resolve(root, 'apps/web/dist'), resolve(outDir, 'static'), { recursive: true });

// ─── 서버리스 함수 ─────────────────────────────────────────
console.log('\n함수 번들…');
await build({
  entryPoints: [resolve(root, 'apps/api/src/serverless.ts')],
  outfile: resolve(funcDir, 'index.js'),
  bundle: true,
  /**
   * 로컬 파일용 분기가 네이티브 모듈(libsql)을 끌고 들어온다. 번들에 넣을 수 없고,
   * 배포는 원격 DB 만 보므로 그 분기를 탈 일도 없다.
   * HTTP 로만 말하는 web 진입점으로 바꿔 번들을 자기완결적으로 만든다.
   */
  alias: { '@libsql/client': '@libsql/client/web' },
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // 스택 추적이 원본 줄 번호를 가리켜야 배포 로그를 읽을 수 있다
  sourcemap: 'inline',
  // express 등 의존성이 CJS 라 ESM 번들 안에서 require 가 돌게 해 준다
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_ } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});

writeFileSync(
  resolve(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      supportsResponseStreaming: true,
      memory: 1024,
      maxDuration: 60,
      // 사용자도 DB(Turso 도쿄)도 아시아에 있다. 함수가 미국에서 돌면
      // 요청 한 번에 태평양을 두 번 건넌다.
      regions: ['icn1'],
    },
    null,
    2,
  ) + '\n',
);

// 번들이 자기완결적이라 의존성이 없다. ESM 으로 읽히게 type 만 알려 준다.
writeFileSync(
  resolve(funcDir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
);

// ─── 라우팅 ────────────────────────────────────────────────
writeFileSync(
  resolve(outDir, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // 검색엔진에 뜰 이유가 없다. URL 이 알려지면 DART 일일 한도를 남이 태운다.
        {
          src: '/(.*)',
          headers: { 'X-Robots-Tag': 'noindex, nofollow' },
          continue: true,
        },
        // /api/* 는 전부 함수 하나로 보낸다. 경로는 Express 가 가른다.
        { src: '/api/(.*)', dest: '/api' },
        // 정적 파일이 있으면 그걸 준다
        { handle: 'filesystem' },
        // 나머지는 SPA 진입점으로. 새로고침해도 화면이 유지된다.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ) + '\n',
);

console.log(`\n산출물: ${outDir}`);
