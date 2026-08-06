import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// .env 는 모노레포 루트에만 둔다. 앱마다 복사하면 키가 흩어진다.
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const ConfigSchema = z.object({
  DART_API_KEY: z.string().default(''),
  SEC_USER_AGENT: z.string().default(''),
  KRX_AUTH_KEY: z.string().default(''),
  TIINGO_API_KEY: z.string().default(''),
  PRICE_PROVIDER_KR: z.enum(['krx', 'naver']).default('krx'),
  PRICE_PROVIDER_US: z.enum(['tiingo', 'twelvedata']).default('tiingo'),
  DATABASE_URL: z.string().default('file:./data/dev.db'),
  PORT: z.coerce.number().int().positive().default(3100),
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
  if (config.TIINGO_API_KEY === '' && config.PRICE_PROVIDER_US === 'tiingo') {
    missing.push('TIINGO_API_KEY (미국 주가)');
  }
  return missing;
}
