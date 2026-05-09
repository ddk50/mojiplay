// PenAddTool の単体テスト。

import type { PathHandle } from '../src/core/state';
import { PenAddTool } from '../src/usecases/tools/pen-add-tool';
import { FakePathHandle, FakeState, pointer } from './fakes';

class FakeHost extends FakeState {
  public path: PathHandle | null;
  public cursor = '';
  constructor(p: PathHandle | null) { super(); this.path = p; }
  override getActivePath() { return this.path; }
  override setCursor(c: string) { this.cursor = c; }
}

describe('PenAddTool: split + drag', () => {
  test('L セグメント中点クリックでアンカーを追加して finalize できる', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenAddTool();

    const r = tool.onPointerDown(pointer(50, 0), host);
    expect(r).toBe('consumed');
    expect(tool.isDragging()).toBe(true);
    // 分割直後は L の真ん中が C 化されている (handles はドラッグ前ゼロ相当だが、L→C 変換中)
    expect(path.commands.length).toBe(3);

    // ドラッグなしで up すれば dx=dy=0 のまま finalize
    tool.onPointerUp(pointer(50, 0), host);
    expect(tool.isDragging()).toBe(false);
    expect(path.finalizeCount).toBe(1);
  });

  test('セグメントから外れた点は pass を返す', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenAddTool();
    const r = tool.onPointerDown(pointer(50, 100), host);
    expect(r).toBe('pass');
    expect(tool.isDragging()).toBe(false);
    expect(path.commands.length).toBe(2);
  });

  test('split 後のドラッグで新アンカー周りのハンドルが対称に伸びる', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenAddTool();

    tool.onPointerDown(pointer(50, 0), host); // 新アンカー = (50, 0)
    tool.onPointerMove(pointer(50, 30), host); // 下方向に 30 ドラッグ

    // 前半 cmdIndex 1: c2 = anchor - d = (50, 0) - (0, 30) = (50, -30)
    // 後半 cmdIndex 2: c1 = anchor + d = (50, 0) + (0, 30) = (50, 30)
    const first = path.commands[1];
    const second = path.commands[2];
    expect(first.type).toBe('C');
    expect(second.type).toBe('C');
    if (first.type === 'C') expect(first.c2).toEqual({ x: 50, y: -30 });
    if (second.type === 'C') expect(second.c1).toEqual({ x: 50, y: 30 });
  });

  test('C 分割では外側ハンドル (前 c1 / 後 c2) が De Casteljau の値になる (L/Q 用 1/3 デフォルトは使わない)', () => {
    // p0=(0,0), c1=(0,-50), c2=(100,-50), p3=(100,0) の C を t=0.5 で分割すると、
    // De Casteljau により前半 c1=(0,-25)、後半 c2=(100,-25) となる。
    // L/Q を分割した時の 1/3 デフォルト ((16.67, 0) 等) ではないことを確認する。
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 0, y: -50 }, c2: { x: 100, y: -50 }, to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenAddTool();

    // C カーブの頂点 (50, -37.5) = B(0.5) を直撃
    tool.onPointerDown(pointer(50, -37.5), host);
    tool.onPointerMove(pointer(50, -37.5), host);  // ドラッグ無し → dx=dy=0

    const first = path.commands[1];
    const second = path.commands[2];
    expect(first.type).toBe('C');
    expect(second.type).toBe('C');
    if (first.type === 'C') {
      expect(first.c1.x).toBeCloseTo(0,   3);
      expect(first.c1.y).toBeCloseTo(-25, 3);
    }
    if (second.type === 'C') {
      expect(second.c2.x).toBeCloseTo(100, 3);
      expect(second.c2.y).toBeCloseTo(-25, 3);
    }
  });

  test('hover でセグメント上は copy カーソル、外では空文字になる', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenAddTool();

    tool.onPointerMove(pointer(50, 0), host);
    expect(host.cursor).toBe('copy');

    tool.onPointerMove(pointer(50, 100), host);
    expect(host.cursor).toBe('');
  });
});
