// SelectGroupTool (黒矢印) の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) に fabric の minimal stub を渡し、
// **State の public API のみ** を経由して操作・観測する。canvas (fabric stub) は
// State の constructor に渡す以外触らない。
// 中核ロジック (computeGroupExpansion) の独立 test はここに統合済 (Tool 経由でカバー)。
//
// 何故 FakeState を使わないか:
//   FakeState で setActiveSelection を「呼ばれた objs を this.active に格納するだけ」
//   と実装すると、`tool が setActiveSelection を呼んだか` を assertion するだけの
//   tautology になる。production code (= class State の WeakMap canonicalization /
//   ActiveSelection 構築 / discard→setActive 経路) は一切踏まれない。
//   fabric は外部依存なので fake にするのは妥当だが、State は production の唯一の
//   実装なので real を使う。
//
// 何故 canvas (fabric stub) を直接いじらないか:
//   canvas は production では State の中に encapsulate されており外から見えない。
//   test だけが canvas.add() / canvas.getActiveObjects() を呼ぶと、State の
//   「外から見える振る舞い」ではなく「内部で何が起きてるか」を test することになり、
//   実装の peek (= leakage) になる。fixture も assertion も全て State の public
//   API 経由で行う。

// State は outline-conversion 経由で font-enumeration を import し、後者は top-level で
// document.getElementById を呼ぶため testEnvironment: 'node' で爆発する。SelectGroup
// path では outline-conversion を一切触らないので module ごと stub する。
jest.mock('../src/renderer/outline-conversion', () => ({
  outlineTextToPath: jest.fn(async () => null),
}));

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { State } from '../src/renderer/state';
import { SelectGroupTool } from '../src/usecases/tools/select-group-tool';
import type { DocumentSnapshot } from '../src/core/document/snapshot';

/**
 * State.applySnapshot 経由で text オブジェクト群を投入する fixture helper。
 * 「test も canvas を直接触らず、State の public API 経由で seed する」方針の都合上、
 * 永続化形式を使ってロードする (production の「.mply ファイルを開く」パスと同じ経路)。
 */
async function seedTexts(state: State, groupIds: ReadonlyArray<string | undefined>): Promise<void> {
  const snapshot: DocumentSnapshot = {
    format: 'mojiplay',
    version: 1,
    canvas: {
      objects: groupIds.map(gid => ({
        type: 'text',
        data: gid !== undefined ? { groupId: gid } : {},
      })),
    },
  };
  await state.applySnapshot(snapshot);
}

function setup() {
  const state = new State(new FakeFabricCanvas() as never);
  const tool = new SelectGroupTool();
  return { state, tool };
}

describe('SelectGroupTool', () => {
  test('1 文字選択を group 全体に展開する', async () => {
    const { state, tool } = setup();
    await seedTexts(state, ['g1', 'g1', 'g1', 'g2']);
    const [aH, bH, cH] = state.getAllObjects();
    state.setActiveSelection([aH]);

    tool.onSelectionChanged(state);

    expect(state.getActiveObjects()).toEqual([aH, bH, cH]);
  });

  test('複数 group を跨ぐ marquee は両方の group を展開する', async () => {
    const { state, tool } = setup();
    await seedTexts(state, ['g1', 'g1', 'g2', 'g2']);
    const [a1H, a2H, b1H, b2H] = state.getAllObjects();
    state.setActiveSelection([a1H, b1H]);

    tool.onSelectionChanged(state);

    expect(state.getActiveObjects()).toEqual([a1H, a2H, b1H, b2H]);
  });

  test('既に group 全体が選択済みなら active selection は変化しない', async () => {
    const { state, tool } = setup();
    await seedTexts(state, ['g1', 'g1']);
    const [aH, bH] = state.getAllObjects();
    state.setActiveSelection([aH, bH]);

    tool.onSelectionChanged(state);

    expect(state.getActiveObjects()).toEqual([aH, bH]);
  });

  test('groupId を持たない object のみの選択は no-op', async () => {
    const { state, tool } = setup();
    await seedTexts(state, [undefined]);
    const [loneH] = state.getAllObjects();
    state.setActiveSelection([loneH]);

    tool.onSelectionChanged(state);

    expect(state.getActiveObjects()).toEqual([loneH]);
  });

  test('空選択は no-op', () => {
    const { state, tool } = setup();

    tool.onSelectionChanged(state);

    expect(state.getActiveObjects()).toEqual([]);
  });

  // ── canonical handle 契約の回帰テスト ─────────────────────────────────────
  //
  // fabric は setActiveObject 呼び出しで selection:created / selection:updated /
  // selection:cleared を発火する。app.ts は selection 系 event を受けて
  // tool.onSelectionChanged を呼ぶ wiring になっており、SelectGroupTool 自身が
  // setActiveSelection で selection を変える → 再発火 → onSelectionChanged 再呼出、
  // という循環構造が走る。
  //
  // SelectGroupTool は alreadyExpanded 判定 (ObjectHandle の identity 比較) で再帰を
  // 1 ステップで止めるが、これは State 側が「同じ underlying fabric.Object に対して
  // 同じ ObjectHandle instance を返す canonical 化」(WeakMap キャッシュ) を実装
  // している前提。これが破綻すると無限再帰し、production fabric では stack overflow、
  // 副作用として fabric の drag state が破壊される (mouseup で選択解除されない /
  // 文字が画面外に飛ぶ等)。
  //
  // この test は real State の canonicalization が機能していることを、fabric の
  // selection event 再発火を実際にシミュレートして確認する。fabric stub には event
  // dispatch depth guard があるので、再帰が暴走したら throw が出て検出される
  // (= 観測点は State レベルの「処理が終わるか」であって stub の counter ではない)。
  //
  // ここだけは「app.ts が selection event を tool に転送する」という外部 wiring を
  // 模擬する都合上、fabric stub の `on(...)` を直接叩く。production の app.ts と
  // 等価な配線であり、State 内部の peek ではない。

  test('selection event 再発火下でも 1 ステップで再帰が止まる', async () => {
    const fabricCanvas = new FakeFabricCanvas();
    const state = new State(fabricCanvas as never);
    const tool = new SelectGroupTool();

    await seedTexts(state, ['g1', 'g1', 'g1']);
    const [aH, bH, cH] = state.getAllObjects();

    // app.ts と同じく selection event を tool に転送する wiring を再現
    fabricCanvas.on('selection:created', () => tool.onSelectionChanged(state));
    fabricCanvas.on('selection:updated', () => tool.onSelectionChanged(state));

    // 1 文字選択 → fabric が selection:created を再発火 → tool.onSelectionChanged →
    // 展開 → setActiveSelection → discardActiveObject (selection:cleared) →
    // setActiveObject (selection:created) → tool.onSelectionChanged → alreadyExpanded
    // で停止。canonicalization が壊れていれば fabric stub の depth guard で throw する。
    expect(() => state.setActiveSelection([aH])).not.toThrow();

    expect(state.getActiveObjects()).toEqual([aH, bH, cH]);
  });
});
