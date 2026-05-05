// PenRemoveTool の単体テスト。

type Point = { readonly x: number; readonly y: number };
type Mat2x3 = readonly [number, number, number, number, number, number];

type PathCommand =
  | { readonly type: 'M'; readonly to: Point }
  | { readonly type: 'L'; readonly to: Point }
  | { readonly type: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly type: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly type: 'Z' };

interface PathSnapshot {
  readonly commands:   ReadonlyArray<PathCommand>;
  readonly pathMatrix: Mat2x3;
  readonly pathOffset: Point;
}

interface PathHandle {
  snapshot(): PathSnapshot;
  setCommands(cmds: ReadonlyArray<PathCommand>): void;
  finalizeEdit(): void;
}

interface PointerInput {
  readonly screenX: number; readonly screenY: number;
  readonly worldX:  number; readonly worldY:  number;
  readonly altKey: boolean; readonly shiftKey: boolean;
}

interface ToolHost {
  getActivePath(): PathHandle | null;
  getViewportMatrix(): Mat2x3;
  requestRerender(): void;
  setCursor(c: string): void;
  getActiveObjects():     any;
  getAllObjects():        any;
  setActiveSelection(...args: any[]): void;
  createTextAt(...args: any[]): void;
}

type PointerHandled = 'consumed' | 'pass';

interface PenRemoveToolI {
  onPointerDown(e: PointerInput, h: ToolHost): PointerHandled;
  onPointerMove(e: PointerInput, h: ToolHost): void;
}

const { PenRemoveTool } = require('../src/core/tools/pen-remove-tool') as {
  PenRemoveTool: new () => PenRemoveToolI;
};

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
}

class FakeHost implements ToolHost {
  public path: PathHandle | null;
  public cursor = '';
  public rerenderCount = 0;
  constructor(p: PathHandle | null) { this.path = p; }
  getActivePath() { return this.path; }
  getViewportMatrix() { return IDENT; }
  requestRerender() { this.rerenderCount++; }
  setCursor(c: string) { this.cursor = c; }
  getActiveObjects()   { return []; }
  getAllObjects()      { return []; }
  setActiveSelection() { /* no-op */ }
  createTextAt() { /* no-op */ }
}

function pointer(x: number, y: number): PointerInput {
  return { screenX: x, screenY: y, worldX: x, worldY: y, altKey: false, shiftKey: false };
}

describe('PenRemoveTool', () => {
  test('アンカー上をクリックすると removeAnchor が走り finalizeEdit', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 0, y: 100 } },
      { type: 'Z' },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    // index=1 のアンカー (100, 0) を狙う
    const r = tool.onPointerDown(pointer(100, 0), host);
    expect(r).toBe('consumed');
    expect(path.commands.length).toBe(4);  // 元 5 → アンカー 1 個分の L が消えて 4
    expect(path.finalizeCount).toBe(1);
  });

  test('アンカー以外をクリックは pass で副作用無し', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    const r = tool.onPointerDown(pointer(500, 500), host);
    expect(r).toBe('pass');
    expect(path.finalizeCount).toBe(0);
    expect(path.commands.length).toBe(3);
  });

  test('アンカー数下限の場合は (consumed だが) コマンド変更も finalize も無し', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },  // この L を削除すると M 単独になり拒否される
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    // (100, 0) をクリック
    const before = path.commands.slice();
    const r = tool.onPointerDown(pointer(100, 0), host);
    // hit はあるので consumed (fabric への伝播抑止)。ただし removeAnchor が拒否するので副作用無し。
    expect(r).toBe('consumed');
    expect(path.commands).toEqual(before);
    expect(path.finalizeCount).toBe(0);
  });

  test('hover: アンカー上で pointer カーソル', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    tool.onPointerMove(pointer(0, 0), host);
    expect(host.cursor).toBe('pointer');

    tool.onPointerMove(pointer(500, 500), host);
    expect(host.cursor).toBe('');
  });

  test('hover: パス無しならカーソル空', () => {
    const host = new FakeHost(null);
    const tool = new PenRemoveTool();
    tool.onPointerMove(pointer(0, 0), host);
    expect(host.cursor).toBe('');
  });
});

export {};
