import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 서버리스 함수 번들.
 *
 * Vercel 이 알아서 TypeScript 를 처리하게 두지 않는 이유가 두 가지 있다.
 *
 * 1. @fincompare/shared 는 빌드 산출물 없이 raw .ts 를 그대로 내보낸다.
 *    번들러가 워크스페이스 심링크를 타고 .ts 를 읽어야 한다.
 * 2. 이 저장소는 NodeNext 방식으로 상대 import 에 .js 확장자를 쓴다.
 *    실제 파일은 .ts 라서, .js → .ts 로 되짚어 주는 리졸버가 필요하다.
 *    esbuild 는 이 규칙을 구현하고 있다.
 *
 * 의존성도 함께 번들한다. 산출물이 저장소 루트의 api/ 에 놓이는데,
 * pnpm 워크스페이스에서는 express 같은 패키지가 apps/api/node_modules 에만
 * 있어서 루트에서 import 하면 못 찾는다.
 *
 * 다만 @libsql/client 는 external 로 남긴다. 플랫폼별 네이티브 바이너리를
 * optional dependency 로 달고 있어서, 인라인하면 바이너리가 딸려오지 않는다.
 * 이 하나만 루트 package.json 에 의존성으로 선언해 둔다.
 */
const EXTERNAL = ['@libsql/client'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'api/index.js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'apps/api/src/serverless.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: EXTERNAL,
  // express 를 비롯한 의존성이 CJS 라, ESM 번들 안에서 require 가 돌게 해 준다
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  // 스택 추적이 원본 줄 번호를 가리키게 한다. 배포 로그를 읽을 수 있어야 한다.
  sourcemap: true,
  logLevel: 'info',
});

console.log(`서버리스 번들 생성: ${outfile}`);
