// SelectCharTool (白矢印ツール) の単体テスト。
//
// FakePathHandle と FakeToolHost を注入し、tool 単体のドラッグ更新・カーソル制御・
// スナップ挙動を fabric / DOM 抜きで検証する。
//
// 検証する仕様:
//   - アンカーをクリックしてドラッグ → 該当 PathCommand が更新される
//   - ハンドルをクリックしてドラッグ → 該当ハンドルのみ更新される
//   - 何もない所の pointerDown は 'pass' を返す (= fabric に処理を渡す)
//   - pointerUp で finalizeEdit が 1 回だけ呼ばれる
//   - hover 時のカーソル: handle → 'pointer', anchor → 'move', miss → ''
//   - object:moving で snap (Alt 押下中はバイパス)

import type { PathCommand } from '../src/core/path/types';
import type { Mat2x3 } from '../src/core/path/coords';
import type {
  PathHandle, PathSnapshot, PointerInput, ToolHost,
  ObjectHandle, TextCreateProps,
} from '../src/core/tools/tool-interface';
import { SelectCharTool } from '../src/core/tools/select-char-tool';

const IDENT: Mat2x3 = [1, 0, 0, 1, 0, 0];

// ── テストダブル ──────────────────────────────────────────────────────────

class FakePathHandle implements PathHandle {
  public commands: PathCommand[];
  public finalizeCount = 0;
  public setCount = 0;
  constructor(initial: PathCommand[]) {
    this.commands = initial.map(c => c);
  }
  snapshot(): PathSnapshot {
    return {
      commands: this.commands,
      pathMatrix: IDENT,
      pathOffset: { x: 0, y: 0 },
    };
  }
  setCommands(cmds: ReadonlyArray<PathCommand>): void {
    this.commands = cmds.slice();
    this.setCount++;
  }
  finalizeEdit(): void {
    this.finalizeCount++;
  }
  getId(): any { return 'fake-id-1'; }
  captureForHistory(): any {
    // テスト用 snapshot: 現在の commands を含めて return (前後比較で diff が分かるように)
    return { type: 'path', data: { objectId: 'fake-id-1', type: 'path' }, commands: this.commands.slice() };
  }
}

class FakeHost implements ToolHost {
  public path: PathHandle | null;
  public cursor = '';
  public rerenderCount = 0;
  constructor(path: PathHandle | null) { this.path = path; }
  getActivePath(): PathHandle | null { return this.path; }
  getViewportMatrix(): Mat2x3 { return IDENT; }
  requestRerender(): void { this.rerenderCount++; }
  setCursor(c: string): void { this.cursor = c; }
  getActiveObjects(): ReadonlyArray<ObjectHandle> { return []; }
  getAllObjects():    ReadonlyArray<ObjectHandle> { return []; }
  setActiveSelection(_objs: ReadonlyArray<ObjectHandle>): void { /* no-op */ }
  createTextAt(_x: number, _y: number, _props: TextCreateProps): void { /* no-op */ }
  public commands: any[] = [];
  pushCommand(cmd: any): void { this.commands.push(cmd); }
}

function pointer(opts: Partial<PointerInput> & { x: number; y: number }): PointerInput {
  return {
    screenX: opts.x, screenY: opts.y,
    worldX:  opts.x, worldY:  opts.y,  // identity transforms
    altKey:   opts.altKey   ?? false,
    shiftKey: opts.shiftKey ?? false,
  };
}

// ── テスト本体 ────────────────────────────────────────────────────────────

describe('SelectCharTool: anchor drag', () => {
  test('clicking on anchor + dragging updates that command only', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
      { type: 'L', to: { x: 200, y: 200 } },
      { type: 'Z' },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onActivate(host);

    // anchor 0 = (100, 100)
    const result = tool.onPointerDown(pointer({ x: 100, y: 100 }), host);
    expect(result).toBe('consumed');
    expect(tool.isDragging()).toBe(true);

    tool.onPointerMove(pointer({ x: 110, y: 105 }), host);
    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 110, y: 105 } });
    // 他のコマンドは不変
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 200, y: 100 } });
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 200, y: 200 } });

    tool.onPointerUp(pointer({ x: 110, y: 105 }), host);
    expect(tool.isDragging()).toBe(false);
    expect(path.finalizeCount).toBe(1);
  });

  test('drag is incremental (delta-based)', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onActivate(host);

    tool.onPointerDown(pointer({ x: 100, y: 100 }), host);
    tool.onPointerMove(pointer({ x: 110, y: 100 }), host); // delta +10
    tool.onPointerMove(pointer({ x: 115, y: 102 }), host); // delta +5, +2
    tool.onPointerUp(pointer({ x: 115, y: 102 }), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 115, y: 102 } });
  });

  test('miss returns pass and does not start drag', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    const result = tool.onPointerDown(pointer({ x: 50, y: 50 }), host);
    expect(result).toBe('pass');
    expect(tool.isDragging()).toBe(false);
  });

  test('with no active path, pointerDown returns pass', () => {
    const host = new FakeHost(null);
    const tool = new SelectCharTool();
    expect(tool.onPointerDown(pointer({ x: 100, y: 100 }), host)).toBe('pass');
  });
});

describe('SelectCharTool: handle drag', () => {
  test('clicking on handle moves only that handle', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // c1 = (10, 0)
    tool.onPointerDown(pointer({ x: 10, y: 0 }), host);
    tool.onPointerMove(pointer({ x: 20, y: 5 }), host);
    tool.onPointerUp(pointer({ x: 20, y: 5 }), host);

    const c = path.commands[1];
    if (c.type !== 'C') throw new Error('expected C');
    expect(c.c1).toEqual({ x: 20, y: 5 });   // moved
    expect(c.c2).toEqual({ x: 100, y: 50 }); // unchanged
    expect(c.to).toEqual({ x: 100, y: 100 }); // unchanged
  });

  test('handle is preferred over anchor when overlapping', () => {
    // c1 is at the same position as M anchor — handle should win
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 50, y: 50 } },
      { type: 'C', c1: { x: 50, y: 50 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 50, y: 50 }), host);
    tool.onPointerMove(pointer({ x: 60, y: 50 }), host);
    tool.onPointerUp(pointer({ x: 60, y: 50 }), host);

    // c1 が動き、M アンカーは不変であることで「ハンドル優先」を確認
    const c = path.commands[1];
    if (c.type !== 'C') throw new Error('expected C');
    expect(c.c1).toEqual({ x: 60, y: 50 });
    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 50, y: 50 } });
  });
});

describe('SelectCharTool: hover cursor', () => {
  const initial: PathCommand[] = [
    { type: 'M', to: { x: 0, y: 0 } },
    { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
  ];

  test('hover on handle sets pointer cursor', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer({ x: 10, y: 0 }), host);
    expect(host.cursor).toBe('pointer');
  });

  test('hover on anchor sets move cursor', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer({ x: 100, y: 100 }), host);
    expect(host.cursor).toBe('move');
  });

  test('hover on empty space clears cursor', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer({ x: 500, y: 500 }), host);
    expect(host.cursor).toBe('');
  });

  test('with no active path, cursor is cleared', () => {
    const host = new FakeHost(null);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer({ x: 10, y: 10 }), host);
    expect(host.cursor).toBe('');
  });

  test('does not run hover logic during drag', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    host.cursor = 'move';
    tool.onPointerMove(pointer({ x: 500, y: 500 }), host);
    // drag 中はカーソルは hover ロジックで上書きされない
    expect(host.cursor).toBe('move');
  });
});

describe('SelectCharTool: snap (object:moving)', () => {
  function targetAt(left: number, top: number) {
    let l = left, t = top;
    return {
      getLeft: () => l, getTop: () => t,
      setLeft: (v: number) => { l = v; },
      setTop:  (v: number) => { t = v; },
      currentLeft: () => l, currentTop: () => t,
    };
  }

  test('snaps to nearest grid when within threshold', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const host = new FakeHost(null);
    const t = targetAt(34, 50); // 34 → nearest 32 (dist 2 < threshold 5)
    tool.onObjectMoving(t, { altKey: false }, host);
    expect(t.currentLeft()).toBe(32);
    expect(t.currentTop()).toBe(48);  // 50 → 48 (dist 2)
  });

  test('does not snap when outside threshold', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 2 });
    const host = new FakeHost(null);
    const t = targetAt(35, 35); // dist to nearest 32 = 3 >= threshold 2
    tool.onObjectMoving(t, { altKey: false }, host);
    expect(t.currentLeft()).toBe(35);
    expect(t.currentTop()).toBe(35);
  });

  test('Alt key bypasses snap', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const host = new FakeHost(null);
    const t = targetAt(33, 49);
    tool.onObjectMoving(t, { altKey: true }, host);
    expect(t.currentLeft()).toBe(33);
    expect(t.currentTop()).toBe(49);
  });

  test('snap disabled is no-op', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: false, pitch: 8, threshold: 5 });
    const host = new FakeHost(null);
    const t = targetAt(33, 49);
    tool.onObjectMoving(t, { altKey: false }, host);
    expect(t.currentLeft()).toBe(33);
    expect(t.currentTop()).toBe(49);
  });
});

describe('SelectCharTool: deactivate', () => {
  test('cancels in-flight drag and clears cursor', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 100, y: 100 }), host);
    expect(tool.isDragging()).toBe(true);
    tool.onDeactivate(host);
    expect(tool.isDragging()).toBe(false);
    expect(host.cursor).toBe('');
  });
});

