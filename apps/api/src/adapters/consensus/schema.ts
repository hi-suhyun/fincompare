import { z } from 'zod';

/**
 * FMP 응답 스키마.
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

/**
 * 개별 목표주가.
 *
 * publishedDate 가 있어야 "그때의 의견"이 성립한다. 이 필드가 없으면
 * 과거 비교 자체가 불가능하므로 필수로 잡는다.
 */
export const FmpPriceTargetSchema = z.object({
  symbol: z.string(),
  publishedDate: z.string(),
  priceTarget: LooseNumber,
  /** 발행 당시 주가. 없는 요금제가 있어 선택 */
  priceWhenPosted: LooseNumber,
  analystCompany: z.string().nullish(),
  analystName: z.string().nullish(),
});

export const FmpPriceTargetListSchema = z.array(FmpPriceTargetSchema);

/**
 * 현재 컨센서스. 과거 이력을 못 받을 때의 대체재다.
 *
 * 이걸로는 "그때 맞았나"를 답할 수 없다 — 지금 시점의 의견 하나뿐이다.
 */
export const FmpConsensusSchema = z.object({
  symbol: z.string(),
  targetHigh: LooseNumber,
  targetLow: LooseNumber,
  targetConsensus: LooseNumber,
  targetMedian: LooseNumber,
});

export const FmpConsensusListSchema = z.array(FmpConsensusSchema);

/**
 * FMP 는 요금제 밖 요청에도 200 으로 응답하면서 본문에 안내 문구를 담는다.
 * 이걸 데이터로 착각하면 "목표주가 0건"으로 조용히 넘어간다.
 */
export const FmpErrorSchema = z.object({
  'Error Message': z.string(),
});

export type FmpPriceTarget = z.infer<typeof FmpPriceTargetSchema>;
export type FmpConsensus = z.infer<typeof FmpConsensusSchema>;
