interface Props {
  fromYear: number;
  toYear: number;
  normalize: boolean;
  onChange: (patch: { fromYear?: number; toYear?: number; normalize?: boolean }) => void;
}

const CURRENT_YEAR = new Date().getFullYear();
const EARLIEST_YEAR = 2015; // DART 제공 시작

const PRESETS: ReadonlyArray<{ label: string; years: number | null }> = [
  { label: '최근 3년', years: 3 },
  { label: '최근 5년', years: 5 },
  { label: '최근 10년', years: 10 },
  { label: '전체', years: null },
];

export function PeriodPicker({ fromYear, toYear, normalize, onChange }: Props): React.ReactElement {
  const latest = CURRENT_YEAR - 1; // 올해 사업보고서는 아직 안 나왔다
  const years: number[] = [];
  for (let y = EARLIEST_YEAR; y <= latest; y++) years.push(y);

  const applyPreset = (span: number | null): void => {
    if (span === null) {
      onChange({ fromYear: EARLIEST_YEAR, toYear: latest });
      return;
    }
    onChange({ fromYear: Math.max(EARLIEST_YEAR, latest - span + 1), toYear: latest });
  };

  const activePreset = PRESETS.find((p) =>
    p.years === null
      ? fromYear === EARLIEST_YEAR && toYear === latest
      : fromYear === Math.max(EARLIEST_YEAR, latest - p.years + 1) && toYear === latest,
  );

  return (
    <div className="flex flex-col gap-3">
      <span className="font-semibold">기간</span>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.years)}
            aria-pressed={activePreset?.label === preset.label}
            className={`compact rounded-full border-2 px-3.5 py-1.5 font-medium
              ${
                activePreset?.label === preset.label
                  ? 'border-[#0072B2] bg-[#0072B2] text-white'
                  : 'border-[var(--line)] bg-white hover:border-[#0072B2]'
              }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-sm text-[var(--ink-muted)]">시작</span>
          <select
            value={fromYear}
            onChange={(e) => onChange({ fromYear: Math.min(Number(e.target.value), toYear) })}
            className="tabular rounded-lg border-2 border-[var(--line)] bg-white px-3 py-2"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>

        <span aria-hidden className="text-[var(--ink-muted)]">
          ~
        </span>

        <label className="flex items-center gap-2">
          <span className="text-sm text-[var(--ink-muted)]">종료</span>
          <select
            value={toYear}
            onChange={(e) => onChange({ toYear: Math.max(Number(e.target.value), fromYear) })}
            className="tabular rounded-lg border-2 border-[var(--line)] bg-white px-3 py-2"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={normalize}
          onChange={(e) => onChange({ normalize: e.target.checked })}
          className="mt-1 h-5 w-5 shrink-0 accent-[#0072B2]"
        />
        <span>
          <span className="font-medium">성장률로 비교</span>
          <span className="block text-sm text-[var(--ink-muted)]">
            시작 시점을 100으로 맞춥니다. 규모가 다른 기업을 나란히 볼 때 씁니다.
          </span>
        </span>
      </label>
    </div>
  );
}
