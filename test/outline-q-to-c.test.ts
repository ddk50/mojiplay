// 経路 1: アウトライン化 → 保存 (.mply) → ロード で Q が残らない契約の通しテスト。
//
// 背景: fontkit は TrueType (glyf) フォントを Q (2 次ベジェ) で返す。Q は制御点を
// 前後アンカーで共有するためハンドル IF が ＋ペン (C, 3 次) と食い違っていた。
// 修正後の正規形は C。アウトライン化直後 / 保存形式 / ロード後 / 旧ファイル /
// undo → redo のどの地点でも Q が無く、かつ曲線形状が元と一致することを固定する。
//
// real `class State` + fabric stub (文字列 path 対応済み) + FixedFontProvider。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import type { PathCommand } from '../src/window/core/path/types';
import type { DocumentSnapshot } from '../src/window/core/document/snapshot';
import { State } from '../src/window/presenter/state';
import { PenAddTool } from '../src/window/usecases/tools/pen-add-tool';
import { toFabricPath } from '../src/window/presenter/path-adapter';
import { FixedFontProvider, NullFontProvider, pointer } from './fakes';
import {
  expectNoQuadratic,
  expectNoQuadraticTuple,
  expectSameShape,
  toSvgD,
} from './path-shape-helpers';

const M = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  type: 'Q',
  c: { x: cx, y: cy },
  to: { x, y },
});
const Z = (): PathCommand => ({ type: 'Z' });

// TrueType 風グリフ: 外形は Q で閉じる contour (最後の Q.to == M)、
// 内側 (カウンター) は Q + Z 直線 close の contour。
const TRUETYPE_GLYPH: ReadonlyArray<PathCommand> = [
  M(0, 0),
  Q(50, -120, 100, 0),
  Q(50, 40, 0, 0),
  Z(),
  M(30, -20),
  Q(50, -60, 70, -20),
  L(50, -10),
  Z(),
];

type RawPathObject = { type: string; path: unknown[][]; data: Record<string, unknown> };
function snapshotObjects(state: State): RawPathObject[] {
  return (state.toSnapshot() as { canvas: { objects: RawPathObject[] } }).canvas.objects;
}

function activeCommands(state: State): ReadonlyArray<PathCommand> {
  const p = state.getActivePath();
  if (!p) throw new Error('no active outlined path');
  return p.snapshot().path.commands;
}

/** 唯一の object を選択して outlined path の commands を返す。 */
function selectOnlyPath(state: State): ReadonlyArray<PathCommand> {
  const all = state.getAllObjects();
  expect(all).toHaveLength(1);
  state.setActiveSelection(all);
  return activeCommands(state);
}

async function outlineOneChar(glyph: ReadonlyArray<PathCommand>): Promise<State> {
  const canvas = new FakeFabricCanvas();
  const state = new State(canvas as never, new FixedFontProvider(toSvgD(glyph)));
  await state.applySnapshot({
    format: 'mojiplay',
    version: 1,
    canvas: {
      objects: [
        {
          type: 'text',
          text: 'あ',
          fontFamily: 'Meiryo',
          fontSize: 100,
          left: 10,
          top: 20,
          data: { objectId: 't1', type: 'text', groupId: 'g1', charIndex: 0, sourceText: 'あ' },
        },
      ],
    } as unknown,
  });
  state.setActiveSelection(state.getAllObjects());
  const r = await state.outlineActiveTexts();
  expect(r.succeeded).toBe(1);
  return state;
}

describe('経路 1: アウトライン化 → 保存 → ロード (Q→C 正規化の契約)', () => {
  test('アウトライン化直後の path に Q が無く、形状は fontkit の Q 曲線と一致する', async () => {
    const state = await outlineOneChar(TRUETYPE_GLYPH);
    const cmds = selectOnlyPath(state);
    expectNoQuadratic(cmds);
    expectSameShape(cmds, TRUETYPE_GLYPH);
    // 曲線は全て C になっている (L / Z は維持)
    expect(cmds.map((c) => c.type)).toEqual(['M', 'C', 'C', 'Z', 'M', 'C', 'L', 'Z']);
  });

  test('保存形式 (toSnapshot = .mply の中身) の path タプルに Q が書かれない', async () => {
    const state = await outlineOneChar(TRUETYPE_GLYPH);
    const objs = snapshotObjects(state);
    expect(objs).toHaveLength(1);
    expect(objs[0].type).toBe('path');
    expect(objs[0].data.outlined).toBe(true);
    expectNoQuadraticTuple(objs[0].path);
  });

  test('保存 → 別 State (= 再起動) で applySnapshot しても Q が無く形状が一致する', async () => {
    const saved = (await outlineOneChar(TRUETYPE_GLYPH)).toSnapshot();

    const state2 = new State(new FakeFabricCanvas() as never, new NullFontProvider());
    await state2.applySnapshot(saved);
    const cmds = selectOnlyPath(state2);
    expectNoQuadratic(cmds);
    expectSameShape(cmds, TRUETYPE_GLYPH);
    // ロード直後は clean (履歴無し)
    expect(state2.canUndo()).toBe(false);
    expect(state2.linearizeHistory()).toHaveLength(0);
  });

  test('旧ファイル互換: Q タプルで保存された outlined path はロード時に C になる (history / dirty に乗らない)', async () => {
    const legacy: DocumentSnapshot = {
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [
          {
            type: 'path',
            path: toFabricPath(TRUETYPE_GLYPH), // 'Q' タプルをそのまま含む
            data: { objectId: 'p-legacy', type: 'path', outlined: true },
            left: 0,
            top: 0,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
            pathOffset: { x: 0, y: 0 },
          },
        ],
      } as unknown,
    };
    const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
    await state.applySnapshot(legacy);
    const tokenAfterLoad = state.getHistoryToken();

    const cmds = selectOnlyPath(state);
    expectNoQuadratic(cmds);
    expectSameShape(cmds, TRUETYPE_GLYPH);

    expect(state.canUndo()).toBe(false);
    expect(state.linearizeHistory()).toHaveLength(0);
    expect(state.getHistoryToken()).toBe(tokenAfterLoad);
    // 再保存しても Q は書かれない
    expectNoQuadraticTuple(snapshotObjects(state)[0].path);
  });

  test('outlined でない path (手描き等) はロード時に触らない', async () => {
    const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [
          {
            type: 'path',
            path: toFabricPath([M(0, 0), Q(50, -50, 100, 0)]),
            data: { objectId: 'p-raw', type: 'path' },
            left: 0,
            top: 0,
          },
        ],
      } as unknown,
    });
    const objs = snapshotObjects(state);
    expect(objs[0].path.map((r) => r[0])).toEqual(['M', 'Q']);
  });

  test('アウトライン化 → undo → redo の後も Q が無い (objectCreated.after が C)', async () => {
    const state = await outlineOneChar(TRUETYPE_GLYPH);
    expect(state.canUndo()).toBe(true);

    state.undo();
    // text に戻る
    expect(snapshotObjects(state)[0].type).toBe('text');

    state.redo();
    const cmds = selectOnlyPath(state);
    expectNoQuadratic(cmds);
    expectSameShape(cmds, TRUETYPE_GLYPH);
  });
});

describe('経路 1 + 2 複合: アウトライン化 → ＋ペン → 保存 → ロード', () => {
  test('どの地点でも Q が無い', async () => {
    const state = await outlineOneChar(TRUETYPE_GLYPH);
    selectOnlyPath(state);

    // 外形 1 本目の曲線の頂点付近 (元 Q の B(0.5) = (50, -60)) にアンカーを追加してドラッグ
    const tool = new PenAddTool();
    expect(tool.onPointerDown(pointer(50, -60), state)).toBe('consumed');
    expectNoQuadratic(activeCommands(state));
    tool.onPointerMove(pointer(60, -70), state);
    expectNoQuadratic(activeCommands(state));
    tool.onPointerUp(pointer(60, -70), state);
    expectNoQuadratic(activeCommands(state));
    // アンカーが 1 個増えている (C が 1 本増える)
    expect(activeCommands(state).filter((c) => c.type === 'C')).toHaveLength(4);

    state.undo();
    expectNoQuadratic(activeCommands(state));
    state.redo();
    expectNoQuadratic(activeCommands(state));

    const saved = state.toSnapshot();
    expectNoQuadraticTuple(snapshotObjects(state)[0].path);

    const state2 = new State(new FakeFabricCanvas() as never, new NullFontProvider());
    await state2.applySnapshot(saved);
    expectNoQuadratic(selectOnlyPath(state2));
  });
});
