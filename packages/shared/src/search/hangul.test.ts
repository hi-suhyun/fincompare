import { describe, expect, it } from 'vitest';
import { isChosungQuery, matchKind, normalizeForSearch, toChosung } from './hangul.js';

describe('toChosung', () => {
  it('한글 음절에서 초성을 뽑는다', () => {
    expect(toChosung('삼성전자')).toBe('ㅅㅅㅈㅈ');
    expect(toChosung('현대자동차')).toBe('ㅎㄷㅈㄷㅊ');
    expect(toChosung('카카오')).toBe('ㅋㅋㅇ');
  });

  it('쌍자음 초성을 구분한다', () => {
    expect(toChosung('빙그레')).toBe('ㅂㄱㄹ');
    expect(toChosung('까르푸')).toBe('ㄲㄹㅍ');
  });

  it('영문·숫자는 그대로 둔다', () => {
    expect(toChosung('SK하이닉스')).toBe('SKㅎㅇㄴㅅ');
    expect(toChosung('LG전자')).toBe('LGㅈㅈ');
  });

  it('종성이 있어도 초성만 뽑는다', () => {
    expect(toChosung('한국')).toBe('ㅎㄱ');
    expect(toChosung('강남')).toBe('ㄱㄴ');
  });
});

describe('isChosungQuery', () => {
  it('초성만 있으면 true', () => {
    expect(isChosungQuery('ㅅㅅㅈㅈ')).toBe(true);
    expect(isChosungQuery('ㅎㄷ')).toBe(true);
  });

  it('완성형 글자가 섞이면 false', () => {
    expect(isChosungQuery('삼성')).toBe(false);
    expect(isChosungQuery('ㅅ성')).toBe(false);
  });

  it('영문·숫자는 false', () => {
    expect(isChosungQuery('samsung')).toBe(false);
    expect(isChosungQuery('005930')).toBe(false);
  });

  it('빈 문자열은 false', () => {
    expect(isChosungQuery('')).toBe(false);
    expect(isChosungQuery('   ')).toBe(false);
  });
});

describe('normalizeForSearch', () => {
  it('법인격 표기를 떼어낸다 — DART 는 "삼성전자(주)" 로 준다', () => {
    expect(normalizeForSearch('삼성전자(주)')).toBe('삼성전자');
    expect(normalizeForSearch('㈜카카오')).toBe('카카오');
    expect(normalizeForSearch('주식회사 네이버')).toBe('네이버');
  });

  it('영문 법인격도 떼어낸다', () => {
    expect(normalizeForSearch('SAMSUNG ELECTRONICS CO,.LTD')).toBe('samsungelectronics');
    expect(normalizeForSearch('Apple Inc.')).toBe('apple');
    expect(normalizeForSearch('NVIDIA CORP')).toBe('nvidia');
  });

  it('공백과 구두점을 없앤다', () => {
    expect(normalizeForSearch('SK 하이닉스')).toBe('sk하이닉스');
    expect(normalizeForSearch('Good & LS')).toBe('goodls');
  });

  it('대소문자를 통일한다', () => {
    expect(normalizeForSearch('NVIDIA')).toBe(normalizeForSearch('nvidia'));
  });
});

describe('matchKind', () => {
  it('정확 일치가 최우선', () => {
    expect(matchKind('삼성전자', '삼성전자(주)')).toBe('EXACT');
  });

  it('전방 일치', () => {
    expect(matchKind('삼성', '삼성전자')).toBe('PREFIX');
    expect(matchKind('현대', '현대자동차')).toBe('PREFIX');
  });

  it('부분 일치', () => {
    expect(matchKind('전자', '삼성전자')).toBe('CONTAINS');
  });

  it('초성 전방 일치', () => {
    expect(matchKind('ㅅㅅㅈㅈ', '삼성전자')).toBe('CHOSUNG');
    expect(matchKind('ㅅㅅ', '삼성전자')).toBe('CHOSUNG');
  });

  it('초성은 전방 일치만 인정한다 — 아무 데나 걸리면 결과가 수백 개가 된다', () => {
    expect(matchKind('ㅈㅈ', '삼성전자')).toBe('NONE');
  });

  it('영문 검색이 한글 기업명에 걸리지 않는다', () => {
    expect(matchKind('samsung', '삼성전자')).toBe('NONE');
    expect(matchKind('samsung', 'SAMSUNG ELECTRONICS CO,.LTD')).toBe('PREFIX');
  });

  it('법인격 표기 차이를 넘어 정확 일치로 잡는다', () => {
    expect(matchKind('네이버', '주식회사 네이버')).toBe('EXACT');
  });

  it('빈 검색어는 NONE', () => {
    expect(matchKind('', '삼성전자')).toBe('NONE');
    expect(matchKind('  ', '삼성전자')).toBe('NONE');
  });
});
