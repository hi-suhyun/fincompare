import { z } from 'zod';

/**
 * SEC EDGAR companyfacts 응답 스키마.
 *
 * 실측(2026-08-06)으로 확인한 구조. Apple 기준 3.8MB / us-gaap 503개 개념.
 * 반드시 캐싱해야 하고, 파싱도 필요한 태그만 골라서 한다.
 */

export const SecFactRowSchema = z.object({
  /** 기간 시작. 재무상태표 항목은 없다 (시점 데이터) */
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  /**
   * ⚠️ 회계연도 식별자로 쓰면 안 된다.
   * "이 숫자가 어느 보고서에 실렸나"이지 "어느 회계연도냐"가 아니다.
   * AAPL FY2021 매출이 fy=2023 으로 찍힌다 (FY2023 10-K 의 비교표시).
   *
   * nullish 인 이유: 424B5 같은 서식에서 온 행은 fy/fp 가 명시적 null 이다.
   */
  fy: z.number().nullish(),
  fp: z.string().nullish(),
  form: z.string().nullish(),
  filed: z.string().nullish(),
  /** SEC 가 매긴 달력 프레임. 결측이 많아 정렬 키로 못 쓴다 */
  frame: z.string().nullish(),
  accn: z.string().nullish(),
});
export type SecFactRow = z.infer<typeof SecFactRowSchema>;

export const SecConceptSchema = z.object({
  label: z.string().nullish(),
  description: z.string().nullish(),
  units: z.record(z.string(), z.array(SecFactRowSchema)),
});
export type SecConcept = z.infer<typeof SecConceptSchema>;

/**
 * 최상위는 느슨하게 받는다.
 *
 * 응답이 기업당 3.8MB / 500개 개념인데 우리가 읽는 태그는 15개뿐이다.
 * 전체를 엄격히 검증하면 (a) 매 캐시 미스마다 불필요한 비용이 들고
 * (b) 우리가 쓰지도 않는 개념 하나가 예상과 다르면 기업 전체가 실패한다.
 *
 * 실제로 Intel 의 ffd 택사노미 행(fy: null)이 이 문제를 일으켰다.
 * 개념 검증은 실제로 읽을 때 readConcept() 에서 한다.
 */
export const SecCompanyFactsSchema = z.object({
  cik: z.number(),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type SecCompanyFacts = z.infer<typeof SecCompanyFactsSchema>;

/** 실제로 읽는 개념만 검증한다. 형태가 다르면 null — 그 태그만 건너뛴다 */
export function readConcept(
  facts: SecCompanyFacts,
  taxonomy: string,
  tag: string,
): SecConcept | null {
  const raw = facts.facts[taxonomy]?.[tag];
  if (raw === undefined) return null;

  const parsed = SecConceptSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** company_tickers.json — 객체의 값들이 항목이다 (배열이 아니다) */
export const SecTickerEntrySchema = z.object({
  cik_str: z.number(),
  ticker: z.string(),
  title: z.string(),
});
export const SecTickersSchema = z.record(z.string(), SecTickerEntrySchema);

/** submissions/CIK{...}.json — ADR 판별에 쓴다 */
export const SecSubmissionsSchema = z.object({
  cik: z.string(),
  name: z.string(),
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string()).optional(),
  /** 결산월 'MMDD' 형식. 예: '0930' = 9월 결산 */
  fiscalYearEnd: z.string().nullable().optional(),
  filings: z
    .object({
      recent: z
        .object({
          form: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type SecSubmissions = z.infer<typeof SecSubmissionsSchema>;

/** CIK 를 10자리 0패딩으로 정규화한다. URL 에 그대로 쓰인다 */
export function padCik(cik: number | string): string {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

/** fiscalYearEnd 'MMDD' -> 결산월(1~12). 없으면 12월로 본다 */
export function parseFiscalYearEndMonth(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 12;
  const month = Number(raw.trim().slice(0, 2));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12;
}

/** 거래소 코드 -> 내부 Market. NYSE/NASDAQ 외에는 1차 범위 밖 */
export function marketFromExchange(exchanges: readonly string[] | undefined): 'NYSE' | 'NASDAQ' | null {
  for (const exchange of exchanges ?? []) {
    const normalized = exchange.trim().toUpperCase();
    if (normalized === 'NASDAQ') return 'NASDAQ';
    if (normalized === 'NYSE') return 'NYSE';
  }
  return null;
}
