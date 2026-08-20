interface Props {
  value: 'FY' | 'Q';
  onChange: (value: 'FY' | 'Q') => void;
  /** 분기 모드에서 꺼지는 기능이 있는지 알린다 */
  consensusOn: boolean;
}

const OPTIONS: ReadonlyArray<{ value: 'FY' | 'Q'; label: string; hint: string }> = [
  { value: 'FY', label: '연간', hint: '사업연도별. 장기 추이를 볼 때' },
  { value: 'Q', label: '분기', hint: '분기별. 최근 흐름과 계절성을 볼 때' },
];

/**
 * 연간 / 분기 축 전환.
 *
 * 연간만 보면 진행 중인 해가 한 점(TTM)으로 뭉개져서, 분기마다 가속하는지
 * 꺾이는지가 안 보인다. 반도체처럼 사이클을 타는 업종에서는 그게 핵심이다.
 */
export function PeriodTypeToggle({ value, onChange, consensusOn }: Props): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-semibold">보기 단위</span>

      <div className="flex gap-2">
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              title={option.hint}
              className={`rounded-lg border-2 px-4 py-2 font-medium transition-colors ${
                active
                  ? 'border-[#0072B2] bg-[#0072B2] text-white'
                  : 'border-[var(--line)] hover:border-[#0072B2]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {value === 'Q' && (
        <p className="max-w-xs text-sm text-[var(--ink-muted)]">
          처음 보는 기업은 분기 공시를 받아오느라 조금 걸립니다. 한 번 받으면 그 뒤로는
          바로 나옵니다.
          {consensusOn &&
            ' 매출액·EPS 추정 밴드는 연간 단위라 분기에서는 빠집니다. 목표주가 가닥은 그대로 보입니다.'}
        </p>
      )}
    </div>
  );
}
