// SelectCharTool (白矢印ツール) の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) + fabric stub。State の public API
// (state.getActivePath()?.snapshot() / state.linearizeHistory() / state.canUndo())
// で結果を観測する。tool 自身の public API (isDragging / getSelectedAnchorIndices /
// setSnapConfig 等) は当然 test 対象。FakePathHandle の internal counter
// (finalizeCount / setCount) には依存しない。hover カーソルだけは fake DOM stand-in
// (canvas.upperCanvasEl.style.cursor) で観測。
//
// 検証する仕様:
//   - アンカーをクリックしてドラッグ → 該当 PathCommand が更新される
//   - ハンドルをクリックしてドラッグ → 該当ハンドルのみ更新される
//   - 何もない所の pointerDown は 'pass' を返す (= fabric に処理を渡す)
//   - hover 時のカーソル: handle → 'pointer', anchor → 'move', miss → ''
//   - object:moving で snap (Alt 押下中はバイパス)
//   - 複数アンカー選択 (Shift クリック / 軸ロック / moveSelectedAnchorsBy)

jest.mock('../src/renderer/outline-conversion', () => ({
  outlineTextToPath: jest.fn(async () => null),
}));

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import type { PathCommand } from '../src/core/path/types';
import type { DocumentSnapshot } from '../src/core/document/snapshot';
import { State } from '../src/renderer/state';
import { SelectCharTool } from '../src/usecases/tools/select-char-tool';
import { toFabricPath } from '../src/renderer/path-adapter';
import { pointer } from './fakes';

async function setupWithPath(commands: ReadonlyArray<PathCommand>): Promise<{
  state: State;
  fabricCanvas: FakeFabricCanvas;
}> {
  const fabricCanvas = new FakeFabricCanvas();
  const state = new State(fabricCanvas as never);
  const snapshot: DocumentSnapshot = {
    format: 'mojiplay',
    version: 1,
    canvas: {
      objects: [
        {
          type: 'path',
          path: toFabricPath(commands),
          data: { objectId: 'p1', type: 'path', outlined: true },
          left: 0,
          top: 0,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          pathOffset: { x: 0, y: 0 },
        },
      ],
    },
  };
  await state.applySnapshot(snapshot);
  const [pathH] = state.getAllObjects();
  state.setActiveSelection([pathH]);
  return { state, fabricCanvas };
}

function commandsOf(state: State): ReadonlyArray<PathCommand> {
  const p = state.getActivePath();
  if (!p) throw new Error('no active path');
  return p.snapshot().path.commands;
}

function setupNoPath(): { state: State; fabricCanvas: FakeFabricCanvas } {
  const fabricCanvas = new FakeFabricCanvas();
  const state = new State(fabricCanvas as never);
  return { state, fabricCanvas };
}

// ── テスト本体 ────────────────────────────────────────────────────────────

describe('SelectCharTool: anchor drag', () => {
  test('アンカーをクリックしてドラッグすると該当 command のみ更新できる', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
      { type: 'L', to: { x: 200, y: 200 } },
      { type: 'Z' },
    ]);
    const tool = new SelectCharTool();
    tool.onActivate(state);

    // anchor 0 = (100, 100)
    const result = tool.onPointerDown(pointer(100, 100), state);
    expect(result).toBe('consumed');
    expect(tool.isDragging()).toBe(true);

    tool.onPointerMove(pointer(110, 105), state);
    let cmds = commandsOf(state);
    expect(cmds[0]).toEqual({ type: 'M', to: { x: 110, y: 105 } });
    expect(cmds[1]).toEqual({ type: 'L', to: { x: 200, y: 100 } });
    expect(cmds[2]).toEqual({ type: 'L', to: { x: 200, y: 200 } });

    tool.onPointerUp(pointer(110, 105), state);
    expect(tool.isDragging()).toBe(false);
    cmds = commandsOf(state);
    expect(cmds[0]).toEqual({ type: 'M', to: { x: 110, y: 105 } });
    // history Command が 1 件 push される
    expect(state.linearizeHistory()).toHaveLength(1);
    expect(state.linearizeHistory()[0].kind).toBe('objectChanged');
  });

  test('drag は累積デルタベースで反映される', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ]);
    const tool = new SelectCharTool();
    tool.onActivate(state);

    tool.onPointerDown(pointer(100, 100), state);
    tool.onPointerMove(pointer(110, 100), state); // delta +10
    tool.onPointerMove(pointer(115, 102), state); // delta +5, +2
    tool.onPointerUp(pointer(115, 102), state);

    expect(commandsOf(state)[0]).toEqual({ type: 'M', to: { x: 115, y: 102 } });
  });

  test('ミスクリックは pass を返して drag に入らない', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ]);
    const tool = new SelectCharTool();

    const result = tool.onPointerDown(pointer(50, 50), state);
    expect(result).toBe('pass');
    expect(tool.isDragging()).toBe(false);
  });

  test('active path が無い時の pointerDown は pass を返す', () => {
    const { state } = setupNoPath();
    const tool = new SelectCharTool();
    expect(tool.onPointerDown(pointer(100, 100), state)).toBe('pass');
  });
});

describe('SelectCharTool: handle drag', () => {
  test('ハンドルをクリックすると該当ハンドルのみ動かせる', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ]);
    const tool = new SelectCharTool();

    // c1 = (10, 0)
    tool.onPointerDown(pointer(10, 0), state);
    tool.onPointerMove(pointer(20, 5), state);
    tool.onPointerUp(pointer(20, 5), state);

    const c = commandsOf(state)[1];
    if (c.type !== 'C') throw new Error('expected C');
    expect(c.c1).toEqual({ x: 20, y: 5 }); // moved
    expect(c.c2).toEqual({ x: 100, y: 50 }); // unchanged
    expect(c.to).toEqual({ x: 100, y: 100 }); // unchanged
  });

  test('アンカーとハンドルが重なる位置ではハンドルを優先する', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 50, y: 50 } },
      { type: 'C', c1: { x: 50, y: 50 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ]);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(50, 50), state);
    tool.onPointerMove(pointer(60, 50), state);
    tool.onPointerUp(pointer(60, 50), state);

    const cmds = commandsOf(state);
    const c = cmds[1];
    if (c.type !== 'C') throw new Error('expected C');
    expect(c.c1).toEqual({ x: 60, y: 50 });
    expect(cmds[0]).toEqual({ type: 'M', to: { x: 50, y: 50 } });
  });
});

describe('SelectCharTool: hover cursor', () => {
  const initial: PathCommand[] = [
    { type: 'M', to: { x: 0, y: 0 } },
    { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
  ];

  test('ハンドル上の hover で pointer カーソルになる', async () => {
    const { state, fabricCanvas } = await setupWithPath(initial);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(10, 0), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('pointer');
  });

  test('アンカー上の hover で move カーソルになる', async () => {
    const { state, fabricCanvas } = await setupWithPath(initial);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(100, 100), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('move');
  });

  test('空白上の hover でカーソルが空文字になる', async () => {
    const { state, fabricCanvas } = await setupWithPath(initial);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(500, 500), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });

  test('active path が無い時の hover でもカーソルが空文字になる', () => {
    const { state, fabricCanvas } = setupNoPath();
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(10, 10), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });

  test('drag 中は hover ロジックを実行しない', async () => {
    const { state, fabricCanvas } = await setupWithPath(initial);
    const tool = new SelectCharTool();
    tool.onPointerDown(pointer(0, 0), state);
    fabricCanvas.upperCanvasEl.style.cursor = 'move';
    tool.onPointerMove(pointer(500, 500), state);
    // drag 中はカーソルは hover ロジックで上書きされない
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('move');
  });
});

describe('SelectCharTool: snap (object:moving)', () => {
  // snap test は path 不要 (tool.onObjectMoving は MovingTarget のみ操作する)。
  function targetAt(left: number, top: number) {
    let l = left,
      t = top;
    return {
      getLeft: () => l,
      getTop: () => t,
      setLeft: (v: number) => {
        l = v;
      },
      setTop: (v: number) => {
        t = v;
      },
      currentLeft: () => l,
      currentTop: () => t,
    };
  }

  test('閾値内なら最近の grid 位置に snap する', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const { state } = setupNoPath();
    const t = targetAt(34, 50); // 34 → nearest 32 (dist 2 < threshold 5)
    tool.onObjectMoving(t, { altKey: false }, state);
    expect(t.currentLeft()).toBe(32);
    expect(t.currentTop()).toBe(48); // 50 → 48 (dist 2)
  });

  test('閾値外なら snap しない', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 2 });
    const { state } = setupNoPath();
    const t = targetAt(35, 35); // dist to nearest 32 = 3 >= threshold 2
    tool.onObjectMoving(t, { altKey: false }, state);
    expect(t.currentLeft()).toBe(35);
    expect(t.currentTop()).toBe(35);
  });

  test('Alt 押下中は snap をバイパスする', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const { state } = setupNoPath();
    const t = targetAt(33, 49);
    tool.onObjectMoving(t, { altKey: true }, state);
    expect(t.currentLeft()).toBe(33);
    expect(t.currentTop()).toBe(49);
  });

  test('snap 無効では何もしない', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: false, pitch: 8, threshold: 5 });
    const { state } = setupNoPath();
    const t = targetAt(33, 49);
    tool.onObjectMoving(t, { altKey: false }, state);
    expect(t.currentLeft()).toBe(33);
    expect(t.currentTop()).toBe(49);
  });
});

describe('SelectCharTool: deactivate', () => {
  test('進行中の drag をキャンセルしてカーソルもクリアする', async () => {
    const { state, fabricCanvas } = await setupWithPath([
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ]);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(100, 100), state);
    expect(tool.isDragging()).toBe(true);
    tool.onDeactivate(state);
    expect(tool.isDragging()).toBe(false);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });

  test('deactivate でアンカー選択もクリアする', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ]);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(100, 100), state);
    tool.onPointerUp(pointer(100, 100), state);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);
    tool.onDeactivate(state);
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });
});

// ── 複数アンカー選択 ──────────────────────────────────────────────────────

describe('SelectCharTool: multi-anchor selection', () => {
  function makeTriangle(): PathCommand[] {
    return [
      { type: 'M', to: { x: 0, y: 0 } }, // anchor 0
      { type: 'L', to: { x: 100, y: 0 } }, // anchor 1
      { type: 'L', to: { x: 50, y: 100 } }, // anchor 2
      { type: 'Z' },
    ];
  }

  test('単独クリックで 1 アンカーを選択できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('Shift+クリックでアンカーを追加選択できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), state);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
  });

  test('Shift+既選択アンカーのクリックで選択解除できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), state);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), state);
    // anchor 0 を Shift+解除
    tool.onPointerDown(pointer(0, 0, { shiftKey: true }), state);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([1]));
  });

  test('Shift で選択解除されたアンカーは drag に入らない', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    // Shift+同じアンカーで解除 → drag 状態にならない
    const result = tool.onPointerDown(pointer(0, 0, { shiftKey: true }), state);
    expect(result).toBe('consumed'); // hit はしたが drag 起こさず
    expect(tool.isDragging()).toBe(false);
  });

  test('未選択アンカーの通常クリックで既存選択をクリアして新規 1 個に置き換える', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), state);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), state);
    // anchor 2 を通常クリック → クリアされて anchor 2 のみ
    tool.onPointerDown(pointer(50, 100), state);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([2]));
  });

  test('既選択アンカーの通常クリックでは選択を維持して drag に入る', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), state);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), state);
    // anchor 0 (既選択) を通常クリック → 選択維持
    tool.onPointerDown(pointer(0, 0), state);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
    expect(tool.isDragging()).toBe(true);
  });

  test('空きエリアの通常クリックで選択をクリアして pass を返す', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    const result = tool.onPointerDown(pointer(500, 500), state);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });

  test('空きエリア + Shift では選択を保持して pass を返す', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    const result = tool.onPointerDown(pointer(500, 500, { shiftKey: true }), state);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('複数選択アンカーの drag で全アンカーを同じデルタで剛体移動できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    // anchor 0 と 1 を選択
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), state);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), state);

    // anchor 0 を掴んで (10, 5) drag
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerMove(pointer(10, 5), state);
    tool.onPointerUp(pointer(10, 5), state);

    // anchor 0 と 1 が両方 (10, 5) 移動。anchor 2 は不変。
    const cmds = commandsOf(state);
    expect(cmds[0]).toEqual({ type: 'M', to: { x: 10, y: 5 } });
    expect(cmds[1]).toEqual({ type: 'L', to: { x: 110, y: 5 } });
    expect(cmds[2]).toEqual({ type: 'L', to: { x: 50, y: 100 } });
  });

  test('Shift+drag で水平軸にロックして横方向のみ移動できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    // 累積 (12, 3) → |dx| > |dy| → 水平軸ロック
    tool.onPointerMove(pointer(12, 3, { shiftKey: true }), state);
    tool.onPointerUp(pointer(12, 3, { shiftKey: true }), state);

    expect(commandsOf(state)[0]).toEqual({ type: 'M', to: { x: 12, y: 0 } });
  });

  test('Shift+drag で垂直軸にロックして縦方向のみ移動できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    // 累積 (3, 12) → |dy| > |dx| → 垂直軸ロック
    tool.onPointerMove(pointer(3, 12, { shiftKey: true }), state);
    tool.onPointerUp(pointer(3, 12, { shiftKey: true }), state);

    expect(commandsOf(state)[0]).toEqual({ type: 'M', to: { x: 0, y: 12 } });
  });

  test('moveSelectedAnchorsBy で選択全アンカーを world delta で移動して history に push できる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    // anchor 0 と 2 を選択
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    tool.onPointerDown(pointer(50, 100, { shiftKey: true }), state);
    tool.onPointerUp(pointer(50, 100, { shiftKey: true }), state);

    tool.moveSelectedAnchorsBy(state, 5, 3);

    const cmds = commandsOf(state);
    expect(cmds[0]).toEqual({ type: 'M', to: { x: 5, y: 3 } });
    expect(cmds[1]).toEqual({ type: 'L', to: { x: 100, y: 0 } }); // 不変
    expect(cmds[2]).toEqual({ type: 'L', to: { x: 55, y: 103 } });
    // 上記 4 回の 0-delta drag では Command が積まれず、moveSelectedAnchorsBy 1 件のみ
    const history = state.linearizeHistory();
    expect(history).toHaveLength(1);
    expect(history[0].kind).toBe('objectChanged');
  });

  test('moveSelectedAnchorsBy: 選択ゼロでは history も path も触らない', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.moveSelectedAnchorsBy(state, 5, 3);

    expect(commandsOf(state)[0]).toEqual({ type: 'M', to: { x: 0, y: 0 } });
    expect(state.linearizeHistory()).toHaveLength(0);
  });

  test('clearSelectedAnchors() で選択をリセットできる', async () => {
    const { state } = await setupWithPath(makeTriangle());
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(0, 0), state);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    tool.clearSelectedAnchors();
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });
});
