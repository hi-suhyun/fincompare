import { describe, expect, it } from 'vitest';
import {
  UnsafeAmountError,
  parseAccountingMonth,
  parseDartAmount,
  parseDartDate,
  parseShareCount,
} from './numbers.js';

describe('parseDartAmount', () => {
  it('콤마 없는 정수 문자열 (fnlttSinglAcntAll 형식)', () => {
    expect(parseDartAmount('455905980000000')).toBe(455_905_980_000_000);
  });

  it('콤마 있는 문자열 (stockTotqySttus 형식)', () => {
    expect(parseDartAmount('5,969,782,550')).toBe(5_969_782_550);
  });

  it('음수', () => {
    expect(parseDartAmount('-4480835000000')).toBe(-4_480_835_000_000);
  });

  it("빈 문자열과 '-' 는 null — 0 으로 바꾸지 않는다", () => {
    // 매출이 '' 인 것과 0원인 것은 완전히 다르다
    expect(parseDartAmount('')).toBeNull();
    expect(parseDartAmount('   ')).toBeNull();
    expect(parseDartAmount('-')).toBeNull();
  });

  it('null / undefined 는 null', () => {
    expect(parseDartAmount(null)).toBeNull();
    expect(parseDartAmount(undefined)).toBeNull();
  });

  it('0 은 0 이다 — 결측으로 취급하지 않는다', () => {
    expect(parseDartAmount('0')).toBe(0);
  });

  it('숫자가 아니면 null', () => {
    expect(parseDartAmount('해당사항없음')).toBeNull();
    expect(parseDartAmount('1.2.3')).toBeNull();
  });

  it('안전 정수 범위를 넘으면 던진다 — 조용히 틀린 값을 쓰지 않는다', () => {
    expect(() => parseDartAmount('99999999999999999999')).toThrow(UnsafeAmountError);
  });

  it('삼성전자 자산총계는 안전 범위 안이다', () => {
    const value = parseDartAmount('455905980000000');
    expect(Number.isSafeInteger(value as number)).toBe(true);
  });
});

describe('parseShareCount', () => {
  it('정상 주식수', () => {
    expect(parseShareCount('5,969,782,550')).toBe(5_969_782_550);
  });

  it('음수 주식수는 null — 응답이 깨진 것이다', () => {
    expect(parseShareCount('-100')).toBeNull();
  });

  it('소수는 null', () => {
    expect(parseShareCount('100.5')).toBeNull();
  });

  it("'-' 는 null", () => {
    expect(parseShareCount('-')).toBeNull();
  });
});

describe('parseDartDate', () => {
  it('YYYYMMDD 를 ISO 로 바꾼다', () => {
    expect(parseDartDate('20240312')).toBe('2024-03-12');
  });

  it('형식이 아니면 null', () => {
    expect(parseDartDate('2024-03-12')).toBeNull();
    expect(parseDartDate('')).toBeNull();
    expect(parseDartDate('20241332')).toBeNull();
  });
});

describe('parseAccountingMonth', () => {
  it('결산월 문자열을 숫자로', () => {
    expect(parseAccountingMonth('12')).toBe(12);
    expect(parseAccountingMonth('03')).toBe(3);
  });

  it('이상한 값이면 12월로 본다 — 국내 절대다수가 12월 결산', () => {
    expect(parseAccountingMonth('')).toBe(12);
    expect(parseAccountingMonth(undefined)).toBe(12);
    expect(parseAccountingMonth('99')).toBe(12);
  });
});
