import type { BaseMetricId } from '../schema/financial.js';
import type { AccountMap, AccountRule, RawFact, ResolveResult } from './types.js';

const NOT_FOUND: ResolveResult = { value: null, sourceTag: null, usedNameFallback: false };

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

  for (const tag of rule.tags) {
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
