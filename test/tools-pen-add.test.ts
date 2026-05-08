// PenAddTool の単体テスト。

import type { PathCommand } from '../src/core/path/types';
import type { Mat2x3 } from '../src/core/path/coords';
import type {
  PathHandle, PathSnapshot, PointerInput, ToolHost,
} from '../src/core/tools/tool-interface';
import { PenAddTool } from '../src/core/tools/pen-add-tool';

const IDENT: Mat2x3 = [1, 0, 0, 1, 0, 0];

class FakePathHandle implements PathHandle {
  public commands: PathCommand[];
  public finalizeCount = 0;
  constructor(initial: PathCommand[]) { this.commands = initial.map(c => c); }
  snapshot(): PathSnapshot {
    return { commands: this.commands, pathMatrix: IDENT, pathOffset: { x: 0, y: 0 } };
  }
  setCommands(cmds: ReadonlyArray<PathCommand>): void { this.commands = cmds.slice(); }
  finalizeEdit(): void { this.finalizeCount++; }
  getId(): any { return 'fake-id-1'; }
  captureForHistory(): any {
    return { type: 'path', data: { objectId: 'fake-id-1', type: 'path' }, commands: this.commands.slice() };
  }
}

class FakeHost implements ToolHost {
  public path: PathHandle | null;
  public cursor = '';
  constructor(p: PathHandle | null) { this.path = p; }
  getActivePath() { return this.path; }
  getViewportMatrix() { return IDENT; }
  requestRerender() {}
  setCursor(c: string) { this.cursor = c; }
  getActiveObjects()   { return []; }
  getAllObjects()      { return []; }
  setActiveSelection() {}
  createTextAt() {}
  pushCommand() {}
}

function pointer(x: number, y: number): PointerInput {
  return { screenX: x, screenY: y, worldX: x, worldY: y, altKey: false, shiftKey: false };
}

describe('PenAddTool: split + drag', () => {
  test('L セグメント中点クリックでアンカー追加 + finalize', () => {
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

  test('セグメントから外れた点は pass', () => {
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

  test('split 後ドラッグでハンドルが対称に伸びる (新アンカー周り)', () => {
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

  test('C 分割では外側ハンドル (前 c1 / 後 c2) は De Casteljau の値、L/Q 用 1/3 デフォルトは使われない', () => {
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

  test('hover: セグメント上で copy カーソル / 外で空', () => {
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

