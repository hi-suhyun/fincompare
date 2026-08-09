import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './createApp.js';

/**
 * 서버리스 진입점 (Vercel 함수).
 *
 * 로컬 서버(index.ts)와 같은 앱을 쓰되 포트를 열지 않는다.
 *
 * 앱 조립을 모듈 스코프 프라미스로 잡아 두는 이유는 콜드 스타트 때문이다.
 * 한 인스턴스가 여러 요청을 처리하므로 그동안 DB 연결과 캐시를 재사용한다.
 * 요청마다 다시 만들면 Turso 연결이 매번 새로 열린다.
 *
 * 마이그레이션은 끈다. 배포 스키마는 배포 전에 맞춰 두는 것이고,
 * 콜드 스타트마다 원격 DB 에 마이그레이션을 돌릴 이유가 없다.
 */
const bundle = createApp({ migrate: false });

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { app } = await bundle;
  app(req as never, res as never);
}
