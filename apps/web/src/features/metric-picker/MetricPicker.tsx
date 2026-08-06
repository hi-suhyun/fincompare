import { MAX_METRICS, METRIC_FORMULA, METRIC_META, type MetricId } from '@fincompare/shared';

interface Props {
  selected: readonly MetricId[];
  onChange: (metrics: MetricId[]) => void;
}

/**
 * 지표를 감추지 않는다.
 *
 * 실사용자는 30년 경력 투자자다. ROE·PER 을 "더보기" 안에 넣으면 실례이고 쓸모도 없다.
 * 카테고리로 정리해서 전부 평면에 보여주고, 기본 선택만 영업이익 쪽으로 둔다.
 * (docs/03-user-context.md 2.1)
 */
const GROUPS: ReadonlyArray<{ title: string; metrics: readonly MetricId[] }> = [
  {
    title: '절대값',
    metrics: ['revenue', 'operatingIncome', 'netIncome', 'totalAssets', 'totalLiabilities'],
  },
  { title: '비율', metrics: ['operatingMargin', 'netMargin', 'roe', 'debtRatio'] },
  { title: '밸류에이션', metrics: ['per', 'pbr', 'eps', 'bps'] },
];

/** 주가가 없으면 계산할 수 없는 지표. Phase 5 까지는 빈 차트가 된다 */
const NEEDS_PRICE: ReadonlySet<MetricId> = new Set(['per', 'pbr', 'marketCap']);

export function MetricPicker({ selected, onChange }: Props): React.ReactElement {
  const isFull = selected.length >= MAX_METRICS;

  const toggle = (metric: MetricId): void => {
    if (selected.includes(metric)) {
      // 마지막 하나까지 끄면 빈 화면이 된다
      if (selected.length === 1) return;
      onChange(selected.filter((m) => m !== metric));
    } else {
      if (isFull) return;
      onChange([...selected, metric]);
    }
  };

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1.5 font-semibold">
        지표{' '}
        <span className="font-normal text-[var(--ink-muted)]">
          ({selected.length}/{MAX_METRICS})
        </span>
      </legend>

      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-[var(--ink-muted)]">{group.title}</span>
          {group.metrics.map((metric) => {
            const active = selected.includes(metric);
            const disabled = !active && isFull;
            const needsPrice = NEEDS_PRICE.has(metric);

            return (
              <button
                key={metric}
                type="button"
                onClick={() => toggle(metric)}
                disabled={disabled}
                aria-pressed={active}
                // 툴팁은 개념 설명이 아니라 계산 근거다
                title={`${METRIC_META[metric].label} = ${METRIC_FORMULA[metric]}${
                  needsPrice ? '\n주가 연동 전이라 아직 값이 나오지 않습니다' : ''
                }`}
                className={`compact rounded-full border-2 px-3.5 py-1.5 font-medium transition-colors
                  disabled:cursor-not-allowed disabled:opacity-40
                  ${
                    active
                      ? 'border-[#0072B2] bg-[#0072B2] text-white'
                      : 'border-[var(--line)] bg-white hover:border-[#0072B2]'
                  }`}
              >
                {METRIC_META[metric].label}
                {needsPrice && (
                  <span
                    aria-label="주가 데이터 필요"
                    className={`ml-1.5 text-sm ${active ? 'text-white/80' : 'text-[var(--ink-muted)]'}`}
                  >
                    ⏳
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <p className="text-sm text-[var(--ink-muted)]">
        ⏳ 표시된 지표는 주가 연동(Phase 5) 후에 값이 나옵니다.
      </p>
    </fieldset>
  );
}
