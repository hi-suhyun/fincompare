import type { CompanyConsensus, SeriesCompany } from '../lib/api.js';
import { formatByUnit } from '../lib/format.js';

interface Props {
  consensus: CompanyConsensus;
  company: SeriesCompany | undefined;
  onClose: () => void;
}

/**
 * 증권사별 목표주가 표.
 *
 * 평균 하나만 보면 "그 근처를 보는 곳이 많다" 로 읽힌다. 실제로는 양 끝만
 * 있고 가운데가 빈 경우가 흔해서(SK하이닉스 148만 vs 470만), 평균이 실제로는
 * 아무도 제시하지 않은 값일 수 있다. 그래서 개별값을 펴 보여준다.
 *
 * 목록은 **전체 집계가 아니다** — 직접 조사해 찾은 것만이다. 그렇게 밝히지
 * 않으면 평균과 개수가 안 맞는 것이 오류로 보인다.
 */
export function AnalystTargetPanel({ consensus, company, onClose }: Props): React.ReactElement {
  const target = consensus.priceTarget;
  const analysts = [...(target?.analysts ?? [])].sort((a, b) => b.target - a.target);
  const currency = target?.currency === 'USD' ? 'USD' : 'KRW';
  const money = (value: number | null): string => formatByUnit(value, '통화', currency);

  return (
    <div
      // 마우스가 표 위로 넘어와도 닫히지 않아야 스크롤하며 읽을 수 있다
      onMouseLeave={onClose}
      className="absolute right-3 top-3 z-20 max-h-[85%] w-72 overflow-y-auto rounded-xl
                 border border-[var(--line)] bg-white/98 px-3.5 py-3 shadow-lg backdrop-blur"
      role="dialog"
      aria-label={`${company?.nameKo ?? consensus.companyId} 증권사별 목표주가`}
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: company?.color ?? '#666' }}
        />
        <strong className="font-semibold">{company?.nameKo ?? consensus.companyId}</strong>
        <span className="ml-auto text-sm text-[var(--ink-muted)]">목표주가</span>
      </div>

      <dl className="mt-2 flex gap-3 border-b border-[var(--line)] pb-2 text-sm">
        <div>
          <dt className="text-[var(--ink-muted)]">최저</dt>
          <dd className="tabular font-medium">{money(target?.low ?? null)}</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-muted)]">평균</dt>
          <dd className="tabular font-semibold">{money(target?.avg ?? null)}</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-muted)]">최고</dt>
          <dd className="tabular font-medium">{money(target?.high ?? null)}</dd>
        </div>
      </dl>

      {analysts.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          증권사별 목표가는 기록해 두지 않았습니다. 조사 파일의{' '}
          <code className="text-[13px]">analysts</code> 에 적으면 여기에 펼쳐집니다.
        </p>
      ) : (
        <>
          <table className="mt-2 w-full border-collapse text-sm">
            <tbody>
              {analysts.map((a) => {
                const moved =
                  a.previous === undefined ? null : a.target > a.previous ? '상향' : '하향';
                return (
                  <tr key={`${a.firm}-${a.target}`} className="align-baseline">
                    <th scope="row" className="py-0.5 pr-2 text-left font-normal">
                      {a.firm}
                      {a.date !== undefined && (
                        <span className="ml-1 text-[13px] text-[var(--ink-muted)]">{a.date}</span>
                      )}
                    </th>
                    <td className="tabular whitespace-nowrap py-0.5 text-right font-medium">
                      {money(a.target)}
                      {moved !== null && (
                        <span
                          className="ml-1 text-[13px] font-normal"
                          // 상향은 파랑, 하향은 주황 — 빨강·초록은 색각 이상에서 겹친다
                          style={{ color: moved === '상향' ? '#0072B2' : '#D55E00' }}
                        >
                          {moved === '상향' ? '▲' : '▼'}
                          {money(a.previous ?? null)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-2 border-t border-[var(--line)] pt-2 text-[13px] text-[var(--ink-muted)]">
            직접 조사해 찾은 {analysts.length}곳입니다. 전체 집계가 아니라서 위 평균과 개수가
            맞지 않을 수 있습니다.
            {consensus.asOf !== undefined && ` 조사일 ${consensus.asOf}.`}
          </p>
        </>
      )}
    </div>
  );
}
