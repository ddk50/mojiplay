// path-fabric-adapter の単体テスト
//
// fabric.js が扱う生タプル ([['M', 0, 0], ['C', ...]]) と、
// path-anchors.ts が扱うオブジェクト ADT の相互変換をテスト。

type Point = { readonly x: number; readonly y: number };

type PathCommand =
  | { readonly type: 'M'; readonly to: Point }
  | { readonly type: 'L'; readonly to: Point }
  | { readonly type: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly type: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly type: 'Z' };

type FabricPathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

const { fromFabricPath, toFabricPath } =
  require('../src/core/path/fabric-adapter') as {
    fromFabricPath: (raw: ReadonlyArray<ReadonlyArray<unknown>>) => PathCommand[];
    toFabricPath: (path: ReadonlyArray<PathCommand>) => FabricPathCommand[];
  };

const M = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const C = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): PathCommand =>
  ({ type: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x, y } });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand =>
  ({ type: 'Q', c: { x: cx, y: cy }, to: { x, y } });
const Z = (): PathCommand => ({ type: 'Z' });

describe('fromFabricPath / toFabricPath', () => {
  test('全コマンド種別の往復変換が一致', () => {
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

  test('未知コマンドで例外', () => {
    expect(() => fromFabricPath([['X', 0, 0]])).toThrow();
  });

  test('空パス', () => {
    expect(fromFabricPath([])).toEqual([]);
    expect(toFabricPath([])).toEqual([]);
  });
});

export {};
