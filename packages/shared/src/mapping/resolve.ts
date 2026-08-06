import type { BaseMetricId } from '../schema/financial.js';
import type { AccountMap, AccountRule, RawFact, ResolveResult } from './types.js';

const NOT_FOUND: ResolveResult = { value: null, sourceTag: null, usedNameFallback: false };

/**
 * IFRS 택사노미 접두어 변형을 자동으로 확장한다.
 *
 * DART 는 2018년 이전 보고서에 `ifrs_` 를, 2019년 이후에 `ifrs-full_` 을 쓴다.
 *   2017  ifrs_ProfitLossAttributableToOwnersOfParent
 *   2023  ifrs-full_ProfitLossAttributableToOwnersOfParent
 *
 * 매핑 테이블마다 두 개씩 나열하면 새 지표를 추가할 때 반드시 한쪽을 빠뜨린다.
 * 실제로 netIncome·eps·equityControlling 이 2015~2018 구간에서 통째로 비었다.
 * 규칙이 기계적이므로 여기서 한 번에 처리한다.
 */
export function expandTaxonomyVariants(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    out.push(tag);
    if (tag.startsWith('ifrs-full_')) {
      out.push(`ifrs_${tag.slice('ifrs-full_'.length)}`);
    } else if (tag.startsWith('ifrs_')) {
      out.push(`ifrs-full_${tag.slice('ifrs_'.length)}`);
    }
  }
  return [...new Set(out)];
}

/**
 * 매핑 규칙에 따라 원본 행들 중 하나를 골라낸다.
 *
 * 1. 태그 후보를 우선순위 순으로 훑어 첫 번째로 값이 있는 것을 채택
 * 2. 전부 실패하면 계정명 정규식 폴백
 * 3. 그래도 없으면 value: null (0 으로 채우지 않는다)
 *
 * 채택된 태그를 반환하므로 호출부가 sourceTag 에 기록할 수 있다.
 * 어느 태그가 쓰였는지 남겨야 "왜 이 숫자가 나왔나"를 나중에 추적할 수 있다.
 */
export function resolveAccount(rule: AccountRule, facts: readonly RawFact[]): ResolveResult {
  const candidates = rule.statements
    ? facts.filter((f) => f.statement === undefined || rule.statements!.includes(f.statement))
    : facts;

  for (const tag of expandTaxonomyVariants(rule.tags)) {
    const hit = candidates.find((f) => f.tag === tag && f.value !== null);
    if (hit) return { value: hit.value, sourceTag: tag, usedNameFallback: false };
  }

  if (rule.namePattern) {
    const hit = candidates.find(
      (f) => f.name !== undefined && rule.namePattern!.test(f.name.trim()) && f.value !== null,
    );
    if (hit) {
      return {
        value: hit.value,
        sourceTag: `name:${hit.name}`,
        usedNameFallback: true,
      };
    }
  }

  return NOT_FOUND;
}

export function resolveMetric(
  map: AccountMap,
  metricId: BaseMetricId,
  facts: readonly RawFact[],
): ResolveResult {
  const rule = map[metricId];
  if (!rule) return NOT_FOUND;
  return resolveAccount(rule, facts);
}

/** 매핑 가능한 지표 전체를 한 번에 해석한다 */
export function resolveAll(
  map: AccountMap,
  facts: readonly RawFact[],
): Partial<Record<BaseMetricId, ResolveResult>> {
  const out: Partial<Record<BaseMetricId, ResolveResult>> = {};
  for (const metricId of Object.keys(map) as BaseMetricId[]) {
    out[metricId] = resolveMetric(map, metricId, facts);
  }
  return out;
}
