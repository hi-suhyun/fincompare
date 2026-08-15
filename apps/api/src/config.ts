import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * .env 는 모노레포 루트에만 둔다. 앱마다 복사하면 키가 흩어진다.
 *
 * 후보를 두 개 보는 이유는 번들 때문이다. 서버리스 함수로 번들되면
 * import.meta.url 이 저장소 루트의 api/ 를 가리켜 상대 경로가 어긋난다.
 *
 * 배포에는 .env 가 아예 없다 — 플랫폼이 환경변수를 직접 주입한다.
 * 그래서 하나도 못 찾아도 조용히 넘어간다.
 */
for (const candidate of [
  fileURLToPath(new URL('../../../.env', import.meta.url)),
  resolve(process.cwd(), '.env'),
]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, quiet: true });
    break;
  }
}

const ConfigSchema = z.object({
  DART_API_KEY: z.string().default(''),
  SEC_USER_AGENT: z.string().default(''),
  KRX_AUTH_KEY: z.string().default(''),
  TIINGO_API_KEY: z.string().default(''),
  /**
   * 애널리스트 컨센서스 (Financial Modeling Prep).
   *
   * 비워 두면 컨센서스 기능이 꺼진다. 나머지는 그대로 동작한다.
   *
   * 이 도구가 로컬 전용인 이유가 여기 있다. FMP 약관은 데이터를 "제3자가
   * 접근 가능한 도구에 통합"하는 것을 금지하는데, 각자 자기 키로 자기
   * 컴퓨터에서 받아 보는 건 재배포가 아니라 본인 데이터다.
   */
  FMP_API_KEY: z.string().default(''),
  PRICE_PROVIDER_KR: z.enum(['krx', 'naver']).default('krx'),
  PRICE_PROVIDER_US: z.enum(['tiingo', 'twelvedata']).default('tiingo'),
  /** 로컬 SQLite 파일. 이 도구는 각자 자기 컴퓨터에서 돌린다 */
  DATABASE_URL: z.string().default('file:./data/dev.db'),
  PORT: z.coerce.number().int().positive().default(3100),
  /**
   * 접근 비밀번호. 로컬 전용 도구라 보통은 비워 둔다.
   *
   * 집 네트워크의 다른 기기에서 열어 볼 때처럼 굳이 막고 싶은 경우에만 채운다.
   * 채우면 API 전체가 비밀번호 뒤로 들어간다.
   */
  ACCESS_PASSWORD: z.string().default(''),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`.env 설정이 잘못되었습니다:\n${issues}`);
  }
  return parsed.data;
}

/** 키가 없으면 그 소스는 못 쓴다. 시작 시점에 알려주는 게 낫다 */
export function describeMissingKeys(config: Config): string[] {
  const missing: string[] = [];
  if (config.DART_API_KEY === '') missing.push('DART_API_KEY (국내 재무제표)');
  if (config.SEC_USER_AGENT === '') missing.push('SEC_USER_AGENT (미국 재무제표 — 없으면 403)');
  if (config.KRX_AUTH_KEY === '' && config.PRICE_PROVIDER_KR === 'krx') {
    missing.push('KRX_AUTH_KEY (국내 주가)');
  }
  // 미국 주가는 의도적으로 비워 둔다 (무료 티어가 재배포를 금지한다).
  // 설정 누락이 아니라 설계 결정이므로 "빠진 키" 목록에 넣지 않는다.
  return missing;
}
