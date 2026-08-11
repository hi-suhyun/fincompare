import express, { type ErrorRequestHandler, type Express } from 'express';
import { count } from 'drizzle-orm';
import { loadConfig, describeMissingKeys, type Config } from './config.js';
import { SourceError } from './core/errors.js';
import { createDb, type DbHandle } from './db/client.js';
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
import { FmpConsensusAdapter } from './adapters/consensus/fmp.js';
import type { ConsensusAdapter } from './adapters/consensus/types.js';
import type { PriceAdapter } from './adapters/price/types.js';
import { CacheLayer } from './core/cache.js';
import { RequestQueue } from './core/queue.js';
import { DEFAULT_LIMITS, RateLimiter } from './core/rateLimiter.js';
import { SqliteCacheStore } from './db/cacheStore.js';

/**
 * 앱 조립. 서버 실행(listen)과 분리해 둔 이유는 서버리스 때문이다.
 *
 * Vercel 함수는 포트를 열지 않고 핸들러만 부른다. 로컬은 index.ts 가
 * 이걸 받아 listen 한다.
 */

export interface CreateAppOptions {
  config?: Config;
  /**
   * 마이그레이션을 켤지.
   *
   * 서버리스에서는 꺼야 한다. 콜드 스타트마다 원격 DB 에 마이그레이션을 돌리면
   * 첫 응답이 느려지고 Turso 호출만 낭비한다. 배포 스키마는 배포 전에 맞춰 둔다.
   */
  migrate?: boolean;
}

export interface AppBundle {
  app: Express;
  handle: DbHandle;
  config: Config;
}

export async function createApp(options: CreateAppOptions = {}): Promise<AppBundle> {
  const config = options.config ?? loadConfig();

  const handle = await createDb(config.DATABASE_URL, {
    ...(config.TURSO_AUTH_TOKEN === '' ? {} : { authToken: config.TURSO_AUTH_TOKEN }),
    migrateOnStart: options.migrate ?? true,
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
  const buildKrPriceAdapter = (): PriceAdapter | null => {
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
  };

  /**
   * 미국 주가는 키가 있을 때만 붙는다.
   *
   * 무료 주가 API 는 받은 데이터를 남에게 보여주는 걸 약관으로 금지한다.
   * 그래서 가족 배포판은 키를 비워 두고, 각자 자기 키로 셀프호스트하면 켜진다.
   * 그때는 데이터가 제공처에서 그 사람에게 직접 가므로 재배포가 아니다.
   */
  const buildUsPriceAdapter = (): PriceAdapter | null => {
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
  };

  /**
   * 애널리스트 목표주가. 키가 있을 때만 붙는다.
   *
   * FMP 약관은 데이터를 제3자가 접근 가능한 도구에 통합하는 것을 금지한다.
   * 그래서 가족 배포판은 키를 비워 두고, 본인 키로 로컬·셀프호스트할 때만 켜진다.
   * Tiingo 와 같은 판단이다 (docs/00-data-sources.md).
   */
  const buildConsensusAdapter = (): ConsensusAdapter | null => {
    if (config.FMP_API_KEY.trim() === '') return null;
    return new FmpConsensusAdapter({
      apiKey: config.FMP_API_KEY,
      queue: new RequestQueue({
        source: 'FMP',
        limiter: new RateLimiter(DEFAULT_LIMITS.FMP),
        concurrency: 1,
      }),
      cache,
    });
  };

  const krPrice = buildKrPriceAdapter();
  const usPrice = buildUsPriceAdapter();
  const consensusAdapter = buildConsensusAdapter();

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
            /** 미국 기업 목표주가. 국내는 링크아웃만이라 여기에 들어오지 않는다 */
            consensus: consensusAdapter !== null,
          },
        });
      })
      .catch(next);
  });

  app.use('/api/companies', createCompaniesRouter(handle.db));
  app.use(
    '/api/series',
    createSeriesRouter({ db: handle.db, dart, sec, fx, krPrice, usPrice, consensusAdapter }),
  );

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

  return { app, handle, config };
}
