import { MAX_METRICS, METRIC_FORMULA, METRIC_META, type MetricId } from '@fincompare/shared';

interface Props {
  selected: readonly MetricId[];
  onChange: (metrics: MetricId[]) => void;
  /** 미국 기업이 선택되어 있는지. 밸류에이션 안내를 그때만 띄운다 */
  hasUsCompanies: boolean;
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
  { title: '밸류에이션', metrics: ['closePrice', 'per', 'pbr', 'eps', 'bps'] },
];

/**
 * 주가가 있어야 계산되는 지표.
 *
 * 국내는 KRX 공식 데이터로 다 나온다. 미국은 무료 주가 API 가 전부
 * 재배포·표시를 금지해서 주가 연동을 하지 않는다 (docs/00-data-sources.md 3.4).
 * 그래서 "쓸 수 없는 지표"가 아니라 "미국 기업만 비는 지표"다.
 */
const NEEDS_PRICE: ReadonlySet<MetricId> = new Set(['closePrice', 'per', 'pbr', 'marketCap']);

export function MetricPicker({ selected, onChange, hasUsCompanies }: Props): React.ReactElement {
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
            // 미국 기업을 안 골랐으면 전부 정상 계산되므로 표시하지 않는다
            const partial = hasUsCompanies && NEEDS_PRICE.has(metric);

            return (
              <button
                key={metric}
                type="button"
                onClick={() => toggle(metric)}
                disabled={disabled}
                aria-pressed={active}
                // 툴팁은 개념 설명이 아니라 계산 근거다
                title={`${METRIC_META[metric].label} = ${METRIC_FORMULA[metric]}${
                  partial ? '\n미국 기업은 주가 연동을 하지 않아 값이 비어 있습니다' : ''
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
                {partial && (
                  <span
                    aria-label="미국 기업은 값이 비어 있음"
                    className={`ml-1.5 text-sm ${active ? 'text-white/80' : 'text-[var(--ink-muted)]'}`}
                  >
                    ◐
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {hasUsCompanies && (
        <p className="text-sm text-[var(--ink-muted)]">
          ◐ 표시된 지표는 <strong className="font-medium">국내 기업만</strong> 값이 나옵니다.
          미국 기업은 주가 데이터를 쓰지 않습니다 — 무료 주가 API 가 데이터를 다른 사람에게
          보여주는 것을 약관으로 금지하기 때문입니다. 재무지표는 미국도 정상 제공됩니다.
        </p>
      )}
    </fieldset>
  );
}
