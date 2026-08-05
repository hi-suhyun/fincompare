import { z } from 'zod';

export const CountrySchema = z.enum(['KR', 'US']);
export type Country = z.infer<typeof CountrySchema>;

export const MarketSchema = z.enum(['KOSPI', 'KOSDAQ', 'NYSE', 'NASDAQ']);
export type Market = z.infer<typeof MarketSchema>;

export const CurrencySchema = z.enum(['KRW', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

export const SourceIdSchema = z.enum(['DART', 'SEC', 'KRX', 'NAVER', 'TIINGO', 'ECB']);
export type SourceId = z.infer<typeof SourceIdSchema>;

/**
 * 기업 식별자는 `{country}:{code}` 형태로 고정한다.
 * 국내는 6자리 종목코드, 미국은 티커를 쓴다. (`KR:005930`, `US:NVDA`)
 * DART corp_code / SEC cik 는 내부 조회용이라 ID로 노출하지 않는다.
 */
export const CompanySchema = z.object({
  id: z.string(),
  country: CountrySchema,
  market: MarketSchema,
  nameKo: z.string().nullable(),
  nameEn: z.string().nullable(),
  /** DART 고유번호 8자리. 미국 기업은 null */
  corpCode: z.string().length(8).nullable(),
  /** 국내 종목코드 6자리. 미국 기업은 null */
  stockCode: z.string().length(6).nullable(),
  /** SEC CIK 10자리(0 패딩). 국내 기업은 null */
  cik: z.string().length(10).nullable(),
  ticker: z.string().nullable(),
  /** 결산월(1~12). 정렬 규칙과 UI 배지에 쓴다 */
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  /** 20-F / 40-F 제출자 = ADR·외국사기업. 1차 범위에서 미지원 */
  isAdr: z.boolean(),
  /** 지원 대상 여부. 검색 결과에는 노출하되 선택은 막는다 */
  isSupported: z.boolean(),
});
export type Company = z.infer<typeof CompanySchema>;

export const reportingCurrency = (country: Country): Currency =>
  country === 'KR' ? 'KRW' : 'USD';
