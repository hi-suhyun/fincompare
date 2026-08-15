import { describe, expect, it } from 'vitest';
import { TTM_WINDOW, ttmValue } from './ttm.js';

/**
 * 미국 기업은 4분기에 10-Q 를 내지 않는다 — 연간 10-K 하나로 갈음한다.
 * 그래서 SEC 에는 Q4 가 아예 없고, 최근 4개 분기를 모으면 항상 한 칸이 빈다.
 * Q4 = 연간 - (1+2+3분기) 로 채워야 TTM 이 성립한다.
 *
 * 엔비디아 FY2026 실측 (SEC, 단위 10억 달러):
 *   Q1 44.1  Q2 46.7  Q3 57.0  연간 215.9  ->  Q4 = 68.1
 */
const NVDA_FY2026 = { q1: 44.1, q2: 46.7, q3: 57.0, annual: 215.9 };

const deriveQ4 = (y: typeof NVDA_FY2026): number => y.annual - y.q1 - y.q2 - y.q3;

describe('4분기 역산', () => {
  it('연간에서 1~3분기를 빼면 4분기가 나온다', () => {
    expect(deriveQ4(NVDA_FY2026)).toBeCloseTo(68.1, 1);
  });

  it('역산한 4분기를 더하면 연간과 같아진다', () => {
    const q4 = deriveQ4(NVDA_FY2026);
    const sum = NVDA_FY2026.q1 + NVDA_FY2026.q2 + NVDA_FY2026.q3 + q4;
    expect(sum).toBeCloseTo(NVDA_FY2026.annual, 6);
  });

  it('Q4 가 없으면 TTM 이 성립하지 않는다', () => {
    // 이게 엔비디아 2026 이 비어 있던 이유다
    expect(() => ttmValue('revenue', [46.7, 57.0, 81.6] as never)).toThrow();
  });

  it('Q4 를 채우면 TTM 이 나온다', () => {
    const q4 = deriveQ4(NVDA_FY2026);
    const ttm = ttmValue('revenue', [NVDA_FY2026.q2, NVDA_FY2026.q3, q4, 81.6]);
    expect(ttm).toBeCloseTo(253.4, 0);
  });

  it('시점 항목은 합산하지 않는다', () => {
    // 자산총계를 4번 더하면 자산이 4배가 된다
    const assets = ttmValue('totalAssets', [100, 110, 120, 130]);
    expect(assets).toBe(130);
  });

  it('TTM 창은 4개 분기다', () => {
    expect(TTM_WINDOW).toBe(4);
  });
});
