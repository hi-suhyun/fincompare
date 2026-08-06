import type { DisplayCurrency } from '../hooks/useUrlState.js';

interface Props {
  value: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  /** 국내·해외가 섞여 있는지. 한쪽만이면 환산이 의미 없다 */
  isMixed: boolean;
  /** 정규화 모드에서는 환산하지 않는다 */
  disabled: boolean;
}

const OPTIONS: ReadonlyArray<{ value: DisplayCurrency; label: string; hint: string }> = [
  { value: 'native', label: '원래 통화', hint: '국내는 원, 해외는 달러 그대로' },
  { value: 'KRW', label: '원화', hint: '해외 기업을 원으로 환산' },
  { value: 'USD', label: '달러', hint: '국내 기업을 달러로 환산' },
];

/**
 * 통화 환산 토글.
 *
 * 국내·해외를 섞어 보지 않으면 아무 의미가 없으므로 그때만 노출한다.
 * 화면에 쓸 일 없는 컨트롤이 늘 떠 있으면 읽을 것만 많아진다.
 */
export function CurrencyToggle({ value, onChange, isMixed, disabled }: Props): React.ReactElement | null {
  if (!isMixed) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-semibold">표시 통화</span>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={disabled}
            aria-pressed={value === option.value}
            title={option.hint}
            className={`compact rounded-full border-2 px-3.5 py-1.5 font-medium
              disabled:cursor-not-allowed disabled:opacity-40
              ${
                value === option.value
                  ? 'border-[#0072B2] bg-[#0072B2] text-white'
                  : 'border-[var(--line)] bg-white hover:border-[#0072B2]'
              }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {disabled ? (
        <p className="text-sm text-[var(--ink-muted)]">
          성장률 비교에서는 환산하지 않습니다. 환율 변동이 섞이면 기업 성과가 아니라 환율을 보게 됩니다.
        </p>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">
          손익은 해당 회계기간 평균 환율, 자산·부채는 기말 환율로 환산합니다 (ECB 기준).
        </p>
      )}
    </div>
  );
}
