// HandTool (中ボタン drag pan) の test。
//
// 検証方針: real `class State` + fabric stub。pan の結果は State の public API
// (getViewportMatrix) で観測、cursor は stub の upperCanvasEl.style.cursor で観測。
// HandTool は screenX/Y しか読まないので pointer() の screen == world 前提で問題ない。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { HandTool } from '../src/window/usecases/tools/hand-tool';
import { State } from '../src/window/presenter/state';
import { NullFontProvider, pointer } from './fakes';

function setup(): { tool: HandTool; state: State; canvas: FakeFabricCanvas } {
  const canvas = new FakeFabricCanvas();
  const state = new State(canvas as never, new NullFontProvider());
  return { tool: new HandTool(), state, canvas };
}

describe('HandTool', () => {
  test('onPointerDown は consumed を返し drag 開始 + grabbing カーソル', () => {
    const { tool, state, canvas } = setup();
    expect(tool.onPointerDown(pointer(100, 50), state)).toBe('consumed');
    expect(tool.isDragging()).toBe(true);
    expect(canvas.upperCanvasEl.style.cursor).toBe('grabbing');
  });

  test('down → move で viewport が screen delta 分だけ pan する (incremental 累積)', () => {
    const { tool, state } = setup();
    tool.onPointerDown(pointer(100, 100), state);
    tool.onPointerMove(pointer(130, 90), state);
    tool.onPointerMove(pointer(135, 95), state);
    const m = state.getViewportMatrix();
    expect(m[4]).toBe(35); // (130-100) + (135-130)
    expect(m[5]).toBe(-5); // (90-100) + (95-90)
  });

  test('onPointerUp で drag 終了 + カーソル復帰', () => {
    const { tool, state, canvas } = setup();
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerUp(pointer(10, 10), state);
    expect(tool.isDragging()).toBe(false);
    expect(canvas.upperCanvasEl.style.cursor).toBe('');
  });

  test('down なしの move (hover) では viewport が動かない', () => {
    const { tool, state } = setup();
    tool.onPointerMove(pointer(50, 50), state);
    const m = state.getViewportMatrix();
    expect(m[4]).toBe(0);
    expect(m[5]).toBe(0);
  });

  test('pan は camera 層操作なので history に乗らない', () => {
    const { tool, state } = setup();
    const before = state.getHistoryToken();
    tool.onPointerDown(pointer(0, 0), state);
    tool.onPointerMove(pointer(100, 100), state);
    tool.onPointerUp(pointer(100, 100), state);
    expect(state.getHistoryToken()).toBe(before);
    expect(state.canUndo()).toBe(false);
  });

  test('onDeactivate は drag 状態とカーソルをリセットする (安全側)', () => {
    const { tool, state, canvas } = setup();
    tool.onPointerDown(pointer(0, 0), state);
    tool.onDeactivate(state);
    expect(tool.isDragging()).toBe(false);
    expect(canvas.upperCanvasEl.style.cursor).toBe('');
  });
});
