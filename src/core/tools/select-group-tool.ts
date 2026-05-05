// 黒矢印 (SelectGroup) ツール。
//
// 1 文字をクリック / marquee 範囲選択した時に、同じ groupId を共有する
// 全文字に選択を自動展開する。これにより「単語/文字列単位」が選択粒度になる。
//
// pointer 系イベント (down/move/up) はすべて no-op で、fabric の通常選択動作に
// 任せる。展開は selection:created / selection:updated 後に host が呼ぶ
// onSelectionChanged で行う。
//
// 中核ロジックは ./group-selection.ts の computeGroupExpansion (純粋関数)。
// 本クラスは host 越しに ObjectHandle の取得 / 設定を行うだけ。

class SelectGroupTool implements Tool {
  onActivate(_host: ToolHost): void { /* no-op */ }
  onDeactivate(_host: ToolHost): void { /* no-op */ }

  onPointerDown(_e: PointerInput, _host: ToolHost): PointerHandled { return 'pass'; }
  onPointerMove(_e: PointerInput, _host: ToolHost): void { /* no-op */ }
  onPointerUp(_e: PointerInput, _host: ToolHost): void { /* no-op */ }

  isDragging(): boolean { return false; }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _host: ToolHost): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _host: ToolHost): void { /* no-op */ }

  onSelectionChanged(host: ToolHost): void {
    const current = host.getActiveObjects();
    if (current.length === 0) return;

    const all = host.getAllObjects();
    const r = computeGroupExpansion(current, all, (o: ObjectHandle) => o.getGroupId());

    // 既に完全展開済みなら setActiveSelection を呼ばない (selection:updated の
    // 再帰発火を防ぐ)。
    if (r.alreadyExpanded) return;
    host.setActiveSelection(r.expanded);
  }
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.SelectGroupTool = SelectGroupTool;
}

// Node test 時に依存モジュールを pre-load
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('./group-selection');
}
