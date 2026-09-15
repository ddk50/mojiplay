// Q→C 正規化テスト用の共通ヘルパ。
//
// 契約: 「どの経路 (アウトライン化 / 保存→ロード / ＋ペン / undo / redo) を通っても
// outlined path に Q が残らない」+「正規化で形状が変わらない」。
// 形状比較は各セグメントを t 刻みでサンプルした点列で行う (コマンド種別が
// 違っても曲線が同じなら同じ点列になる)。

import type { Point, PathCommand } from '../src/window/core/path/types';
import { evalCubicAt, evalQuadAt } from '../src/window/core/path/bezier';

/** 全コマンドが Q でないことを assert。曲線があれば C のみ。 */
export function expectNoQuadratic(commands: ReadonlyArray<PathCommand>): void {
  const types = commands.map((c) => c.type);
  expect(types).not.toContain('Q');
}

/** fabric 生タプル列 (toObject / .mply の path) に 'Q' が無いことを assert。 */
export function expectNoQuadraticTuple(raw: ReadonlyArray<ReadonlyArray<unknown>>): void {
  expect(raw.map((r) => r[0])).not.toContain('Q');
}

/** 各セグメントを n 等分でサンプルした点列。Z は subpath 先頭への直線として扱う。 */
export function samplePath(commands: ReadonlyArray<PathCommand>, n = 8): Point[] {
  const pts: Point[] = [];
  let cur: Point | null = null;
  let start: Point | null = null;
  const line = (a: Point, b: Point): void => {
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        cur = cmd.to;
        start = cmd.to;
        pts.push(cmd.to);
        break;
      case 'L':
        if (cur) line(cur, cmd.to);
        cur = cmd.to;
        break;
      case 'C':
        if (cur)
          for (let k = 0; k <= n; k++) pts.push(evalCubicAt(cur, cmd.c1, cmd.c2, cmd.to, k / n));
        cur = cmd.to;
        break;
      case 'Q':
        if (cur) for (let k = 0; k <= n; k++) pts.push(evalQuadAt(cur, cmd.c, cmd.to, k / n));
        cur = cmd.to;
        break;
      case 'Z':
        if (cur && start) line(cur, start);
        cur = start;
        break;
      default:
        cmd satisfies never;
    }
  }
  return pts;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const dx = p.x - (a.x + vx * t);
  const dy = p.y - (a.y + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 2 つのコマンド列が同じ曲線を描くことを assert。
 *   - セグメント数が同じ (Q→C 置換のみ) なら、同じ t のサンプル点同士を厳密比較。
 *   - セグメント数が違う (＋ペンの分割を含む) なら、actual の各サンプル点が
 *     expected を密にサンプルした折れ線上 (距離 < tol) にあることを確認する。
 */
export function expectSameShape(
  actual: ReadonlyArray<PathCommand>,
  expected: ReadonlyArray<PathCommand>,
  digits = 6,
): void {
  const a = samplePath(actual);
  if (actual.length === expected.length) {
    const e = samplePath(expected);
    expect(a).toHaveLength(e.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBeCloseTo(e[i].x, digits);
      expect(a[i].y).toBeCloseTo(e[i].y, digits);
    }
    return;
  }
  const dense = samplePath(expected, 200);
  const tol = 0.01;
  for (const p of a) {
    let best = Infinity;
    for (let i = 1; i < dense.length; i++)
      best = Math.min(best, distToSegment(p, dense[i - 1], dense[i]));
    expect(best).toBeLessThan(tol);
  }
}

/** PathCommand 列 → fontkit の toSVG() 相当の絶対座標 SVG d 文字列。 */
export function toSvgD(commands: ReadonlyArray<PathCommand>): string {
  return commands
    .map((c) => {
      switch (c.type) {
        case 'M':
          return `M${c.to.x} ${c.to.y}`;
        case 'L':
          return `L${c.to.x} ${c.to.y}`;
        case 'Q':
          return `Q${c.c.x} ${c.c.y} ${c.to.x} ${c.to.y}`;
        case 'C':
          return `C${c.c1.x} ${c.c1.y} ${c.c2.x} ${c.c2.y} ${c.to.x} ${c.to.y}`;
        case 'Z':
          return 'Z';
        default:
          return c satisfies never;
      }
    })
    .join(' ');
}
