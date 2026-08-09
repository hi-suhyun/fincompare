import { useState } from 'react';
import { ApiError, clearStoredPassword, searchCompanies, storePassword } from '../lib/api.js';

interface Props {
  onUnlocked: () => void;
}

/**
 * 가족 전용 접근 화면.
 *
 * 데이터 자체는 공개 소스(DART·SEC·KRX)라 비밀이 아니다. 막는 이유는
 * DART 일일 호출 한도가 공유 자원이기 때문이다 — URL 이 알려지면
 * 모르는 사람이 한도를 태워 할아버지가 조회를 못 하시게 된다.
 *
 * 한 번 통과하면 쿠키가 남으므로 북마크로 들어오시는 분은 처음 한 번만 겪는다.
 */
export function AccessGate({ onUnlocked }: Props): React.ReactElement {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.trim() === '') return;

    setChecking(true);
    setFailed(false);
    storePassword(password.trim());

    try {
      // health 는 게이트 밖이라 통과 여부를 알 수 없다. 막힌 경로를 실제로 찔러 본다.
      // 성공하면 서버가 쿠키를 구워 주므로 다음부터는 헤더 없이도 들어간다.
      await searchCompanies('삼성전자', 1);
      onUnlocked();
    } catch (err) {
      if (err instanceof ApiError && err.needsPassword) clearStoredPassword();
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-16">
      <header>
        <h1 className="text-2xl font-bold">재무지표 비교</h1>
        <p className="mt-1 text-[var(--ink-muted)]">가족 전용입니다. 비밀번호를 입력해 주세요.</p>
      </header>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="rounded-lg border-2 border-[var(--line)] bg-white px-4 py-3 text-lg"
          />
        </label>

        {failed && (
          <p role="alert" className="text-[#c4551a]">
            비밀번호가 맞지 않습니다.
          </p>
        )}

        <button
          type="submit"
          disabled={checking || password.trim() === ''}
          className="rounded-lg bg-[#0072B2] px-4 py-3 text-lg font-medium text-white
                     disabled:opacity-50"
        >
          {checking ? '확인 중…' : '들어가기'}
        </button>
      </form>

      <p className="text-sm text-[var(--ink-muted)]">
        한 번 입력하면 이 브라우저는 기억합니다. 다음부터는 바로 들어옵니다.
      </p>
    </div>
  );
}
