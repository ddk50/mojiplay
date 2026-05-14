// State の business method (applyPropsToSelection / setMode / clearAll / commit
// 経由の IText splitting) の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) に fabric stub を渡し、
// state の public API (toSnapshot / linearizeHistory / getCurrentMode 等) で結果を観測する。

jest.mock('../src/renderer/outline-conversion', () => ({
  outlineTextToPath: jest.fn(async () => null),
}));

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { State } from '../src/renderer/state';
import type { Mode } from '../src/core/state-interface';

function setupWithText(): { state: State; canvas: FakeFabricCanvas } {
  const canvas = new FakeFabricCanvas();
  const state = new State(canvas as never);
  return { state, canvas };
}

async function loadFixture(state: State, objects: Record<string, unknown>[]): Promise<void> {
  await state.applySnapshot({
    format: 'mojiplay',
    version: 1,
    canvas: { objects } as unknown,
  });
}

describe('State.applyPropsToSelection', () => {
  test('選択中 object に property を適用し、history に push する', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      {
        type: 'text',
        text: 'A',
        left: 0,
        top: 0,
        fontSize: 72,
        fill: '#000',
        data: { objectId: 'id1', type: 'text' },
      },
    ]);
    const obj = (canvas.getObjects() as any)[0];
    canvas.setActiveObject(obj);

    const tokenBefore = state.getHistoryToken();
    state.applyPropsToSelection({ fontSize: 100, fill: '#ff0000' });

    expect(state.getHistoryToken()).toBeGreaterThan(tokenBefore);
    expect(obj.fontSize).toBe(100);
    expect(obj.fill).toBe('#ff0000');

    const cmds = state.linearizeHistory();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ kind: 'objectChanged' });
  });

  test('選択無しなら no-op (history も無変化)', async () => {
    const { state } = setupWithText();
    const tokenBefore = state.getHistoryToken();
    state.applyPropsToSelection({ fontSize: 100 });
    expect(state.getHistoryToken()).toBe(tokenBefore);
  });

  test('差分ゼロなら history に push しない (no-op skip)', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      { type: 'text', text: 'A', fontSize: 72, data: { objectId: 'id1', type: 'text' } },
    ]);
    const obj = (canvas.getObjects() as any)[0];
    canvas.setActiveObject(obj);

    const tokenBefore = state.getHistoryToken();
    state.applyPropsToSelection({ fontSize: 72 });
    expect(state.getHistoryToken()).toBe(tokenBefore);
    expect(state.linearizeHistory()).toHaveLength(0);
  });

  test('複数選択 → compound として 1 push', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      { type: 'text', text: 'A', fontSize: 72, data: { objectId: 'id1', type: 'text' } },
      { type: 'text', text: 'B', fontSize: 72, data: { objectId: 'id2', type: 'text' } },
    ]);
    const objs = canvas.getObjects() as any[];
    const fabricNS = (globalThis as any).fabric;
    const sel = new fabricNS.ActiveSelection(objs, { canvas });
    canvas.setActiveObject(sel);

    state.applyPropsToSelection({ fontSize: 100 });

    const cmds = state.linearizeHistory();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ kind: 'compound' });
    expect((cmds[0] as any).commands).toHaveLength(2);
  });
});

describe('State.setMode / getCurrentMode', () => {
  test('setMode で getCurrentMode が更新される', () => {
    const { state } = setupWithText();
    expect(state.getCurrentMode()).toBe('select-group');
    state.setMode('text');
    expect(state.getCurrentMode()).toBe('text');
    state.setMode('select-char');
    expect(state.getCurrentMode()).toBe('select-char');
  });

  test('select-group mode では全 object が selectable=true', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      {
        type: 'text',
        text: 'A',
        selectable: false,
        evented: false,
        data: { objectId: 'id1', type: 'text' },
      },
    ]);
    state.setMode('select-group');
    const obj = (canvas.getObjects() as any)[0];
    expect(obj.selectable).toBe(true);
    expect(obj.evented).toBe(true);
  });

  test('text mode では全 object が selectable=false', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      {
        type: 'text',
        text: 'A',
        selectable: true,
        evented: true,
        data: { objectId: 'id1', type: 'text' },
      },
    ]);
    state.setMode('text');
    const obj = (canvas.getObjects() as any)[0];
    expect(obj.selectable).toBe(false);
    expect(obj.evented).toBe(false);
  });

  test('text モードに切り替えると active object を破棄する', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      { type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } },
    ]);
    canvas.setActiveObject((canvas.getObjects() as any)[0]);
    state.setMode('text');
    expect(canvas.getActiveObject()).toBeNull();
  });

  test('pen-add モード切替では選択中パスを維持する (discardActiveObject しない)', async () => {
    const { state, canvas } = setupWithText();
    await loadFixture(state, [
      {
        type: 'path',
        path: [
          ['M', 0, 0],
          ['L', 10, 10],
        ],
        data: { objectId: 'id1', type: 'path', outlined: true },
      },
    ]);
    canvas.setActiveObject((canvas.getObjects() as any)[0]);
    state.setMode('pen-add');
    expect(canvas.getActiveObject()).not.toBeNull();
  });
});

describe('State.clearAll', () => {
  test('全 object を消去する', async () => {
    const { state } = setupWithText();
    await loadFixture(state, [
      { type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } },
      { type: 'text', text: 'B', data: { objectId: 'id2', type: 'text' } },
    ]);
    expect(state.getAllObjects()).toHaveLength(2);
    state.clearAll();
    expect(state.getAllObjects()).toHaveLength(0);
  });
});

describe('State.handleTextEditingExited (IText splitting)', () => {
  test('IText を 1 文字ずつの fabric.Text に分割し、compound を push', () => {
    const { state, canvas } = setupWithText();
    const fabricNS = (globalThis as any).fabric;

    // ユーザが IText を編集して "AB" を入力した状態を simulate
    const it = new fabricNS.IText('AB', {
      left: 0,
      top: 0,
      fontFamily: 'Arial',
      fontSize: 72,
      fontWeight: 400,
      fontStyle: 'normal',
      fill: '#000',
    });
    // production の initDimensions が populate するフィールドを test 側で事前にセット
    it._textLines = [['A', 'B']];
    it.__charBounds = [
      [
        { left: 0, width: 50 },
        { left: 50, width: 50 },
      ],
    ];
    canvas.add(it);
    canvas.setActiveObject(it);

    const tokenBefore = state.getHistoryToken();

    // text:editing:exited を発火 → State の private hook が分割する
    canvas.fire('text:editing:exited', { target: it });

    // IText 自体は消え、各文字が fabric.Text として残る
    const objs = state.getAllObjects();
    expect(objs).toHaveLength(2);
    const snap = state.toSnapshot() as { canvas: { objects: any[] } };
    expect(snap.canvas.objects[0]).toMatchObject({ type: 'text', text: 'A', left: 0 });
    expect(snap.canvas.objects[1]).toMatchObject({ type: 'text', text: 'B', left: 50 });

    // history に compound として push されている
    expect(state.getHistoryToken()).toBeGreaterThan(tokenBefore);
    const cmds = state.linearizeHistory();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ kind: 'compound' });
    expect((cmds[0] as any).commands).toHaveLength(2);
  });

  test('text モード中の commit では新しい char の selectable=false に', () => {
    const { state, canvas } = setupWithText();
    state.setMode('text');
    const fabricNS = (globalThis as any).fabric;

    const it = new fabricNS.IText('A', {
      left: 0,
      top: 0,
      fontFamily: 'Arial',
      fontSize: 72,
    });
    it._textLines = [['A']];
    it.__charBounds = [[{ left: 0, width: 50 }]];
    canvas.add(it);

    canvas.fire('text:editing:exited', { target: it });

    const obj = (canvas.getObjects() as any).find((o: any) => o.type === 'text');
    expect(obj.selectable).toBe(false);
    expect(obj.evented).toBe(false);
  });

  test('空文字 commit では何も生成せず IText だけ消える', () => {
    const { state, canvas } = setupWithText();
    const fabricNS = (globalThis as any).fabric;
    const it = new fabricNS.IText('   ', { left: 0, top: 0 });
    it._textLines = [[' ', ' ', ' ']];
    it.__charBounds = [
      [
        { left: 0, width: 10 },
        { left: 10, width: 10 },
        { left: 20, width: 10 },
      ],
    ];
    canvas.add(it);
    canvas.fire('text:editing:exited', { target: it });

    expect(state.getAllObjects()).toHaveLength(0);
    expect(state.linearizeHistory()).toHaveLength(0);
  });
});

describe('State.clearOverlay', () => {
  test('clearOverlay は contextTop を取れない場合でもエラーにならない', () => {
    const { state } = setupWithText();
    // FakeFabricCanvas には contextTop が無いので clearOverlay は no-op
    expect(() => state.clearOverlay()).not.toThrow();
  });
});

const ALL_MODES: Mode[] = ['select-group', 'select-char', 'text', 'pen-add', 'pen-remove'];

describe('Mode 列挙', () => {
  test('すべての Mode で setMode が動作する (sanity check)', () => {
    const { state } = setupWithText();
    for (const m of ALL_MODES) {
      state.setMode(m);
      expect(state.getCurrentMode()).toBe(m);
    }
  });
});
