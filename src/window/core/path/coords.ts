// 2D アフィン変換と、パスローカル ↔ ワールド ↔ スクリーン座標の純粋関数群。
// fabric / DOM 非依存で単体テスト可能。
//
// fabric の TMat2D は [a, b, c, d, tx, ty] の 6 要素タプルで、
// (x, y) を (a*x + c*y + tx, b*x + d*y + ty) に写す 2x3 アフィン。
//
// パス座標系の関係 (fabric.Path 由来):
//   local = path.path[*] が保持する命令の座標系 (pathOffset を含む)
//   world = canvas のオブジェクト空間
//   screen = ビューポート変換後 (canvas DOM の topleft 基準のピクセル)
//
//   world  = pathMatrix * (local - pathOffset)
//   screen = viewportMatrix * world
//
// ハンドル / アンカーの編集ロジックは local 座標で行うので、
// 本モジュールは「screen 入力 → local 出力」「world デルタ → local デルタ」
// の双方向変換を提供する。

import type { Point } from './types';

export type Mat2x3 = readonly [number, number, number, number, number, number];

export interface PathTransform {
  readonly pathMatrix: Mat2x3;
  readonly pathOffset: Point;
  readonly viewportMatrix: Mat2x3;
}

export function applyMatrix(p: Point, m: Mat2x3): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

// 平行移動成分を無視して線形部のみ適用 (= ベクトル/デルタ用)。
export function applyMatrixToDelta(d: Point, m: Mat2x3): Point {
  return {
    x: m[0] * d.x + m[2] * d.y,
    y: m[1] * d.x + m[3] * d.y,
  };
}

export function invertMatrix(m: Mat2x3): Mat2x3 {
  const a = m[0],
    b = m[1],
    c = m[2],
    d = m[3],
    tx = m[4],
    ty = m[5];
  const det = a * d - b * c;
  if (det === 0) throw new Error('matrix is singular');
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

export function pathLocalToScreen(local: Point, t: PathTransform): { sx: number; sy: number } {
  const offset = { x: local.x - t.pathOffset.x, y: local.y - t.pathOffset.y };
  const world = applyMatrix(offset, t.pathMatrix);
  const screen = applyMatrix(world, t.viewportMatrix);
  return { sx: screen.x, sy: screen.y };
}

export function screenToPathLocal(screen: Point, t: PathTransform): Point {
  const invVp = invertMatrix(t.viewportMatrix);
  const world = applyMatrix(screen, invVp);
  const invMat = invertMatrix(t.pathMatrix);
  const local0 = applyMatrix(world, invMat);
  return { x: local0.x + t.pathOffset.x, y: local0.y + t.pathOffset.y };
}

export function worldDeltaToPathLocalDelta(delta: Point, pathMatrix: Mat2x3): Point {
  return applyMatrixToDelta(delta, invertMatrix(pathMatrix));
}
