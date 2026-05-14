// PenRemoveTool の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) + fabric stub。State の public API
// (state.getActivePath()?.snapshot() / state.canUndo()) で結果を観測する。
// hover カーソルだけは fake DOM stand-in (canvas.upperCanvasEl.style.cursor) で観測。

jest.mock('../src/renderer/outline-conversion', () => ({
  outlineTextToPath: jest.fn(async () => null),
}));

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import type { PathCommand } from '../src/core/path/types';
import type { DocumentSnapshot } from '../src/core/document/snapshot';
import { State } from '../src/renderer/state';
import { PenRemoveTool } from '../src/usecases/tools/pen-remove-tool';
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

describe('PenRemoveTool', () => {
  test('アンカー上のクリックでアンカーが削除されて history に push される', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 0, y: 100 } },
      { type: 'Z' },
    ]);
    const tool = new PenRemoveTool();

    // index=1 のアンカー (100, 0) を狙う
    const r = tool.onPointerDown(pointer(100, 0), state);
    expect(r).toBe('consumed');
    expect(commandsOf(state)).toHaveLength(4); // 元 5 → アンカー 1 個分の L が消えて 4
    expect(state.canUndo()).toBe(true);
  });

  test('アンカー以外のクリックは pass を返して副作用を起こさない', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
    ]);
    const tool = new PenRemoveTool();

    const r = tool.onPointerDown(pointer(500, 500), state);
    expect(r).toBe('pass');
    expect(commandsOf(state)).toHaveLength(3);
    expect(state.canUndo()).toBe(false);
  });

  test('アンカー数下限では consumed を返すが path も history も触らない', async () => {
    const { state } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } }, // この L を削除すると M 単独になり拒否される
    ]);
    const tool = new PenRemoveTool();

    const before = commandsOf(state);
    const r = tool.onPointerDown(pointer(100, 0), state);
    // hit はあるので consumed (fabric への伝播抑止)。ただし removeAnchor が拒否するので副作用無し。
    expect(r).toBe('consumed');
    expect(commandsOf(state)).toEqual(before);
    expect(state.canUndo()).toBe(false);
  });

  test('アンカー上の hover で pointer カーソルになる', async () => {
    const { state, fabricCanvas } = await setupWithPath([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const tool = new PenRemoveTool();

    tool.onPointerMove(pointer(0, 0), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('pointer');

    tool.onPointerMove(pointer(500, 500), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });

  test('active path 無しでは hover してもカーソルが空文字になる', () => {
    const { state, fabricCanvas } = setupNoPath();
    const tool = new PenRemoveTool();
    tool.onPointerMove(pointer(0, 0), state);
    expect(fabricCanvas.upperCanvasEl.style.cursor).toBe('');
  });
});
