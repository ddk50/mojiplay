// findClosestSegment の単体テスト。
//
// PathCommand を直接構築して、screen 座標 (= identity transforms 下では local 座標)
// でクリックしたときに正しく cmdIndex / t / dist が返るか検証。

type Point = { readonly x: number; readonly y: number };
type Mat2x3 = readonly [number, number, number, number, number, number];

type PathCommand =
  | { readonly type: 'M'; readonly to: Point }
  | { readonly type: 'L'; readonly to: Point }
  | { readonly type: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly type: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly type: 'Z' };

interface PathTransform {
  readonly pathMatrix: Mat2x3;
  readonly pathOffset: Point;
  readonly viewportMatrix: Mat2x3;
}

interface SegmentHit {
  readonly cmdIndex: number;
  readonly t: number;
  readonly dist: number;
}

const { findClosestSegment } = require('../src/core/tools/segment-hit') as {
  findClosestSegment: (
    cmds: ReadonlyArray<PathCommand>,
    sx: number, sy: number,
    t: PathTransform,
    threshold: number, samples: number,
  ) => SegmentHit | null;
};

const IDENT: Mat2x3 = [1, 0, 0, 1, 0, 0];
const T: PathTransform = {
  pathMatrix:     IDENT,
  pathOffset:     { x: 0, y: 0 },
  viewportMatrix: IDENT,
};

describe('findClosestSegment', () => {
  test('L セグメントの中点近くをクリック', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ];
    const hit = findClosestSegment(cmds, 50, 0, T, 8, 50);
    expect(hit).not.toBeNull();
    expect(hit!.cmdIndex).toBe(1);
    expect(hit!.t).toBeCloseTo(0.5, 1);
  });

  test('閾値外はミス (null)', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ];
    const hit = findClosestSegment(cmds, 50, 100, T, 8, 50);
    expect(hit).toBeNull();
  });

  test('M / Z セグメントは候補外', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
      { type: 'Z' },
    ];
    // M (0,0) を直撃しても M 自身は探索対象外。最初の L (cmdIndex 1) の t=0 にヒットする。
    const hit = findClosestSegment(cmds, 0, 0, T, 8, 50);
    expect(hit).not.toBeNull();
    expect(hit!.cmdIndex).toBe(1);
    expect(hit!.t).toBeCloseTo(0, 1);
  });

  test('複数セグメントから距離最近のものを選ぶ', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },   // cmdIndex 1
      { type: 'L', to: { x: 100, y: 100 } }, // cmdIndex 2
    ];
    const hit = findClosestSegment(cmds, 100, 50, T, 8, 50);
    expect(hit).not.toBeNull();
    expect(hit!.cmdIndex).toBe(2);
    expect(hit!.t).toBeCloseTo(0.5, 1);
  });

  test('C セグメント (cubic) 上のヒット', () => {
    // (0,0) → (100, 0) のカーブで、頂点 (50, -75) を持つベル形
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 0, y: -100 }, c2: { x: 100, y: -100 }, to: { x: 100, y: 0 } },
    ];
    // 頂点 (50, -75) 付近をクリック
    const hit = findClosestSegment(cmds, 50, -75, T, 5, 50);
    expect(hit).not.toBeNull();
    expect(hit!.cmdIndex).toBe(1);
    expect(hit!.t).toBeCloseTo(0.5, 1);
  });

  test('viewport zoom が効く (pathTransform 経由)', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ];
    // 2 倍ズーム: local (50, 0) → screen (100, 0)、local (25, 0) → screen (50, 0)
    const T2: PathTransform = { ...T, viewportMatrix: [2, 0, 0, 2, 0, 0] };
    const mid    = findClosestSegment(cmds, 100, 0, T2, 8, 50);
    const quarter = findClosestSegment(cmds,  50, 0, T2, 8, 50);
    expect(mid).not.toBeNull();
    expect(quarter).not.toBeNull();
    expect(mid!.t).toBeCloseTo(0.5,  1);
    expect(quarter!.t).toBeCloseTo(0.25, 1);

    // ズーム範囲外 (screen 250 = local 125、線分外) はミス
    expect(findClosestSegment(cmds, 250, 0, T2, 8, 50)).toBeNull();
  });

  test('空 / 非編集パスは null', () => {
    expect(findClosestSegment([], 0, 0, T, 8, 50)).toBeNull();
    expect(findClosestSegment([{ type: 'M', to: { x: 0, y: 0 } }], 0, 0, T, 8, 50)).toBeNull();
  });
});

export {};
