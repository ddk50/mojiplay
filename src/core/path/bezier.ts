// Bezier 曲線の数値評価。
//
// 4 点 (始点・制御点・制御点・終点) または 3 点 (始点・制御点・終点) の Point から、
// パラメータ t (0..1) における曲線上の位置を返す純粋関数。
//
// 用途は segment-hit (= path 上のクリック位置を逆算する際のサンプリング) など、
// path 上の特定セグメント評価が必要な場面。Path 値オブジェクト本体には紐付かず、
// 単独の Bezier math として独立しているのでここに置く。

import type { Point } from './types';

export function evalCubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p3.y,
  };
}

export function evalQuadAt(p0: Point, c1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c1.y + t * t * p2.y,
  };
}
