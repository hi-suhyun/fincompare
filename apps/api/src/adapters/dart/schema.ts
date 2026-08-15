import { z } from 'zod';

/**
 * DART 응답 Zod 스키마.
 *
 * DART 는 오류를 HTTP 상태가 아니라 본문의 `status` 로 알려준다.
 * HTTP 200 + status '013' 이 "데이터 없음"이다. 그래서 스키마는 status 를 먼저 본다.
 */

export const DartEnvelopeSchema = z.object({
  status: z.string(),
  message: z.string(),
});
export type DartEnvelope = z.infer<typeof DartEnvelopeSchema>;

/** fnlttSinglAcntAll — 단일회사 전체 재무제표 */
export const DartFinancialRowSchema = z.object({
  rcept_no: z.string(),
  reprt_code: z.string(),
  bsns_year: z.string(),
  corp_code: z.string(),
  /** BS | IS | CIS | CF | SCE */
  sj_div: z.string(),
  sj_nm: z.string().optional(),
  /** ifrs-full_Revenue, dart_OperatingIncomeLoss 등. 확장 계정은 '-' 가 올 수 있다 */
  account_id: z.string(),
  account_nm: z.string(),
  account_detail: z.string().optional(),
  thstrm_nm: z.string().optional(),
  /** 당기 금액. '' 이 올 수 있다 */
  thstrm_amount: z.string().optional(),
  /**
   * 당기 누적. 분기·반기 보고서에만 온다.
   *
   * 반기보고서면 thstrm_amount 는 2분기 3개월치, thstrm_add_amount 는
   * 상반기 6개월치다. TTM 을 만들 때 필요한 쪽은 누적이다.
   */
  thstrm_add_amount: z.string().optional(),
  /** 전기 같은 기간 누적. TTM = 직전 연간 + 당기누적 - 전기누적 */
  frmtrm_add_amount: z.string().optional(),
  /** 전기 금액 */
  frmtrm_nm: z.string().optional(),
  frmtrm_amount: z.string().optional(),
  /** 전전기 금액. 사업보고서에만 온다 */
  bfefrmtrm_nm: z.string().optional(),
  bfefrmtrm_amount: z.string().optional(),
  ord: z.string().optional(),
  currency: z.string().optional(),
});
export type DartFinancialRow = z.infer<typeof DartFinancialRowSchema>;

export const DartFinancialResponseSchema = DartEnvelopeSchema.extend({
  list: z.array(DartFinancialRowSchema).optional(),
});

/** stockTotqySttus — 주식의 총수 현황 */
export const DartStockRowSchema = z.object({
  rcept_no: z.string().optional(),
  corp_code: z.string().optional(),
  /** 보통주 | 우선주 | 합계 | 비고 */
  se: z.string(),
  /** 발행할 주식의 총수 (수권주식수) — PER 계산에 쓰면 안 된다 */
  isu_stock_totqy: z.string().optional(),
  /** 발행주식의 총수 */
  istc_totqy: z.string().optional(),
  /** 자기주식수 */
  tesstk_co: z.string().optional(),
  /** 유통주식수 = 발행주식총수 - 자기주식. EPS 분모로 쓸 값 */
  distb_stock_co: z.string().optional(),
});
export type DartStockRow = z.infer<typeof DartStockRowSchema>;

export const DartStockResponseSchema = DartEnvelopeSchema.extend({
  list: z.array(DartStockRowSchema).optional(),
});

/** company — 기업개황 */
export const DartCompanyResponseSchema = DartEnvelopeSchema.extend({
  corp_name: z.string().optional(),
  corp_name_eng: z.string().optional(),
  stock_name: z.string().optional(),
  stock_code: z.string().optional(),
  /** Y=유가증권 K=코스닥 N=코넥스 E=기타(상장폐지 포함) */
  corp_cls: z.string().optional(),
  /** 결산월 */
  acc_mt: z.string().optional(),
  est_dt: z.string().optional(),
  induty_code: z.string().optional(),
});
export type DartCompanyResponse = z.infer<typeof DartCompanyResponseSchema>;

/** corp_cls -> 내부 Market. 상장 중인 KOSPI/KOSDAQ 만 지원 대상이다 */
export function marketFromCorpCls(corpCls: string | undefined): 'KOSPI' | 'KOSDAQ' | null {
  if (corpCls === 'Y') return 'KOSPI';
  if (corpCls === 'K') return 'KOSDAQ';
  // N=코넥스, E=기타(상장폐지 포함)는 1차 범위 밖
  return null;
}

/** 보고서 코드 */
export const REPORT_CODE = {
  Q1: '11013',
  HALF: '11012',
  Q3: '11014',
  ANNUAL: '11011',
} as const;

export type ReportCode = (typeof REPORT_CODE)[keyof typeof REPORT_CODE];
