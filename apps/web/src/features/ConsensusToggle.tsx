interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  /** 미국 기업이 하나라도 선택되어 있는지 */
  hasUsCompanies: boolean;
  /** 국내 기업이 하나라도 선택되어 있는지 */
  hasKrCompanies: boolean;
  /** 이 인스턴스에 목표주가 키가 꽂혀 있는지 (서버가 알려준다) */
  enabled: boolean;
  /** 주가 지표를 보고 있는지. 밴드는 주가 차트에만 얹힌다 */
  hasPriceMetric: boolean;
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
  hasPriceMetric,
}: Props): React.ReactElement | null {
  // 미국 기업도 없고 국내만 골랐으면 국내 안내만 보여준다
  if (!hasUsCompanies && !hasKrCompanies) return null;

  const disabled = !enabled || !hasUsCompanies || !hasPriceMetric;

  const reason = ((): string | null => {
    if (!enabled) {
      return '이 화면에서는 목표주가를 제공하지 않습니다. 직접 설치해 본인 API 키를 넣으면 켜집니다.';
    }
    if (!hasUsCompanies) return null; // 국내 안내가 따로 나간다
    if (!hasPriceMetric) return '「주가」 지표를 선택하면 밴드를 얹을 수 있습니다.';
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
            애널리스트 목표주가
          </span>
          <span className="mt-0.5 block text-sm text-[var(--ink-muted)]">
            그 해 나온 목표주가의 범위(최고·평균·최저)를 주가 위에 겹쳐 봅니다. 당시의 의견이
            실제 주가와 얼마나 맞았는지 확인할 수 있습니다.
          </span>
        </span>
      </label>

      {reason !== null && (
        <p className="max-w-xs pl-7 text-sm text-[var(--ink-muted)]">{reason}</p>
      )}

      {hasKrCompanies && (
        <p className="max-w-xs pl-7 text-sm text-[var(--ink-muted)]">
          국내 기업은 목표주가를 제공하지 않습니다 — 증권사 리포트의 컨센서스는 저작물이라
          가져와 보관하지 않습니다. 아래 링크에서 원문을 보실 수 있습니다.
        </p>
      )}
    </div>
  );
}
