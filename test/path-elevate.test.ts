// elevateQuadraticsToCubic (Q→C 次数上げ) の単体テスト。
//
// 数学的背景: Q(p0, q, p1) == C(p0, p0 + 2/3(q−p0), p1 + 2/3(q−p1), p1)。
// 曲線が完全一致するので、evalQuadAt と evalCubicAt を同じ t で比較すれば
// 任意の t で一致するはず。

import type { PathCommand } from '../src/window/core/path/types';
import { elevateQuadraticsToCubic, hasQuadratic } from '../src/window/core/path/elevate';
import { evalCubicAt, evalQuadAt } from '../src/window/core/path/bezier';
import { Anchors } from '../src/window/core/path/anchors';
import { expectNoQuadratic, expectSameShape } from './path-shape-helpers';

const M = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const C = (
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): PathCommand => ({ type: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x, y } });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  type: 'Q',
  c: { x: cx, y: cy },
  to: { x, y },
});
const Z = (): PathCommand => ({ type: 'Z' });

describe('elevateQuadraticsToCubic', () => {
  test('Q 1 本が C になり、t = 0..1 の各点で元の 2 次曲線と一致する', () => {
    const p0 = { x: 0, y: 0 };
    const q = { x: 50, y: -100 };
    const p1 = { x: 100, y: 0 };
    const out = elevateQuadraticsToCubic([M(0, 0), Q(q.x, q.y, p1.x, p1.y)]);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(M(0, 0));
    const c = out[1];
    expect(c.type).toBe('C');
    if (c.type !== 'C') return;

    // 制御点は 2/3 内分 (直線用の 1/3 等分点ではない)
    expect(c.c1.x).toBeCloseTo(100 / 3, 6);
    expect(c.c1.y).toBeCloseTo(-200 / 3, 6);
    expect(c.c2.x).toBeCloseTo(200 / 3, 6);
    expect(c.c2.y).toBeCloseTo(-200 / 3, 6);
    expect(c.to).toEqual(p1);

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = evalQuadAt(p0, q, p1, t);
      const b = evalCubicAt(p0, c.c1, c.c2, c.to, t);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  test('M / L / C / Z だけのパスは内容不変のコピーを返す', () => {
    const src = [M(0, 0), L(10, 0), C(10, 5, 5, 10, 0, 10), Z()];
    const out = elevateQuadraticsToCubic(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(hasQuadratic(src)).toBe(false);
  });

  test('Z の後の 2 つ目の subpath でも Q の始点は直前の M になる (fontkit の複数 contour 形)', () => {
    const src = [
      M(0, 0),
      Q(50, -100, 100, 0),
      Z(),
      M(20, 20), // 2 contour 目: ここが次の Q の始点
      Q(30, 40, 40, 20),
      Z(),
    ];
    const out = elevateQuadraticsToCubic(src);
    expectNoQuadratic(out);
    expectSameShape(out, src);

    const second = out[4];
    expect(second.type).toBe('C');
    if (second.type !== 'C') return;
    // 始点 (20,20) → q (30,40) の 2/3 内分
    expect(second.c1.x).toBeCloseTo(20 + (2 * 10) / 3, 6);
    expect(second.c1.y).toBeCloseTo(20 + (2 * 20) / 3, 6);
  });

  test('最後の Q.to が M に戻る閉曲線 (fontkit の典型形) でもアンカー数が変わらない', () => {
    // 閉曲線 case (A): 最後の curve の to == M.to → 重複アンカーを 1 つに畳む。
    // Q でも C でもこの畳み込みが同じに働く = 見た目のアンカー数が同じ。
    const src = [M(0, 0), Q(50, -100, 100, 0), Q(50, 100, 0, 0), Z()];
    const out = elevateQuadraticsToCubic(src);
    expectNoQuadratic(out);
    expectSameShape(out, src);

    const before = Anchors.fromCommands(src);
    const after = Anchors.fromCommands(out);
    expect(after.items.length).toBe(before.items.length);
    expect(after.items[0].coincidentClosingCmdIndex).toBe(
      before.items[0].coincidentClosingCmdIndex,
    );
    // C 化後は各アンカーが独立した in / out ハンドルを持つ (Illustrator 型)
    for (const a of after.items) {
      expect(a.incomingHandle?.kind).toBe('C-c2');
      expect(a.outgoingHandle?.kind).toBe('C-c1');
      expect(a.incomingHandle?.cmdIndex).not.toBe(a.outgoingHandle?.cmdIndex);
    }
  });

  test('Q と L / C が混在するパスは Q だけが置換され他は同一', () => {
    const src = [M(0, 0), Q(50, -100, 100, 0), L(100, 100), C(80, 120, 20, 120, 0, 100), Z()];
    const out = elevateQuadraticsToCubic(src);
    expectNoQuadratic(out);
    expectSameShape(out, src);
    expect(out[0]).toEqual(src[0]);
    expect(out[2]).toEqual(src[2]);
    expect(out[3]).toEqual(src[3]);
    expect(out[4]).toEqual(src[4]);
  });
});
