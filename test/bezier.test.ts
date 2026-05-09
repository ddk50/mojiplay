// Bezier 数値評価 (evalCubicAt / evalQuadAt) の単体テスト。

import { evalCubicAt, evalQuadAt } from '../src/core/path/bezier';

describe('evalCubicAt', () => {
  test('t=0 で始点、t=1 で終点を返す', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 10, y: 20 };
    const c2 = { x: 30, y: 40 };
    const p3 = { x: 50, y: 50 };
    expect(evalCubicAt(p0, c1, c2, p3, 0)).toEqual(p0);
    expect(evalCubicAt(p0, c1, c2, p3, 1)).toEqual(p3);
  });

  test('制御点が直線上の時は t=0.5 で中点を返す', () => {
    // 制御点が始点-終点の直線上にある場合、曲線も直線
    const r = evalCubicAt(
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, 0.5,
    );
    expect(r.x).toBeCloseTo(15);
    expect(r.y).toBeCloseTo(0);
  });
});

describe('evalQuadAt', () => {
  test('t=0 で始点、t=1 で終点を返す', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 5, y: 10 };
    const p2 = { x: 10, y: 0 };
    expect(evalQuadAt(p0, c1, p2, 0)).toEqual(p0);
    expect(evalQuadAt(p0, c1, p2, 1)).toEqual(p2);
  });
});
