/**
 * 한글 검색 보조.
 *
 * 할아버지가 "삼성전자"를 찾을 때 쓰는 방법이 여러 가지다:
 *   삼성전자 / 삼성 / ㅅㅅㅈㅈ / 005930 / samsung
 * 전부 같은 결과가 나와야 한다.
 */

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const HANGUL_START = 0xac00; // '가'
const HANGUL_END = 0xd7a3; // '힣'
/** 한 초성이 담당하는 음절 수 = 중성 21 × 종성 28 */
const SYLLABLES_PER_CHOSUNG = 588;

/** 초성 자모만으로 이루어진 검색어인지 (ㅅㅅㅈㅈ) */
const CHOSUNG_ONLY = /^[ㄱ-ㅎ]+$/;

export function isChosungQuery(query: string): boolean {
  const trimmed = query.replace(/\s+/g, '');
  return trimmed.length > 0 && CHOSUNG_ONLY.test(trimmed);
}

/**
 * 문자열에서 초성을 뽑는다.
 * 한글 음절이 아닌 글자(영문·숫자)는 그대로 남긴다 — 'SK하이닉스' -> 'SKㅎㄴㄷㅅ'
 */
export function toChosung(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    if (code >= HANGUL_START && code <= HANGUL_END) {
      const index = Math.floor((code - HANGUL_START) / SYLLABLES_PER_CHOSUNG);
      out += CHOSUNG[index] ?? char;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * 검색 정규화.
 *
 * 법인격 표기를 떼는 게 핵심이다. DART 의 corp_name 은 '삼성전자(주)' 인데
 * 사용자는 '삼성전자'로 친다. 이걸 안 떼면 전방 일치가 걸려도 정확 일치가 안 된다.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|㈜/g, '')
    .replace(/\b(co|ltd|inc|corp|corporation|company|limited)\b\.?/g, '')
    .replace(/[.,&'’\-_/]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export type MatchKind = 'EXACT' | 'PREFIX' | 'CONTAINS' | 'CHOSUNG' | 'NONE';

/** 순위가 낮을수록 위에 온다 */
export const MATCH_RANK: Record<MatchKind, number> = {
  EXACT: 0,
  PREFIX: 1,
  CHOSUNG: 2,
  CONTAINS: 3,
  NONE: 99,
};

/**
 * 검색어와 후보의 매칭 방식을 판정한다.
 *
 * 초성 검색은 전방 일치만 인정한다. 'ㅅㅈ' 가 아무 데나 걸리면
 * 결과가 수백 개로 불어나 오히려 못 찾는다.
 */
export function matchKind(query: string, candidate: string): MatchKind {
  const q = normalizeForSearch(query);
  const c = normalizeForSearch(candidate);

  if (q === '') return 'NONE';

  if (isChosungQuery(q)) {
    const candidateChosung = toChosung(c);
    return candidateChosung.startsWith(q) ? 'CHOSUNG' : 'NONE';
  }

  if (c === q) return 'EXACT';
  if (c.startsWith(q)) return 'PREFIX';
  if (c.includes(q)) return 'CONTAINS';
  return 'NONE';
}
