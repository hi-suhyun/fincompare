import type { BaseMetricId } from '../schema/financial.js';

/**
 * 계정과목 매핑 규칙.
 *
 * 태그 ID 매칭을 1순위로 두고, 계정명 정규식은 최후 폴백이다.
 * 기업마다 "매출액" / "수익(매출액)" / "영업수익" 처럼 표기가 제각각이라
 * 문자열 매칭을 1순위로 두면 조용히 틀린 계정을 집어온다.
 */
export interface AccountRule {
  /** 우선순위 순서의 태그 후보. 앞에서부터 찾아 첫 번째로 값이 있는 것을 채택 */
  readonly tags: readonly string[];
  /** 태그로 못 찾았을 때만 쓰는 계정명 폴백 */
  readonly namePattern?: RegExp;
  /** 어느 재무제표에서 찾을지 (DART sj_div). SEC 는 무시 */
  readonly statements?: readonly string[];
  readonly note?: string;
}

export type AccountMap = Readonly<Partial<Record<BaseMetricId, AccountRule>>>;

/** 어댑터가 넘기는 정규화 전 원본 행 */
export interface RawFact {
  /** DART account_id 또는 SEC XBRL 태그 */
  tag: string;
  /** DART account_nm. SEC 는 없음 */
  name?: string;
  /** DART sj_div (BS/IS/CIS/CF/SCE) */
  statement?: string;
  value: number | null;
}

export interface ResolveResult {
  value: number | null;
  /** 실제로 채택된 태그 또는 'name:<패턴>' */
  sourceTag: string | null;
  /** 태그로 못 찾고 계정명 폴백을 썼는지 — 신뢰도가 낮으므로 로깅한다 */
  usedNameFallback: boolean;
}
