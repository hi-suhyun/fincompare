import { coverageNote, earliestYearFor, type Country } from '@fincompare/shared';

interface Props {
  fromYear: number;
  toYear: number;
  normalize: boolean;
  overlay: boolean;
  /** 선택된 기업들의 국가. "전체" 가 어디까지 갈 수 있는지를 이걸로 정한다 */
  countries: readonly Country[];
  onChange: (patch: {
    fromYear?: number;
    toYear?: number;
    normalize?: boolean;
    overlay?: boolean;
  }) => void;
}

const CURRENT_YEAR = new Date().getFullYear();

const PRESETS: ReadonlyArray<{ label: string; years: number | null }> = [
  { label: '최근 3년', years: 3 },
  { label: '최근 5년', years: 5 },
  { label: '최근 10년', years: 10 },
  { label: '전체', years: null },
];

export function PeriodPicker({
  fromYear,
  toYear,
  normalize,
  overlay,
  countries,
  onChange,
}: Props): React.ReactElement {
  /*
   * 올해까지 고를 수 있다.
   *
   * 올해 사업보고서는 아직 안 나왔지만, 서버가 최근 12개월(TTM)로 채운다 —
   * 분기 실적은 이미 공시돼 있어서 "2026년이 통째로 안 보이는" 문제가 없다.
   * 확정 연간이 아니라는 것은 차트 아래 안내로 밝힌다.
   */
  const latest = CURRENT_YEAR;

  /**
   * 하한은 소스마다 다르다 (DART 2015, SEC 2009).
   * 전 소스 공통으로 2015 를 쓰면 미국 기업을 봐도 10년밖에 안 나온다.
   */
  const earliest = earliestYearFor(countries);

  const years: number[] = [];
  for (let y = earliest; y <= latest; y++) years.push(y);

  const applyPreset = (span: number | null): void => {
    if (span === null) {
      onChange({ fromYear: earliest, toYear: latest });
      return;
    }
    onChange({ fromYear: Math.max(earliest, latest - span + 1), toYear: latest });
  };

  const activePreset = PRESETS.find((p) =>
    p.years === null
      ? fromYear === earliest && toYear === latest
      : fromYear === Math.max(earliest, latest - p.years + 1) && toYear === latest,
  );

  const note = coverageNote(countries);

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

      {note !== null && <p className="text-sm text-[var(--ink-muted)]">{note}</p>}

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

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={overlay}
          onChange={(e) => onChange({ overlay: e.target.checked })}
          className="mt-1 h-5 w-5 shrink-0 accent-[#0072B2]"
        />
        <span>
          <span className="font-medium">한 차트에 겹쳐 보기</span>
          <span className="block text-sm text-[var(--ink-muted)]">
            지표가 위아래로 나뉘어 있으면 흐름을 맞춰 보기 어렵습니다. 겹치면 한눈에 읽힙니다.
            {overlay ? (
              ' 색은 기업, 선 모양은 지표를 뜻합니다.'
            ) : (
              <>
                {' '}
                켜면 <strong className="font-medium">성장률 비교</strong>가 함께 켜집니다 — 단위가
                다른 값을 그대로 겹치면 없는 상관관계가 보이기 때문입니다.
              </>
            )}
          </span>
        </span>
      </label>
    </div>
  );
}
