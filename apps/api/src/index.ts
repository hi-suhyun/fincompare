import { describeMissingKeys } from './config.js';
import { createApp } from './createApp.js';

/**
 * 로컬 개발 서버.
 *
 * 앱 조립은 createApp.ts 에 있다. 배포(서버리스)는 포트를 열지 않고
 * 그 앱을 그대로 가져다 쓴다.
 */

const { app, handle, config } = await createApp();

// 포트가 이미 쓰이고 있으면 크게 알린다. 조용히 넘어가면 요청이 엉뚱한 서버로 가서
// "서버는 떴는데 응답이 없다"는 상황을 한참 헤매게 된다.
const server = app.listen(config.PORT, '127.0.0.1', () => {
  console.log(`API 서버: http://localhost:${config.PORT}`);
  const missing = describeMissingKeys(config);
  if (missing.length > 0) {
    console.log('설정되지 않은 키 (해당 기능 사용 불가):');
    for (const key of missing) console.log(`  - ${key}`);
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n❌ 포트 ${config.PORT} 이 이미 사용 중입니다.\n` +
        `   점유 프로세스 확인: lsof -nP -iTCP:${config.PORT} -sTCP:LISTEN\n` +
        `   다른 포트를 쓰려면 .env 의 PORT 를 바꾸세요.\n`,
    );
  } else {
    console.error('서버 시작 실패:', error);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      handle.close();
      process.exit(0);
    });
  });
}
