interface Preset {
  label: string;
  hint: string;
  companyIds: string[];
}

/**
 * 첫 화면에 빈 검색창만 두지 않는다.
 *
 * 뭘 쳐야 할지 정해두지 않았을 때 바로 누를 수 있는 출발점이 있어야 한다.
 * 검색이 안 되는 게 아니라, 시작이 막히는 게 문제다.
 */
const PRESETS: readonly Preset[] = [
  {
    label: '반도체',
    hint: '삼성전자 · SK하이닉스',
    companyIds: ['KR:005930', 'KR:000660'],
  },
  {
    label: '자동차',
    hint: '현대자동차 · 기아',
    companyIds: ['KR:005380', 'KR:000270'],
  },
  {
    label: '인터넷',
    hint: 'NAVER · 카카오',
    companyIds: ['KR:035420', 'KR:035720'],
  },
  {
    label: '2차전지',
    hint: 'LG에너지솔루션 · 삼성SDI · 에코프로비엠',
    companyIds: ['KR:373220', 'KR:006400', 'KR:247540'],
  },
];

interface Props {
  onSelect: (companyIds: string[]) => void;
}

export function Presets({ onSelect }: Props): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[var(--ink-muted)]">
        비교할 기업을 검색해서 고르거나, 아래에서 바로 시작할 수 있습니다.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((preset) => (
          <li key={preset.label}>
            <button
              type="button"
              onClick={() => onSelect(preset.companyIds)}
              className="flex w-full flex-col items-start gap-0.5 rounded-xl border-2 border-[var(--line)]
                         bg-white px-4 py-3 text-left hover:border-[#0072B2]"
            >
              <span className="font-semibold">{preset.label}</span>
              <span className="text-sm text-[var(--ink-muted)]">{preset.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
