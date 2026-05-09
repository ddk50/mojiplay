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
import type { PathHandle } from '../src/core/state';
import type { Command } from '../src/core/history/types';
import { SelectCharTool } from '../src/usecases/tools/select-char-tool';
import { FakePathHandle, FakeState, pointer } from './fakes';

// ── テストダブル ──────────────────────────────────────────────────────────

class FakeHost extends FakeState {
  public path: PathHandle | null;
  public cursor = '';
  public rerenderCount = 0;
  public commands: Command[] = [];
  constructor(path: PathHandle | null) { super(); this.path = path; }
  override getActivePath(): PathHandle | null { return this.path; }
  override requestRerender(): void { this.rerenderCount++; }
  override setCursor(c: string): void { this.cursor = c; }
  override pushCommand(cmd: Command): void { this.commands.push(cmd); }
}

// ── テスト本体 ────────────────────────────────────────────────────────────

describe('SelectCharTool: anchor drag', () => {
  test('アンカーをクリックしてドラッグすると該当 command のみ更新できる', () => {
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
    const result = tool.onPointerDown(pointer(100, 100), host);
    expect(result).toBe('consumed');
    expect(tool.isDragging()).toBe(true);

    tool.onPointerMove(pointer(110, 105), host);
    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 110, y: 105 } });
    // 他のコマンドは不変
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 200, y: 100 } });
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 200, y: 200 } });

    tool.onPointerUp(pointer(110, 105), host);
    expect(tool.isDragging()).toBe(false);
    expect(path.finalizeCount).toBe(1);
  });

  test('drag は累積デルタベースで反映される', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onActivate(host);

    tool.onPointerDown(pointer(100, 100), host);
    tool.onPointerMove(pointer(110, 100), host); // delta +10
    tool.onPointerMove(pointer(115, 102), host); // delta +5, +2
    tool.onPointerUp(pointer(115, 102), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 115, y: 102 } });
  });

  test('ミスクリックは pass を返して drag に入らない', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    const result = tool.onPointerDown(pointer(50, 50), host);
    expect(result).toBe('pass');
    expect(tool.isDragging()).toBe(false);
  });

  test('active path が無い時の pointerDown は pass を返す', () => {
    const host = new FakeHost(null);
    const tool = new SelectCharTool();
    expect(tool.onPointerDown(pointer(100, 100), host)).toBe('pass');
  });
});

describe('SelectCharTool: handle drag', () => {
  test('ハンドルをクリックすると該当ハンドルのみ動かせる', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'C', c1: { x: 10, y: 0 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // c1 = (10, 0)
    tool.onPointerDown(pointer(10, 0), host);
    tool.onPointerMove(pointer(20, 5), host);
    tool.onPointerUp(pointer(20, 5), host);

    const c = path.commands[1];
    if (c.type !== 'C') throw new Error('expected C');
    expect(c.c1).toEqual({ x: 20, y: 5 });   // moved
    expect(c.c2).toEqual({ x: 100, y: 50 }); // unchanged
    expect(c.to).toEqual({ x: 100, y: 100 }); // unchanged
  });

  test('アンカーとハンドルが重なる位置ではハンドルを優先する', () => {
    // c1 is at the same position as M anchor — handle should win
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 50, y: 50 } },
      { type: 'C', c1: { x: 50, y: 50 }, c2: { x: 100, y: 50 }, to: { x: 100, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(50, 50), host);
    tool.onPointerMove(pointer(60, 50), host);
    tool.onPointerUp(pointer(60, 50), host);

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

  test('ハンドル上の hover で pointer カーソルになる', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(10, 0), host);
    expect(host.cursor).toBe('pointer');
  });

  test('アンカー上の hover で move カーソルになる', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(100, 100), host);
    expect(host.cursor).toBe('move');
  });

  test('空白上の hover でカーソルが空文字になる', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(500, 500), host);
    expect(host.cursor).toBe('');
  });

  test('active path が無い時の hover でもカーソルが空文字になる', () => {
    const host = new FakeHost(null);
    const tool = new SelectCharTool();
    tool.onPointerMove(pointer(10, 10), host);
    expect(host.cursor).toBe('');
  });

  test('drag 中は hover ロジックを実行しない', () => {
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();
    tool.onPointerDown(pointer(0, 0), host);
    host.cursor = 'move';
    tool.onPointerMove(pointer(500, 500), host);
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

  test('閾値内なら最近の grid 位置に snap する', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const host = new FakeHost(null);
    const t = targetAt(34, 50); // 34 → nearest 32 (dist 2 < threshold 5)
    tool.onObjectMoving(t, { altKey: false }, host);
    expect(t.currentLeft()).toBe(32);
    expect(t.currentTop()).toBe(48);  // 50 → 48 (dist 2)
  });

  test('閾値外なら snap しない', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 2 });
    const host = new FakeHost(null);
    const t = targetAt(35, 35); // dist to nearest 32 = 3 >= threshold 2
    tool.onObjectMoving(t, { altKey: false }, host);
    expect(t.currentLeft()).toBe(35);
    expect(t.currentTop()).toBe(35);
  });

  test('Alt 押下中は snap をバイパスする', () => {
    const tool = new SelectCharTool();
    tool.setSnapConfig({ enabled: true, pitch: 8, threshold: 5 });
    const host = new FakeHost(null);
    const t = targetAt(33, 49);
    tool.onObjectMoving(t, { altKey: true }, host);
    expect(t.currentLeft()).toBe(33);
    expect(t.currentTop()).toBe(49);
  });

  test('snap 無効では何もしない', () => {
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
  test('進行中の drag をキャンセルしてカーソルもクリアする', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(100, 100), host);
    expect(tool.isDragging()).toBe(true);
    tool.onDeactivate(host);
    expect(tool.isDragging()).toBe(false);
    expect(host.cursor).toBe('');
  });

  test('deactivate でアンカー選択もクリアする', () => {
    const initial: PathCommand[] = [
      { type: 'M', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 200, y: 100 } },
    ];
    const path = new FakePathHandle(initial);
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(100, 100), host);
    tool.onPointerUp(pointer(100, 100), host);
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

  test('単独クリックで 1 アンカーを選択できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('Shift+クリックでアンカーを追加選択できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
  });

  test('Shift+既選択アンカーのクリックで選択解除できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), host);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), host);
    // anchor 0 を Shift+解除
    tool.onPointerDown(pointer(0, 0, { shiftKey: true }), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([1]));
  });

  test('Shift で選択解除されたアンカーは drag に入らない', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    // Shift+同じアンカーで解除 → drag 状態にならない
    const result = tool.onPointerDown(pointer(0, 0, { shiftKey: true }), host);
    expect(result).toBe('consumed');  // hit はしたが drag 起こさず
    expect(tool.isDragging()).toBe(false);
  });

  test('未選択アンカーの通常クリックで既存選択をクリアして新規 1 個に置き換える', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // 2 個選択
    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), host);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), host);
    // anchor 2 を通常クリック → クリアされて anchor 2 のみ
    tool.onPointerDown(pointer(50, 100), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([2]));
  });

  test('既選択アンカーの通常クリックでは選択を維持して drag に入る', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), host);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), host);
    // anchor 0 (既選択) を通常クリック → 選択維持
    tool.onPointerDown(pointer(0, 0), host);
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0, 1]));
    expect(tool.isDragging()).toBe(true);
  });

  test('空きエリアの通常クリックで選択をクリアして pass を返す', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    const result = tool.onPointerDown(pointer(500, 500), host);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });

  test('空きエリア + Shift では選択を保持して pass を返す', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    const result = tool.onPointerDown(pointer(500, 500, { shiftKey: true }), host);
    expect(result).toBe('pass');
    expect(tool.getSelectedAnchorIndices()).toEqual(new Set([0]));
  });

  test('複数選択アンカーの drag で全アンカーを同じデルタで剛体移動できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // anchor 0 と 1 を選択
    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(100, 0, { shiftKey: true }), host);
    tool.onPointerUp(pointer(100, 0, { shiftKey: true }), host);

    // anchor 0 を掴んで (10, 5) drag
    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerMove(pointer(10, 5), host);
    tool.onPointerUp(pointer(10, 5), host);

    // anchor 0 と 1 が両方 (10, 5) 移動。anchor 2 は不変。
    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 10, y: 5 } });
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 110, y: 5 } });
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 50, y: 100 } });
  });

  test('Shift+drag で水平軸にロックして横方向のみ移動できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    // 累積 (12, 3) → |dx| > |dy| → 水平軸ロック
    tool.onPointerMove(pointer(12, 3, { shiftKey: true }), host);
    tool.onPointerUp(pointer(12, 3, { shiftKey: true }), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 12, y: 0 } });
  });

  test('Shift+drag で垂直軸にロックして縦方向のみ移動できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    // 累積 (3, 12) → |dy| > |dx| → 垂直軸ロック
    tool.onPointerMove(pointer(3, 12, { shiftKey: true }), host);
    tool.onPointerUp(pointer(3, 12, { shiftKey: true }), host);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 0, y: 12 } });
  });

  test('moveSelectedAnchorsBy で選択全アンカーを world delta で移動して history に push できる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    // anchor 0 と 2 を選択
    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    tool.onPointerDown(pointer(50, 100, { shiftKey: true }), host);
    tool.onPointerUp(pointer(50, 100, { shiftKey: true }), host);

    tool.moveSelectedAnchorsBy(host, 5, 3);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 5, y: 3 } });
    expect(path.commands[1]).toEqual({ type: 'L', to: { x: 100, y: 0 } }); // 不変
    expect(path.commands[2]).toEqual({ type: 'L', to: { x: 55, y: 103 } });
    // history Command が push されている
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0].kind).toBe('objectChanged');
  });

  test('moveSelectedAnchorsBy: 選択ゼロでは history も path も触らない', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.moveSelectedAnchorsBy(host, 5, 3);

    expect(path.commands[0]).toEqual({ type: 'M', to: { x: 0, y: 0 } });
    expect(host.commands).toHaveLength(0);
    expect(path.finalizeCount).toBe(0);
  });

  test('clearSelectedAnchors() で選択をリセットできる', () => {
    const path = new FakePathHandle(makeTriangle());
    const host = new FakeHost(path);
    const tool = new SelectCharTool();

    tool.onPointerDown(pointer(0, 0), host);
    tool.onPointerUp(pointer(0, 0), host);
    expect(tool.getSelectedAnchorIndices().size).toBe(1);

    tool.clearSelectedAnchors();
    expect(tool.getSelectedAnchorIndices().size).toBe(0);
  });
});
