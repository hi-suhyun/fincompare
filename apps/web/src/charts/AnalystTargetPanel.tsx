import type { CompanyConsensus, SeriesCompany } from '../lib/api.js';
import { formatByUnit } from '../lib/format.js';
import type { Projection } from './projection.js';

interface Props {
  /** 마우스가 올라간 가닥 */
  projection: Projection;
  /** 그 기업의 컨센서스 전체. 집계 안에서 어디쯤인지 보여주는 데 쓴다 */
  consensus: CompanyConsensus | undefined;
  company: SeriesCompany | undefined;
  onClose: () => void;
}

/**
 * 가닥 하나에 올렸을 때 뜨는 쪽지.
 *
 * 어느 증권사가 얼마를 냈는지가 먼저다. 그 값이 집계 안에서 어디쯤인지도
 * 같이 보여야 "높은 쪽인가 낮은 쪽인가" 를 판단할 수 있다.
 */
export function AnalystTargetPanel({
  projection,
  consensus,
  company,
  onClose,
}: Props): React.ReactElement {
  const target = consensus?.priceTarget;
  const currency = target?.currency === 'USD' ? 'USD' : 'KRW';
  const money = (value: number | null): string => formatByUnit(value, '통화', currency);

  const moved =
    projection.previous === undefined
      ? null
      : projection.target > projection.previous
        ? '상향'
        : '하향';

  return (
    <div
      // 쪽지 위로 넘어와도 닫히지 않아야 읽을 수 있다
      onMouseLeave={onClose}
      className="absolute right-3 top-3 z-20 w-64 rounded-xl border border-[var(--line)]
                 bg-white/60 px-3.5 py-3 shadow-lg backdrop-blur-lg"
      role="dialog"
      aria-label={`${projection.firm} 목표주가`}
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: company?.color ?? '#666' }}
        />
        <strong className="font-semibold">
          {projection.aggregate ? `증권가 ${projection.firm}` : projection.firm}
        </strong>
        {projection.date !== undefined && (
          <span className="ml-auto text-[13px] text-[var(--ink-muted)]">{projection.date}</span>
        )}
      </div>

      <p className="tabular mt-1 text-xl font-bold">{money(projection.target)}</p>

      {moved !== null && (
        <p className="text-sm" style={{ color: moved === '상향' ? '#0072B2' : '#D55E00' }}>
          {moved === '상향' ? '▲' : '▼'} 직전 {money(projection.previous ?? null)}에서 {moved}
        </p>
      )}

      {target !== null && target !== undefined && (
        <dl className="mt-2 flex gap-3 border-t border-[var(--line)] pt-2 text-sm">
          <div>
            <dt className="text-[var(--ink-muted)]">최저</dt>
            <dd className="tabular">{money(target.low)}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">평균</dt>
            <dd className="tabular font-medium">{money(target.avg)}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">최고</dt>
            <dd className="tabular">{money(target.high)}</dd>
          </div>
        </dl>
      )}

      <p className="mt-2 text-[13px] text-[var(--ink-muted)]">
        {projection.aggregate
          ? `증권사별 목표가는 ${consensus?.source ?? '제공처'} 무료 구간에서 주지 않아 집계값만 표시합니다.`
          : '직접 조사해 적어 둔 기록입니다. 전체 집계가 아니라 찾은 것만이라 평균과 개수가 맞지 않을 수 있습니다.'}
        {consensus?.asOf !== undefined && ` 조사일 ${consensus.asOf}.`}
      </p>
    </div>
  );
}
