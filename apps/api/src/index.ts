import express, { type ErrorRequestHandler } from 'express';
import { count } from 'drizzle-orm';
import { loadConfig, describeMissingKeys } from './config.js';
import { SourceError } from './core/errors.js';
import { createDb } from './db/client.js';
import { companies } from './db/schema.js';
import { createAccessGate } from './middleware/accessGate.js';
import { createCompaniesRouter } from './routes/companies.js';
import { createSeriesRouter } from './routes/series.js';
import { DartClient } from './adapters/dart/client.js';
import { SecClient } from './adapters/sec/client.js';
import { FxClient } from './adapters/fx/ecb.js';
import { KrxPriceAdapter } from './adapters/price/krx.js';
import { NaverPriceAdapter } from './adapters/price/naver.js';
import { TiingoPriceAdapter } from './adapters/price/tiingo.js';
import type { PriceAdapter } from './adapters/price/types.js';
import { CacheLayer } from './core/cache.js';
import { RequestQueue } from './core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from './core/rateLimiter.js';
import { SqliteCacheStore } from './db/cacheStore.js';

const config = loadConfig();
const handle = await createDb(config.DATABASE_URL, {
  ...(config.TURSO_AUTH_TOKEN === '' ? {} : { authToken: config.TURSO_AUTH_TOKEN }),
});

const cache = new CacheLayer(new SqliteCacheStore(handle.db));

const dart = new DartClient({
  apiKey: config.DART_API_KEY,
  // 사용자 요청 처리라 시딩만큼 공격적으로 보내지 않는다
  queue: new RequestQueue({
    source: 'DART',
    limiter: new RateLimiter({ ...DEFAULT_LIMITS.DART }),
    concurrency: 4,
  }),
  cache,
});

const sec = new SecClient({
  userAgent: config.SEC_USER_AGENT,
  queue: new RequestQueue({
    source: 'SEC',
    limiter: new RateLimiter({ ...DEFAULT_LIMITS.SEC }),
    concurrency: 4,
  }),
  cache,
});

const fx = new FxClient({
  queue: new RequestQueue({
    source: 'ECB',
    limiter: new RateLimiter({ ...DEFAULT_LIMITS.ECB }),
    concurrency: 2,
  }),
  cache,
});

/**
 * 주가 어댑터는 환경변수로 갈아끼운다.
 * KRX 승인 전에는 네이버 폴백으로 개발하고, 승인되면 PRICE_PROVIDER_KR=krx 로 바꾼다.
 */
function buildKrPriceAdapter(): PriceAdapter | null {
  const queue = new RequestQueue({
    source: config.PRICE_PROVIDER_KR === 'krx' ? 'KRX' : 'NAVER',
    limiter: new RateLimiter(
      config.PRICE_PROVIDER_KR === 'krx' ? DEFAULT_LIMITS.KRX : DEFAULT_LIMITS.NAVER,
    ),
    concurrency: 2,
  });

  if (config.PRICE_PROVIDER_KR === 'krx') {
    if (config.KRX_AUTH_KEY.trim() === '') return null;
    return new KrxPriceAdapter({ authKey: config.KRX_AUTH_KEY, queue, cache });
  }
  return new NaverPriceAdapter({ queue, cache });
}

function buildUsPriceAdapter(): PriceAdapter | null {
  if (config.TIINGO_API_KEY.trim() === '') return null;
  return new TiingoPriceAdapter({
    apiKey: config.TIINGO_API_KEY,
    queue: new RequestQueue({
      source: 'TIINGO',
      limiter: new RateLimiter(DEFAULT_LIMITS.TIINGO),
      concurrency: 1,
    }),
    cache,
  });
}

const krPrice = buildKrPriceAdapter();
const usPrice = buildUsPriceAdapter();

const app = express();
app.use(express.json());

/**
 * CORS.
 *
 * 배포에서는 프론트와 API 가 같은 오리진이라 CORS 가 필요 없다.
 * 로컬 개발에서만 Vite(5173) 에서 오는 요청을 허용한다.
 *
 * credentials 를 켜야 접근 게이트 쿠키가 오간다. 그래서 오리진을 * 로 둘 수 없고
 * 정확히 지정해야 한다 — 어차피 가족 전용이라 넓게 열 이유도 없다.
 */
const ALLOWED_ORIGIN = 'http://localhost:5173';

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Access-Password');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// 헬스체크는 게이트 밖에 둔다. 배포 상태 확인에 비밀번호가 필요하면 곤란하다.
app.use(createAccessGate({ password: config.ACCESS_PASSWORD, publicPaths: ['/api/health'] }));

app.get('/api/health', (_req, res, next) => {
  handle.db
    .select({ value: count() })
    .from(companies)
    .then(([row]) => {
      res.json({
        ok: true,
        companies: row?.value ?? 0,
        missingKeys: describeMissingKeys(config),
        // 이 인스턴스가 주가를 붙일 수 있는지. 프론트가 안내 문구를 여기에 맞춘다.
        // 셀프호스트에서 본인 Tiingo 키를 넣으면 미국 밸류에이션도 켜진다.
        capabilities: {
          krPrices: krPrice !== null,
          usPrices: usPrice !== null,
        },
      });
    })
    .catch(next);
});

app.use('/api/companies', createCompaniesRouter(handle.db));
app.use('/api/series', createSeriesRouter({ db: handle.db, dart, sec, fx, krPrice, usPrice }));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof SourceError) {
    // 외부 소스 문제는 502 가 맞다. 우리 잘못이 아니라는 걸 구분해야
    // 화면에서 "데이터 제공처 문제"로 안내할 수 있다.
    const status = error.kind === 'QUOTA_EXCEEDED' ? 429 : 502;
    res.status(status).json({ error: error.kind, message: error.message, source: error.source });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'INTERNAL', message: '서버 오류' });
};
app.use(errorHandler);

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
