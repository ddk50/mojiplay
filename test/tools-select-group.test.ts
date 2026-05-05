// SelectGroupTool (黒矢印) の単体テスト。
// FakeToolHost に getActiveObjects / getAllObjects / setActiveSelection を実装し、
// 展開の有無と再帰防止を検証する。

interface ObjectHandle { getGroupId(): string | undefined }

interface ToolHost {
  getActiveObjects(): ReadonlyArray<ObjectHandle>;
  getAllObjects():    ReadonlyArray<ObjectHandle>;
  setActiveSelection(objs: ReadonlyArray<ObjectHandle>): void;
  // 他はテストで使わないので any で受ける
  getActivePath():    any;
  getViewportMatrix():any;
  requestRerender():  void;
  setCursor(c: string): void;
  createTextAt(...args: any[]): void;
}

interface SelectGroupToolI {
  onSelectionChanged(host: ToolHost): void;
}

const { SelectGroupTool } = require('../src/core/tools/select-group-tool') as {
  SelectGroupTool: new () => SelectGroupToolI;
};

function makeHandle(gid?: string): ObjectHandle {
  return { getGroupId: () => gid };
}

class FakeHost implements ToolHost {
  public active: ObjectHandle[] = [];
  public all:    ObjectHandle[] = [];
  public setSelectionCalls: ObjectHandle[][] = [];
  getActiveObjects() { return this.active; }
  getAllObjects()    { return this.all; }
  setActiveSelection(objs: ReadonlyArray<ObjectHandle>): void {
    this.setSelectionCalls.push(objs.slice());
    this.active = objs.slice();  // 反映だけ簡易シミュレート
  }
  getActivePath()     { return null; }
  getViewportMatrix() { return [1, 0, 0, 1, 0, 0] as const; }
  requestRerender()   { /* no-op */ }
  setCursor(_c: string) { /* no-op */ }
  createTextAt() { /* no-op */ }
}

describe('SelectGroupTool', () => {
  test('1 文字選択を group 全体に展開', () => {
    const a = makeHandle('g1');
    const b = makeHandle('g1');
    const c = makeHandle('g1');
    const x = makeHandle('g2');
    const tool = new SelectGroupTool();
    const host = new FakeHost();
    host.active = [a];
    host.all    = [a, b, c, x];

    tool.onSelectionChanged(host);

    expect(host.setSelectionCalls).toHaveLength(1);
    expect(host.setSelectionCalls[0]).toEqual([a, b, c]);
  });

  test('既に group 全体が選択されていれば setActiveSelection を呼ばない (再帰防止)', () => {
    const a = makeHandle('g1');
    const b = makeHandle('g1');
    const tool = new SelectGroupTool();
    const host = new FakeHost();
    host.active = [a, b];
    host.all    = [a, b];

    tool.onSelectionChanged(host);
    expect(host.setSelectionCalls).toHaveLength(0);
  });

  test('複数 group をまたぐ marquee は両方を展開', () => {
    const a1 = makeHandle('g1');
    const a2 = makeHandle('g1');
    const b1 = makeHandle('g2');
    const b2 = makeHandle('g2');
    const tool = new SelectGroupTool();
    const host = new FakeHost();
    host.active = [a1, b1];
    host.all    = [a1, a2, b1, b2];

    tool.onSelectionChanged(host);
    expect(host.setSelectionCalls[0]).toEqual([a1, a2, b1, b2]);
  });

  test('groupId を持たないオブジェクトのみ選択 → no-op', () => {
    const lone = makeHandle(undefined);
    const tool = new SelectGroupTool();
    const host = new FakeHost();
    host.active = [lone];
    host.all    = [lone];

    tool.onSelectionChanged(host);
    expect(host.setSelectionCalls).toHaveLength(0);
  });

  test('空選択は no-op', () => {
    const tool = new SelectGroupTool();
    const host = new FakeHost();
    tool.onSelectionChanged(host);
    expect(host.setSelectionCalls).toHaveLength(0);
  });
});

// ── canonical handle 契約テスト (回帰防止) ─────────────────────────────────
//
// fabric は setActiveObject 呼び出しで selection:cleared / selection:created /
// selection:updated を再発火する。本ツールは selection 系イベントから呼ばれるので、
// host.setActiveSelection の中で実質的に onSelectionChanged が再帰呼び出しされる
// 形になる。
//
// SelectGroupTool は「すでに展開済みなら no-op」判定で再帰を止めるが、これは
// ObjectHandle の identity (===) 比較に依存している。ToolHost 実装側 (app.ts)
// は同じ underlying object に対して同じ handle instance を返す canonical 化が
// 必要。これを怠ると無限再帰し fabric の drag state が破壊される
// (mouseup で選択解除されない / 文字が画面外に飛ぶ等の症状)。
//
// 本ブロックは canonical / non-canonical 両方を fake host で再現し、契約を
// 満たさない場合に再帰が止まらないことを明示的にテストする。

interface RecursingHost extends ToolHost {
  active: ObjectHandle[];
  recursionDepth: number;
}

describe('SelectGroupTool: canonical handle contract (回帰テスト)', () => {
  test('canonical な host: setActiveSelection 再帰が 1 ステップで安定する', () => {
    const a = makeHandle('g1');
    const b = makeHandle('g1');
    const c = makeHandle('g1');
    const all = [a, b, c];

    const tool = new SelectGroupTool();
    const host: RecursingHost = {
      active: [a],
      recursionDepth: 0,
      getActiveObjects() { return this.active; },
      getAllObjects()    { return all; },
      setActiveSelection(objs) {
        this.recursionDepth++;
        if (this.recursionDepth > 10) throw new Error('infinite recursion');
        this.active = objs.slice();
        // fabric の selection:updated 再発火をシミュレート
        tool.onSelectionChanged(this);
      },
      // 以下は本テストでは未使用
      getActivePath()     { return null; },
      getViewportMatrix() { return [1, 0, 0, 1, 0, 0] as const; },
      requestRerender()   { /* no-op */ },
      setCursor(_c)       { /* no-op */ },
      createTextAt()      { /* no-op */ },
    };

    tool.onSelectionChanged(host);
    // 1 回目で [a,b,c] に展開 → 再帰呼び出しは canonical なので alreadyExpanded で抜ける
    expect(host.recursionDepth).toBe(1);
    expect(host.active).toEqual([a, b, c]);
  });

  test('non-canonical な host: 毎回新 handle を返すと再帰が止まらない (契約違反検出)', () => {
    // app.ts の makeFabricObjectHandle で WeakMap キャッシュが抜けたケースを模擬。
    // 同じ underlying「対象」でも getActiveObjects / getAllObjects 呼び出しごとに
    // 新しい instance が生成されると、SelectGroupTool は alreadyExpanded を識別できず、
    // setActiveSelection を無限に呼び続けてしまう。
    const tool = new SelectGroupTool();
    let recursionDepth = 0;
    const MAX = 5;

    const buggyHost: ToolHost = {
      getActiveObjects() { return [{ getGroupId: () => 'g1' }]; },        // 毎回新 instance
      getAllObjects()    { return [{ getGroupId: () => 'g1' }, { getGroupId: () => 'g1' }]; },
      setActiveSelection(_objs) {
        recursionDepth++;
        if (recursionDepth >= MAX) return;  // 上限に達したらテストとして打ち切る
        tool.onSelectionChanged(this);
      },
      getActivePath()     { return null; },
      getViewportMatrix() { return [1, 0, 0, 1, 0, 0] as const; },
      requestRerender()   { /* no-op */ },
      setCursor(_c)       { /* no-op */ },
      createTextAt()      { /* no-op */ },
    };

    tool.onSelectionChanged(buggyHost);
    // canonical な host なら recursionDepth=1 で止まる。non-canonical なので
    // alreadyExpanded を検出できず MAX まで再帰してしまう。これを観測することで
    // 「host 実装は canonical 化が必須」という規約をテストとして固定する。
    expect(recursionDepth).toBe(MAX);
  });
});

export {};
