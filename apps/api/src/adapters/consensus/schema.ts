import { z } from 'zod';

/**
 * FMP stable API 응답 스키마.
 *
 * 느슨하게 받는다. FMP 는 같은 필드를 기업마다 문자열/숫자로 섞어 주고,
 * 요금제에 따라 필드가 통째로 빠지기도 한다. 엄격하게 잡으면 한 기업의
 * 이상한 행 하나 때문에 전체 조회가 죽는다 — SEC 어댑터에서 이미 겪었다.
 */

/** 문자열로 오는 숫자를 받아 준다. 못 읽으면 null */
const LooseNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

const LooseCount = LooseNumber.transform((v) => (v === null ? 0 : Math.max(0, Math.round(v))));

/**
 * 연간 추정치.
 *
 * date 는 회계기간 종료일이다 (NVDA 는 2024-01-25 처럼 1월). 연도만 잘라
 * 쓰면 결산월이 다른 기업이 실제값과 다른 해에 놓인다.
 */
export const FmpEstimateSchema = z.object({
  symbol: z.string(),
  date: z.string(),
  revenueLow: LooseNumber,
  revenueAvg: LooseNumber,
  revenueHigh: LooseNumber,
  epsLow: LooseNumber,
  epsAvg: LooseNumber,
  epsHigh: LooseNumber,
  numAnalystsRevenue: LooseCount,
  numAnalystsEps: LooseCount,
});

export const FmpEstimateListSchema = z.array(FmpEstimateSchema);

/** 현재 목표주가 컨센서스 */
export const FmpPriceTargetConsensusSchema = z.object({
  symbol: z.string(),
  targetHigh: LooseNumber,
  targetLow: LooseNumber,
  targetConsensus: LooseNumber,
  targetMedian: LooseNumber,
});

export const FmpPriceTargetConsensusListSchema = z.array(FmpPriceTargetConsensusSchema);

/**
 * FMP 는 요금제 밖 요청을 200 이 아닌 402/403 으로 주기도 하고,
 * 200 본문에 안내 문구를 담기도 한다. 후자를 데이터로 착각하면
 * "추정치 0건" 으로 조용히 넘어간다.
 */
export const FmpErrorSchema = z.union([
  z.object({ 'Error Message': z.string() }),
  z.object({ message: z.string() }),
]);

export type FmpEstimate = z.infer<typeof FmpEstimateSchema>;
