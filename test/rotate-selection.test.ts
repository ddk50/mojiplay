// core/rotate-selection (複数選択一括回転の純粋幾何) の単体テスト。
// fabric 不要 — 回転式が fabric の y-down 時計回り規約と一致することをここで担保する
// (fabric stub 側の getCenterPoint / setPositionByOrigin は angle=0 前提の最小実装のため)。

import {
  selectionPivot,
  rotatePointAround,
  normalizeAngle,
} from '../src/window/core/rotate-selection';

describe('rotatePointAround', () => {
  test('原点周り 90° は y-down で (1,0)→(0,1) (時計回り)', () => {
    const p = rotatePointAround({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  test('原点周り -90° は (1,0)→(0,-1)', () => {
    const p = rotatePointAround({ x: 1, y: 0 }, { x: 0, y: 0 }, -90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-1);
  });

  test('非原点 pivot 周りの回転', () => {
    // (60,10) を pivot(50,10) 周りに 90°: dx=10,dy=0 → (50,20)
    const p = rotatePointAround({ x: 60, y: 10 }, { x: 50, y: 10 }, 90);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(20);
  });

  test('0° は恒等 (入力そのまま)', () => {
    const p = rotatePointAround({ x: 3, y: 7 }, { x: 50, y: 10 }, 0);
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(7);
  });
});

describe('selectionPivot', () => {
  test('離れた 2 rect の union bbox 中心', () => {
    const p = selectionPivot([
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 90, top: 40, width: 10, height: 10 },
    ]);
    expect(p).toEqual({ x: 50, y: 25 });
  });

  test('単一 rect はその中心', () => {
    const p = selectionPivot([{ left: 10, top: 20, width: 30, height: 40 }]);
    expect(p).toEqual({ x: 25, y: 40 });
  });

  test('空配列は null', () => {
    expect(selectionPivot([])).toBeNull();
  });
});

describe('normalizeAngle', () => {
  test('370 → 10', () => {
    expect(normalizeAngle(370)).toBe(10);
  });
  test('-30 → 330', () => {
    expect(normalizeAngle(-30)).toBe(330);
  });
  test('360 → 0', () => {
    expect(normalizeAngle(360)).toBe(0);
  });
  test('範囲内はそのまま', () => {
    expect(normalizeAngle(45)).toBe(45);
  });
});
