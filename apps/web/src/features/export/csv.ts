import type { SeriesResponse } from '../../lib/api.js';

/**
 * 차트 데이터를 CSV 로 뽑는다.
 *
 * 표 모양은 tidy(long) 형식이다 — 한 행이 (기간 × 기업) 하나다.
 * 기업 5개 × 지표 4개를 가로로 펼치면 20열이 되어 눈으로 읽을 수 없고,
 * 엑셀 피벗도 어렵다. 세로로 쌓으면 정렬·필터·피벗이 전부 자연스럽다.
 *
 *   기간,기업,종목코드,시장,영업이익,영업이익률(%)
 *   2016,삼성전자,005930,KOSPI,29240700000000,14.5
 *
 * 값은 서식 없는 순수 숫자다. "29.2조" 로 적으면 엑셀이 문자열로 읽어 계산이 안 된다.
 */

/** 엑셀은 BOM 이 없으면 한글 CSV 를 깨서 연다 */
const BOM = '﻿';

function escapeCell(value: string): string {
  // 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 두 번 쓴다 (RFC 4180)
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toRow(cells: readonly string[]): string {
  return cells.map(escapeCell).join(',');
}

/**
 * 표시용 숫자로 바꾼다.
 * 비율은 소수(0.145)로 저장되어 있으므로 %로 펼친다 — 열 이름에 단위를 적는다.
 * 결측은 빈 칸. 0 으로 채우면 엑셀에서 실제 0 과 구분되지 않는다.
 */
function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (unit === '%') return (value * 100).toFixed(4);
  return String(value);
}

function columnHeader(label: string, unit: string, displayCurrency: string): string {
  if (unit === '%') return `${label}(%)`;
  if (unit === '배') return `${label}(배)`;
  if (unit === '주') return `${label}(주)`;
  if (unit === '통화') {
    const currency =
      displayCurrency === 'KRW' ? '원' : displayCurrency === 'USD' ? '달러' : '보고통화';
    return `${label}(${currency})`;
  }
  return `${label}(${unit})`;
}

export interface CsvOptions {
  /** 파일 상단에 출처·기준을 적을지. 전문가는 숫자의 근거를 따진다 */
  includeMetadata?: boolean;
  now?: Date;
}

export function buildCsv(data: SeriesResponse, options: CsvOptions = {}): string {
  const lines: string[] = [];
  const now = options.now ?? new Date();

  if (options.includeMetadata !== false) {
    const currencyLabel =
      data.displayCurrency === 'native' ? '각 기업의 보고 통화' : data.displayCurrency;

    lines.push(toRow(['재무지표 비교']));
    lines.push(toRow(['생성일', now.toISOString().slice(0, 10)]));
    lines.push(
      toRow(['기간', `${data.periods[0] ?? ''}~${data.periods[data.periods.length - 1] ?? ''}`]),
    );
    lines.push(toRow(['표시 통화', currencyLabel]));

    for (const company of data.companies) {
      const source = data.provenance[company.id];
      lines.push(
        toRow([
          '출처',
          company.nameKo ?? company.id,
          source?.source ?? '',
          source?.consolidation ?? '',
          source?.basis ?? '',
        ]),
      );
    }

    for (const metric of data.series) {
      // 기준(basis)을 함께 적는다. 액면분할 조정 여부에 따라 주당 지표의
      // 값 자체가 달라지므로, 파일만 보고도 어느 기준인지 알아야 한다.
      lines.push(toRow(['계산식', metric.label, metric.formula, metric.basis]));
    }

    lines.push('');
  }

  const header = [
    '기간',
    '기업',
    '종목코드',
    '시장',
    '결산월',
    ...data.series.map((m) => columnHeader(m.label, m.unit, data.displayCurrency)),
  ];
  lines.push(toRow(header));

  for (const [index, period] of data.periods.entries()) {
    for (const company of data.companies) {
      lines.push(
        toRow([
          period,
          company.nameKo ?? company.id,
          company.ticker ?? '',
          company.market,
          `${company.fiscalYearEndMonth}월`,
          ...data.series.map((metric) =>
            formatValue(metric.data[company.id]?.[index] ?? null, metric.unit),
          ),
        ]),
      );
    }
  }

  // 엑셀 호환을 위해 CRLF. LF 만 쓰면 일부 버전에서 한 줄로 붙는다
  return BOM + lines.join('\r\n') + '\r\n';
}

/** 파일명에 쓸 수 없는 문자를 걸러낸다 */
export function buildFileName(data: SeriesResponse, extension: string, now = new Date()): string {
  const names = data.companies
    .map((c) => (c.nameKo ?? c.id).replace(/[\\/:*?"<>|\s]/g, ''))
    .slice(0, 3)
    .join('-');
  const suffix = data.companies.length > 3 ? `-외${data.companies.length - 3}` : '';
  const range = `${data.periods[0] ?? ''}_${data.periods[data.periods.length - 1] ?? ''}`;

  return `재무지표비교_${names}${suffix}_${range}_${now.toISOString().slice(0, 10)}.${extension}`;
}
