import { toPng } from 'html-to-image';
import { useState, type RefObject } from 'react';
import type { SeriesResponse } from '../../lib/api.js';
import { buildCsv, buildFileName } from './csv.js';

interface Props {
  data: SeriesResponse;
  /** PNG 로 담을 영역. 범례·값 표·차트가 다 들어간 컨테이너 */
  captureRef: RefObject<HTMLElement | null>;
}

/**
 * 이미지 생성이 끝나지 않는 경우가 있다 (탭이 백그라운드로 내려가면
 * 렌더링이 멈춰 이미지 로딩 대기가 진행되지 않는다).
 * 그대로 두면 버튼이 "만드는 중…" 에 영원히 갇힌다.
 */
const PNG_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('IMAGE_TIMEOUT')), ms),
    ),
  ]);
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 즉시 해제하면 일부 브라우저에서 다운로드가 취소된다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportButtons({ data, captureRef }: Props): React.ReactElement {
  const [busy, setBusy] = useState<'png' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportCsv = (): void => {
    setError(null);
    const csv = buildCsv(data);
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), buildFileName(data, 'csv'));
  };

  const exportPng = async (): Promise<void> => {
    const node = captureRef.current;
    if (node === null) return;

    setBusy('png');
    setError(null);
    try {
      const dataUrl = await withTimeout(
        toPng(node, {
          // 투명 배경으로 저장하면 어두운 곳에 붙였을 때 글씨가 안 보인다
          backgroundColor: '#ffffff',
          // 화면 그대로면 흐릿하다. 인쇄하거나 확대해도 읽히게 2배로 뜬다
          pixelRatio: 2,
          // 스티키 패널이 겹쳐 찍히지 않게 여백을 준다
          style: { padding: '16px' },
        }),
        PNG_TIMEOUT_MS,
      );

      const blob = await (await fetch(dataUrl)).blob();
      download(blob, buildFileName(data, 'png'));
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'IMAGE_TIMEOUT'
          ? '이미지를 만드는 데 너무 오래 걸립니다. 창을 앞으로 두고 다시 눌러보세요. CSV 저장은 바로 됩니다.'
          : '이미지로 저장하지 못했습니다. CSV 로 내려받아 보세요.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={exportCsv}
        className="compact rounded-lg border-2 border-[var(--line)] bg-white px-3.5 py-1.5
                   font-medium hover:border-[#0072B2]"
      >
        CSV 저장
      </button>
      <button
        type="button"
        onClick={() => void exportPng()}
        disabled={busy === 'png'}
        className="compact rounded-lg border-2 border-[var(--line)] bg-white px-3.5 py-1.5
                   font-medium hover:border-[#0072B2] disabled:opacity-50"
      >
        {busy === 'png' ? '이미지 만드는 중…' : '이미지 저장'}
      </button>

      <span className="text-sm text-[var(--ink-muted)]">
        CSV 는 엑셀에서 바로 열립니다. 출처와 계산식이 함께 담깁니다.
      </span>

      {error !== null && (
        <span role="alert" className="text-sm text-[#c4551a]">
          {error}
        </span>
      )}
    </div>
  );
}
