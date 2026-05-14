// renderer/path-adapter の単体テスト
//
// fabric.js が扱う生タプル ([['M', 0, 0], ['C', ...]]) と、
// core/path/anchors.ts が扱うオブジェクト ADT の相互変換をテスト。

import type { PathCommand } from '../src/core/path/types';
import { fromFabricPath, toFabricPath } from '../src/renderer/path-adapter';
import type { FabricPathCommand } from '../src/renderer/path-adapter';

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

describe('fromFabricPath / toFabricPath', () => {
  test('全コマンド種別を往復変換しても一致する', () => {
    const raw: FabricPathCommand[] = [
      ['M', 0, 0],
      ['L', 10, 0],
      ['C', 1, 2, 3, 4, 5, 5],
      ['Q', 6, 7, 8, 8],
      ['Z'],
    ];
    const obj = fromFabricPath(raw);
    expect(obj).toHaveLength(5);
    expect(obj[0]).toEqual(M(0, 0));
    expect(obj[1]).toEqual(L(10, 0));
    expect(obj[2]).toEqual(C(1, 2, 3, 4, 5, 5));
    expect(obj[3]).toEqual(Q(6, 7, 8, 8));
    expect(obj[4]).toEqual(Z());

    const roundtrip = toFabricPath(obj);
    expect(roundtrip).toEqual(raw);
  });

  test('未知コマンドで例外を投げる', () => {
    expect(() => fromFabricPath([['X', 0, 0]])).toThrow();
  });

  test('空 path はそのまま空配列を返す', () => {
    expect(fromFabricPath([])).toEqual([]);
    expect(toFabricPath([])).toEqual([]);
  });
});
