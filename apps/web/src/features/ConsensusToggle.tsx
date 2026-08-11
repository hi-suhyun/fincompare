interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  /** 미국 기업이 하나라도 선택되어 있는지 */
  hasUsCompanies: boolean;
  /** 국내 기업이 하나라도 선택되어 있는지 */
  hasKrCompanies: boolean;
  /** 이 인스턴스에 목표주가 키가 꽂혀 있는지 (서버가 알려준다) */
  enabled: boolean;
  /** 추정치가 있는 지표(EPS·매출액)를 보고 있는지 */
  hasEstimatedMetric: boolean;
}

/**
 * 목표주가 밴드 토글.
 *
 * 켤 수 없는 경우가 여러 가지라, 왜 못 켜는지를 각각 다르게 말한다.
 * 회색으로 비활성만 시켜 두면 사용자는 이유를 알 수 없다.
 */
export function ConsensusToggle({
  value,
  onChange,
  hasUsCompanies,
  hasKrCompanies,
  enabled,
  hasEstimatedMetric,
}: Props): React.ReactElement | null {
  // 미국 기업도 없고 국내만 골랐으면 국내 안내만 보여준다
  if (!hasUsCompanies && !hasKrCompanies) return null;

  const disabled = !enabled || !hasUsCompanies || !hasEstimatedMetric;

  const reason = ((): string | null => {
    if (!enabled) {
      return '이 화면에서는 컨센서스를 제공하지 않습니다. 직접 설치해 본인 API 키를 넣으면 켜집니다.';
    }
    if (!hasUsCompanies) return null; // 국내 안내가 따로 나간다
    if (!hasEstimatedMetric) return '「매출액」이나 「EPS」를 선택하면 밴드를 얹을 수 있습니다.';
    return null;
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex max-w-xs items-start gap-2.5">
        <input
          type="checkbox"
          checked={value && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-[#0072B2] disabled:opacity-40"
        />
        <span>
          <span className={`font-medium ${disabled ? 'text-[var(--ink-muted)]' : ''}`}>
            애널리스트 컨센서스
          </span>
          <span className="mt-0.5 block text-sm text-[var(--ink-muted)]">
            연도별 추정치 범위(최고·평균·최저)를 매출액·EPS 위에 겹쳐 봅니다. 그때의 추정이
            실제와 얼마나 맞았는지 한눈에 보입니다. 현재 목표주가도 함께 표시합니다.
          </span>
        </span>
      </label>

      {reason !== null && (
        <p className="max-w-xs pl-7 text-sm text-[var(--ink-muted)]">{reason}</p>
      )}

      {hasKrCompanies && (
        <p className="max-w-xs pl-7 text-sm text-[var(--ink-muted)]">
          국내 기업은 컨센서스를 제공하지 않습니다 — 증권사 리포트는 저작물이라 가져와
          보관하지 않습니다. 아래 링크에서 원문을 보실 수 있습니다.
        </p>
      )}
    </div>
  );
}
