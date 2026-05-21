// PenAddTool の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) + fabric stub を使い、State の
// public API (state.getActivePath()?.snapshot() / state.canUndo() / state.linearizeHistory())
// で観測する。FakePathHandle の internal counter (finalizeCount 等) には依存しない。
// hover カーソルだけは fake DOM stand-in (canvas.upperCanvasEl.style.cursor) で観測。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import type { PathCommand } from '../src/window/core/path/types';
import type { DocumentSnapshot } from '../src/window/core/document/snapshot';
import { State } from '../src/window/presenter/state';
import { PenAddTool } from '../src/window/usecases/tools/pen-add-tool';
import { toFabricPath } from '../src/window/presenter/path-adapter';
import { pointer, NullFontProvider } from './fakes';

async function setupWithPath(commands: ReadonlyArray<PathCommand>): Promise<{
  state: State;
  fabricCanvas: FakeFabricCanvas;
}> {
  const fabricCanvas = new FakeFabricCanvas();
  const state = new State(fabricCanvas as never, new NullFontProvider());
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

describe('PenAddTool: split + drag', () => {
  test('L セグメント中点クリックでアンカーを追加し、pointerUp で history に push される', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const tool = new PenAddTool();

    const r = tool.onPointerDown(pointer(50, 0), state);
    expect(r).toBe('consumed');
    expect(tool.isDragging()).toBe(true);
    // 分割直後は L の真ん中が C 化されている (handles はドラッグ前ゼロ相当だが、L→C 変換中)
    expect(commandsOf(state)).toHaveLength(3);

    // ドラッグなしで up しても finalize して history に積む (split で commands は既に変化済)
    tool.onPointerUp(pointer(50, 0), state);
    expect(tool.isDragging()).toBe(false);
    expect(state.canUndo()).toBe(true);
    const history = state.linearizeHistory();
    expect(history).toHaveLength(1);
    expect(history[0].kind).toBe('objectChanged');
  });

  test('セグメントから外れた点は pass を返して path も history も触らない', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const tool = new PenAddTool();

    const r = tool.onPointerDown(pointer(50, 100), state);
    expect(r).toBe('pass');
    expect(tool.isDragging()).toBe(false);
    expect(commandsOf(state)).toHaveLength(2);
    expect(state.canUndo()).toBe(false);
  });

  test('split 後のドラッグで新アンカー周りのハンドルが対称に伸びる', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const tool = new PenAddTool();

    tool.onPointerDown(pointer(50, 0), state); // 新アンカー = (50, 0)
    tool.onPointerMove(pointer(50, 30), state); // 下方向に 30 ドラッグ

    // 前半 cmdIndex 1: c2 = anchor - d = (50, 0) - (0, 30) = (50, -30)
    // 後半 cmdIndex 2: c1 = anchor + d = (50, 0) + (0, 30) = (50, 30)
    const cmds = commandsOf(state);
    const first = cmds[1];
    const second = cmds[2];
    expect(first.type).toBe('C');
    expect(second.type).toBe('C');
    if (first.type === 'C') expect(first.c2).toEqual({ x: 50, y: -30 });
    if (second.type === 'C') expect(second.c1).toEqual({ x: 50, y: 30 });
  });

  test('C 分割では外側ハンドル (前 c1 / 後 c2) が De Casteljau の値になる (L/Q の 1/3 デフォルトは使わない)', async () => {
    // p0=(0,0), c1=(0,-50), c2=(100,-50), p3=(100,0) の C を t=0.5 で分割すると、
    // De Casteljau により前半 c1=(0,-25)、後半 c2=(100,-25) となる。
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 0, y: -50 }, c2: { x: 100, y: -50 }, to: { x: 100, y: 0 } },
    ]);
    const tool = new PenAddTool();

    // C カーブの頂点 (50, -37.5) = B(0.5) を直撃
    tool.onPointerDown(pointer(50, -37.5), state);
    tool.onPointerMove(pointer(50, -37.5), state); // ドラッグ無し → dx=dy=0

    const cmds = commandsOf(state);
    const first = cmds[1];
    const second = cmds[2];
    expect(first.type).toBe('C');
    expect(second.type).toBe('C');
    if (first.type === 'C') {
      expect(first.c1.x).toBeCloseTo(0, 3);
      expect(first.c1.y).toBeCloseTo(-25, 3);
    }
    if (second.type === 'C') {
      expect(second.c2.x).toBeCloseTo(100, 3);
      expect(second.c2.y).toBeCloseTo(-25, 3);
    }
  });

  test('hover でセグメント上は copy カーソル、外では空文字になる', async () => {
    const { state, fabricCanvas } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const tool = new PenAddTool();

    tool.onPointerMove(pointer(50, 0), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('copy');

    tool.onPointerMove(pointer(50, 100), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });
});
