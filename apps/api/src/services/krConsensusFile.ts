import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { alignToYears, type ConsensusPoint, type PriceTargetConsensus } from '@fincompare/shared';
import type { CompanyConsensus } from './consensus.js';

/**
 * 국내 컨센서스 — 직접 조사한 기록.
 *
 * 왜 파일인가:
 *
 * 국내 증권사 리포트와 그 컨센서스는 저작물이고, 한경·FnGuide 는 기계적
 * 수집을 약관으로 금지한다. 전 종목을 긁어 DB 로 만드는 건 데이터베이스
 * 제작자의 권리도 건드린다. 그래서 **자동 수집을 하지 않는다.**
 *
 * 대신 공개 뉴스에 실린 집계 숫자("증권가 목표주가 평균 49만원")를 사람이
 * 조사해 이 파일에 적는다. 개별 숫자는 사실이라 저작권 대상이 아니고,
 * 소수 종목을 출처와 함께 적어 두는 건 본인 조사 노트에 가깝다.
 *
 * 이 파일은 apps/api/data/ 아래에 있고 그 경로는 .gitignore 되어 있다 —
 * 저장소가 공개라서, 커밋되면 그 순간 재배포가 된다.
 *
 * 형식은 data/kr-consensus.example.json 을 참고한다.
 */

const FILE_NAME = 'kr-consensus.json';

/**
 * 개별 증권사 목표주가.
 *
 * 평균 하나만 보면 "그 근처를 보는 곳이 많다" 로 읽히는데, 실제로는 양 끝만
 * 있고 가운데가 비어 있는 경우가 흔하다 (SK하이닉스 148만 vs 470만).
 * 그래서 집계와 함께 개별값도 적어 둘 수 있게 한다.
 */
const AnalystSchema = z.object({
  firm: z.string(),
  target: z.number(),
  /** 리포트 발행일 (YYYY-MM-DD). 오래된 목표가는 이미 갱신됐을 수 있다 */
  date: z.string().optional(),
  /** '매수' · '중립' 등. 모르면 비운다 */
  opinion: z.string().optional(),
  /** 직전 목표가. 상향·하향을 보여줄 수 있다 */
  previous: z.number().optional(),
});

const TargetSchema = z.object({
  high: z.number().nullable().default(null),
  avg: z.number().nullable().default(null),
  low: z.number().nullable().default(null),
  /**
   * 조사한 증권사 목록. 전체 집계가 아니라 **찾은 것만** 이다.
   * 화면에서도 그렇게 밝힌다 — 이걸 전부로 읽으면 평균이 왜 그 값인지 어긋난다.
   */
  analysts: z.array(AnalystSchema).optional(),
});

const YearEstimateSchema = z.object({
  year: z.number().int(),
  high: z.number().nullable().default(null),
  avg: z.number().nullable().default(null),
  low: z.number().nullable().default(null),
  /** 집계에 들어간 증권사 수. 모르면 0 */
  count: z.number().int().nonnegative().default(0),
});

const EntrySchema = z.object({
  /** "KR:005930" */
  companyId: z.string(),
  /** 조사한 날짜 (YYYY-MM-DD). 화면에 그대로 보여준다 */
  asOf: z.string(),
  /** 현재 목표주가 컨센서스 */
  priceTarget: TargetSchema.nullish(),
  /** 연도별 추정치. 지표별로 나눈다 (revenue · eps) */
  estimates: z.record(z.string(), z.array(YearEstimateSchema)).default({}),
  /**
   * 출처 URL. 하나 이상 필수다.
   *
   * 출처 없는 숫자는 적지 않는다 — 나중에 어디서 왔는지 못 밝히면
   * 그 숫자를 믿을 근거가 없다.
   */
  sources: z.array(z.string().url()).min(1),
  note: z.string().optional(),
});

const FileSchema = z.object({
  entries: z.array(EntrySchema).default([]),
});

export type KrConsensusEntry = z.infer<typeof EntrySchema>;

function filePath(databaseUrl: string): string {
  // DB 와 같은 폴더에 둔다. 그 경로가 이미 gitignore 되어 있다.
  const dbPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  if (dbPath === ':memory:') {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../data', FILE_NAME);
  }
  return resolve(dirname(resolve(dbPath)), FILE_NAME);
}

/**
 * 조사 기록을 읽는다.
 *
 * 파일이 없으면 빈 목록이다 — 대부분의 사용자는 이 파일을 안 만든다.
 * 형식이 깨졌으면 조용히 넘기지 않고 로그를 남긴다. 잘못 적은 줄 하나 때문에
 * 전부 사라지면 왜 안 뜨는지 알 수 없다.
 */
export function loadKrConsensusFile(databaseUrl: string): KrConsensusEntry[] {
  const path = filePath(databaseUrl);
  if (!existsSync(path)) return [];

  try {
    const parsed = FileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      console.warn(`${FILE_NAME} 형식이 올바르지 않습니다:`);
      for (const issue of parsed.error.issues.slice(0, 5)) {
        console.warn(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      return [];
    }
    return parsed.data.entries;
  } catch (error) {
    console.warn(`${FILE_NAME} 을 읽지 못했습니다:`, error);
    return [];
  }
}

/** 조사 기록을 화면이 쓰는 형태로 바꾼다 */
export function toCompanyConsensus(
  entry: KrConsensusEntry,
  years: readonly number[],
): CompanyConsensus {
  const estimates: Record<string, ConsensusPoint[]> = {};

  for (const [metricId, rows] of Object.entries(entry.estimates)) {
    const byYear = new Map<number, ConsensusPoint>(
      rows.map((r) => [r.year, { year: r.year, high: r.high, avg: r.avg, low: r.low, count: r.count }]),
    );
    const points = alignToYears(byYear, years);
    if (points.some((p) => p.avg !== null)) estimates[metricId] = points;
  }

  const priceTarget: PriceTargetConsensus | null =
    entry.priceTarget === null || entry.priceTarget === undefined
      ? null
      : { ...entry.priceTarget, currency: 'KRW' };

  return {
    companyId: entry.companyId,
    estimates,
    priceTarget,
    // 자동 수집이 아니라 사람이 적은 기록이라는 것을 화면에서 구분해야 한다
    source: '직접 조사',
    currency: 'KRW',
    asOf: entry.asOf,
    sources: entry.sources,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  };
}
