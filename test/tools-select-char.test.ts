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
import type { PointerInput } from '../src/usecases/tools/tool-interface';
import type {
  State, PathHandle, PathSnapshot, ObjectHandle, TextCreateProps,
} from '../src/core/state';
import { SelectCharTool } from '../src/usecases/tools/select-char-tool';

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

class FakeHost implements State {
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
  undo(): void { /* no-op */ }
  redo(): void { /* no-op */ }
  canUndo(): boolean { return false; }
  canRedo(): boolean { return false; }
  toSnapshot(): any { return { format: 'mojiplay', version: 1, canvas: {} }; }
  async applySnapshot(_s: any): Promise<void> { /* no-op */ }
  commitActiveText(): void { /* no-op */ }
  getHistoryToken(): number { return 0; }
  onMutate(_cb: () => void): () => void { return () => {}; }
  clearHistory(): void { /* no-op */ }
  getZoom(): number { return 1; }
  removeActiveObjects(): void { /* no-op */ }
  duplicateActiveObjects(_offset: { x: number; y: number }): void { /* no-op */ }
  selectAllObjects(): void { /* no-op */ }
  async outlineActiveTexts() { return { succeeded: 0, failedChars: '', failedFamilies: [] }; }
  exportActiveAsPngDataUrl(_m: number) { return null; }
  linearizeHistory() { return []; }
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

  test('clears anchor selection on deactivate', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 100, y: 100 }), host);
    tool.onPointerUp(pointer({ x: 100, y: 100 }), host);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);
    tool.onDeactivate(host);
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });
});

// ── 複数アンカー選択 (Phase: anchor multi-selection) ──────────────────────

describe('SelectCharTool: multi-anchor selection', () => {
  function makeTriangle(): PathCommand[] {
    return [
      { type: 'M', to: { x: 0,   y: 0   } },  // anchor 0
      { type: 'L', to: { x: 100, y: 0   } },  // anchor 1
      { type: 'L', to: { x: 50,  y: 100 } },  // anchor 2
      { type: 'Z' },
    ];
  }

  test('単独クリックで 1 アンカーを選択', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('Shift+クリックでアンカーを追加選択', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 100, y: 0, shiftKey: true }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
  });

  test('Shift+既選択アンカーをクリックで選択解除', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 100, y: 0, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 100, y: 0, shiftKey: true }), host);
    // anchor 0 を Shift+解除
    tool.onPointerDown(pointer({ x: 0, y: 0, shiftKey: true }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([1]));
  });

  test('Shift で選択解除されたアンカーは drag を起こさない', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    // Shift+同じアンカーで解除 → drag 状態にならない
    const result = tool.onPointerDown(pointer({ x: 0, y: 0, shiftKey: true }), host);
    expect(result).toBe('consumed');  // hit はしたが drag 起こさず
    expect(tool.isDragging()).toBe(false);
  });

  test('未選択アンカーを通常クリックすると既存選択をクリア + 新規 1 個', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 100, y: 0, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 100, y: 0, shiftKey: true }), host);
    // anchor 2 を通常クリック → クリアされて anchor 2 のみ
    tool.onPointerDown(pointer({ x: 50, y: 100 }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([2]));
  });

  test('既選択アンカーを通常クリックすると選択維持 (= drag に入る)', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 100, y: 0, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 100, y: 0, shiftKey: true }), host);
    // anchor 0 (既選択) を通常クリック → 選択維持
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
    expect(tool.isDragging()).toBe(true);
  });

  test('空きエリアの通常クリックで選択クリア + pass を返す', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    const result = tool.onPointerDown(pointer({ x: 500, y: 500 }), host);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });

  test('空きエリア + Shift で選択保持 + pass', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    const result = tool.onPointerDown(pointer({ x: 500, y: 500, shiftKey: true }), host);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('複数選択アンカーを drag → 全アンカーが同じデルタで剛体移動', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // anchor 0 と 1 を選択
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 100, y: 0, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 100, y: 0, shiftKey: true }), host);

    // anchor 0 を掴んで (10, 5) drag
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerMove(pointer({ x: 10, y: 5 }), host);
    tool.onPointerUp(pointer({ x: 10, y: 5 }), host);

    // anchor 0 と 1 が両方 (10, 5) 移動。anchor 2 は不変。
    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 10, y: 5 } });
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 110, y: 5 } });
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 50, y: 100 } });
  });

  test('Shift+drag で水平軸ロック (横方向のみ移動)', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    // 累積 (12, 3) → |dx| > |dy| → 水平軸ロック
    tool.onPointerMove(pointer({ x: 12, y: 3, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 12, y: 3, shiftKey: true }), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 12, y: 0 } });
  });

  test('Shift+drag で垂直軸ロック (縦方向のみ移動)', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    // 累積 (3, 12) → |dy| > |dx| → 垂直軸ロック
    tool.onPointerMove(pointer({ x: 3, y: 12, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 3, y: 12, shiftKey: true }), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 0, y: 12 } });
  });

  test('moveSelectedAnchorsBy: 選択全アンカーを world delta で移動 + history push', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // anchor 0 と 2 を選択
    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    tool.onPointerDown(pointer({ x: 50, y: 100, shiftKey: true }), host);
    tool.onPointerUp(pointer({ x: 50, y: 100, shiftKey: true }), host);

    tool.moveSelectedAnchorsBy(host, 5, 3);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 5, y: 3 } });
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 100, y: 0 } }); // 不変
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 55, y: 103 } });
    // history Command が push されている
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0].kind).toBe('objectChanged');
  });

  test('moveSelectedAnchorsBy: 選択ゼロならノーオペ (history も path も触らない)', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.moveSelectedAnchorsBy(host, 5, 3);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 0, y: 0 } });
    expect(host.commands).toHaveLength(0);
    expect(path.finalizeCount).toBe(0);
  });

  test('clearSelectedAnchors() で選択がリセットされる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer({ x: 0, y: 0 }), host);
    tool.onPointerUp(pointer({ x: 0, y: 0 }), host);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    tool.clearSelectedAnchors();
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });
});

