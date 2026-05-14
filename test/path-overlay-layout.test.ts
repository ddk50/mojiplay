// core/path/overlay-layout.ts の単体テスト。
//
// PathSnapshot + viewportMatrix から「screen 座標つきアンカー / ハンドル一覧」
// を計算する純粋関数と、その結果へのヒットテストを検証。

import type { PathCommand } from '../src/core/path/types';
import type { Mat2x3 } from '../src/core/path/coords';
import { Path } from '../src/core/path/path';
import type { PathSnapshot } from '../src/core/state-interface';
import {
  computeOverlayLayout,
  hitTestAnchorAt,
  hitTestHandleAt,
} from '../src/core/path/overlay-layout';

const IDENT: Mat2x3 = [1, 0, 0, 1, 0, 0];

function snap(commands: PathCommand[]): PathSnapshot {
  return { path: new Path(commands), pathMatrix: IDENT, pathOffset: { x: 0, y: 0 } };
}

describe('computeOverlayLayout', () => {
  test('L のみの三角形からアンカーの screen 座標を抽出できる', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 10, y: 10 } },
      { type: 'L', to: { x: 50, y: 10 } },
      { type: 'L', to: { x: 30, y: 40 } },
      { type: 'Z' },
    ];
    const layout = computeOverlayLayout(snap(cmds), IDENT);
    expect(layout.anchors).toEqual([
      { anchorIndex: 0, sx: 10, sy: 10 },
      { anchorIndex: 1, sx: 50, sy: 10 },
      { anchorIndex: 2, sx: 30, sy: 40 },
    ]);
    expect(layout.handles).toEqual([]);
  });

  test('C セグメントからハンドルの screen 座標を抽出できる', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ];
    const layout = computeOverlayLayout(snap(cmds), IDENT);
    expect(layout.anchors).toHaveLength(2);
    // anchor 0 の outgoing = c1 (cmdIndex 1)、anchor 1 の incoming = c2 (cmdIndex 1)
    const out = layout.handles.find((h) => h.anchorIndex === 0 && h.which === 'out');
    const inc = layout.handles.find((h) => h.anchorIndex === 1 && h.which === 'in');
    expect(out).toBeDefined();
    expect(inc).toBeDefined();
    expect(out!.sx).toBe(10);
    expect(out!.sy).toBe(0);
    expect(inc!.sx).toBe(100);
    expect(inc!.sy).toBe(50);
  });

  test('viewport zoom が screen 座標をスケールする', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 10, y: 20 } },
      { type: 'L', to: { x: 30, y: 40 } },
    ];
    const layout = computeOverlayLayout(snap(cmds), [2, 0, 0, 2, 0, 0]);
    expect(layout.anchors[0]).toEqual({ anchorIndex: 0, sx: 20, sy: 40 });
    expect(layout.anchors[1]).toEqual({ anchorIndex: 1, sx: 60, sy: 80 });
  });

  test('pathOffset が screen 座標を平行移動する', () => {
    const cmds: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 200 } },
    ];
    const snapshot: PathSnapshot = {
      path: new Path(cmds),
      pathMatrix: IDENT,
      pathOffset: { x: 50, y: 50 },
    };
    const layout = computeOverlayLayout(snapshot, IDENT);
    expect(layout.anchors[0]).toEqual({ anchorIndex: 0, sx: 50, sy: 50 });
    expect(layout.anchors[1]).toEqual({ anchorIndex: 1, sx: 150, sy: 150 });
  });
});

describe('hitTestAnchorAt', () => {
  const cmds: PathCommand[] = [
    { type: 'M', to: { x: 100, y: 100 } },
    { type: 'L', to: { x: 200, y: 100 } },
  ];
  const layout = computeOverlayLayout(snap(cmds), IDENT);

  test('アンカー直撃でヒットする', () => {
    expect(hitTestAnchorAt(layout, 100, 100)).toBe(0);
  });

  test('半径内でもヒットする', () => {
    expect(hitTestAnchorAt(layout, 103, 102)).toBe(0); // dist ~ 3.6 < 6
  });

  test('半径外なら -1 を返す', () => {
    expect(hitTestAnchorAt(layout, 150, 150)).toBe(-1);
  });

  test('空 layout では -1 を返す', () => {
    expect(hitTestAnchorAt({ anchors: [], handles: [] }, 0, 0)).toBe(-1);
  });

  test('範囲内に複数あれば最近のアンカーを選ぶ', () => {
    expect(hitTestAnchorAt(layout, 105, 100)).toBe(0);
    expect(hitTestAnchorAt(layout, 195, 100)).toBe(1);
  });
});

describe('hitTestHandleAt', () => {
  const cmds: PathCommand[] = [
    { type: 'M', to: { x: 0, y: 0 } },
    { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
  ];
  const layout = computeOverlayLayout(snap(cmds), IDENT);

  test('c1 ハンドルにヒットできる', () => {
    const h = hitTestHandleAt(layout, 10, 0);
    expect(h).not.toBeNull();
    expect(h!.handle).toEqual({ kind: 'C-c1', cmdIndex: 1 });
  });

  test('c2 ハンドルにヒットできる', () => {
    const h = hitTestHandleAt(layout, 100, 50);
    expect(h).not.toBeNull();
    expect(h!.handle).toEqual({ kind: 'C-c2', cmdIndex: 1 });
  });

  test('ミスは null を返す', () => {
    expect(hitTestHandleAt(layout, 500, 500)).toBeNull();
  });
});
