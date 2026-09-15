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
import { Path } from '../src/window/core/path/path';
import { evalQuadAt } from '../src/window/core/path/bezier';
import { expectNoQuadratic, expectSameShape } from './path-shape-helpers';

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

  test('C 分割では外側ハンドル (前 c1 / 後 c2) が De Casteljau の値になる (L の 1/3 デフォルトは使わない)', async () => {
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

// ── 経路 2: Q (2 次) を含むパスに ＋ペン を当てたときの正規化契約 ──────────
//
// 修正前は「ドラッグした 2 セグメントだけ C、残りは Q」の混在パスになり、さらに
// 元 Q の制御点を捨てて直線用 1/3 等分点で置き換えていた (曲線が潰れる)。
// 修正後は pointerDown の時点でパス全体が C になり、形状は元 Q と完全一致する。
//
// 注: applySnapshot はロード時に Q→C 正規化するので、Q を含む live path は
// PathHandle.setPath で直接注入して「正規化前のデータを触った」状況を再現する。

const M = (x: number, y: number): PathCommand => ({ type: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ type: 'L', to: { x, y } });
const C = (
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): PathCommand => ({ type: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x, y } });
const Q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  type: 'Q',
  c: { x: cx, y: cy },
  to: { x, y },
});
const Z = (): PathCommand => ({ type: 'Z' });

async function setupWithQuadraticPath(commands: ReadonlyArray<PathCommand>): Promise<State> {
  // fixture 投入は L のダミーで行い、その後 setPath で Q 入りに差し替える
  const { state } = await setupWithPath([M(0, 0), L(1, 1)]);
  const handle = state.getActivePath();
  if (!handle) throw new Error('no active path');
  handle.setPath(new Path(commands));
  expect(commandsOf(state).map((c) => c.type)).toContain('Q'); // 前提: live path に Q がある
  return state;
}

const Q_ONLY = [M(0, 0), Q(50, -100, 100, 0), Q(50, 100, 0, 0), Z()];
const Q_AND_L = [M(0, 0), Q(50, -100, 100, 0), L(100, 100), L(0, 100), Z()];
const Q_AND_C = [M(0, 0), Q(50, -100, 100, 0), C(100, 50, 50, 100, 0, 100), Z()];

describe('PenAddTool: Q を含むパスは pointerDown でパス全体が C に正規化される', () => {
  test.each([
    ['Q のみ (M Q Q Z)', Q_ONLY],
    ['Q + L 混在', Q_AND_L],
    ['Q + C 混在', Q_AND_C],
  ])(
    '%s: Q セグメントをクリック → 触っていないセグメントも含め Q が消え、形状は不変',
    async (_name, src) => {
      const state = await setupWithQuadraticPath(src);
      const tool = new PenAddTool();

      // 1 本目の Q の頂点 B(0.5) = (50, -50) を直撃
      const apex = evalQuadAt({ x: 0, y: 0 }, { x: 50, y: -100 }, { x: 100, y: 0 }, 0.5);
      expect(tool.onPointerDown(pointer(apex.x, apex.y), state)).toBe('consumed');

      const cmds = commandsOf(state);
      expectNoQuadratic(cmds);
      expect(cmds).toHaveLength(src.length + 1); // アンカー 1 個追加
      expectSameShape(cmds, src); // 分割 + 次数上げは形状不変
      const first = cmds[1];
      expect(first.type).toBe('C');
      if (first.type === 'C') {
        expect(first.to.x).toBeCloseTo(apex.x, 6);
        expect(first.to.y).toBeCloseTo(apex.y, 6);
      }
    },
  );

  test('Q + L 混在: L セグメントをクリックしても別の Q が C に正規化される', async () => {
    const state = await setupWithQuadraticPath(Q_AND_L);
    const tool = new PenAddTool();

    expect(tool.onPointerDown(pointer(100, 50), state)).toBe('consumed'); // L(100,0)→(100,100) の中点
    const cmds = commandsOf(state);
    expectNoQuadratic(cmds);
    expect(cmds.map((c) => c.type)).toEqual(['M', 'C', 'L', 'L', 'L', 'Z']);
    expectSameShape(cmds, Q_AND_L);
  });

  test('Q + C 混在: C セグメントをクリックしても別の Q が C に正規化される', async () => {
    const state = await setupWithQuadraticPath(Q_AND_C);
    const tool = new PenAddTool();

    // C(p0=(100,0), c1=(100,50), c2=(50,100), p3=(0,100)) の B(0.5) = (68.75, 68.75)
    expect(tool.onPointerDown(pointer(68.75, 68.75), state)).toBe('consumed');
    const cmds = commandsOf(state);
    expectNoQuadratic(cmds);
    expect(cmds.map((c) => c.type)).toEqual(['M', 'C', 'C', 'C', 'Z']);
    expectSameShape(cmds, Q_AND_C);
  });

  test('回帰: Q 分割後の外側ハンドルは 2/3 次数上げ値であり、直線用 1/3 等分点ではない', async () => {
    // Q(p0=(0,0), q=(50,-100), p1=(100,0)) を C 化すると
    //   c1 = (100/3, -200/3), c2 = (200/3, -200/3)
    // これを t=0.5 で De Casteljau 分割すると
    //   前半 c1 = mid(p0, c1) = (50/3, -100/3)、後半 c2 = mid(c2, p1) = (250/3, -100/3)
    // 修正前は前半 c1 = p0 + (anchor - p0)/3 = (50/3, -50/3) (直線用) で曲線が潰れていた。
    const state = await setupWithQuadraticPath([M(0, 0), Q(50, -100, 100, 0)]);
    const tool = new PenAddTool();

    tool.onPointerDown(pointer(50, -50), state);
    tool.onPointerMove(pointer(50, -50), state); // dx = dy = 0

    const cmds = commandsOf(state);
    expectNoQuadratic(cmds);
    const first = cmds[1];
    const second = cmds[2];
    expect(first.type).toBe('C');
    expect(second.type).toBe('C');
    if (first.type === 'C') {
      expect(first.c1.x).toBeCloseTo(50 / 3, 4);
      expect(first.c1.y).toBeCloseTo(-100 / 3, 4);
      expect(first.c1.y).not.toBeCloseTo(-50 / 3, 1); // 直線用 1/3 点ではない
    }
    if (second.type === 'C') {
      expect(second.c2.x).toBeCloseTo(250 / 3, 4);
      expect(second.c2.y).toBeCloseTo(-100 / 3, 4);
    }
    // 注: 新アンカー側のハンドル (前半 c2 / 後半 c1) は dx=dy=0 だと長さ 0 になる
    // (＋ペンの「ドラッグ量 = ハンドル長」設計) ので、形状一致はここでは assert しない。
  });

  test('ドラッグ → up → undo → redo のどの地点でも Q が無い', async () => {
    const state = await setupWithQuadraticPath(Q_ONLY);
    const tool = new PenAddTool();

    tool.onPointerDown(pointer(50, -50), state);
    tool.onPointerMove(pointer(60, -70), state);
    expectNoQuadratic(commandsOf(state));
    tool.onPointerUp(pointer(60, -70), state);
    expectNoQuadratic(commandsOf(state));

    expect(state.linearizeHistory()).toHaveLength(1);

    // undo: アンカー追加前に戻るが、Q ではなく正規化済みの C に戻る
    state.undo();
    const afterUndo = commandsOf(state);
    expectNoQuadratic(afterUndo);
    expect(afterUndo).toHaveLength(Q_ONLY.length);
    expectSameShape(afterUndo, Q_ONLY);

    state.redo();
    const afterRedo = commandsOf(state);
    expectNoQuadratic(afterRedo);
    expect(afterRedo).toHaveLength(Q_ONLY.length + 1);
  });
});
