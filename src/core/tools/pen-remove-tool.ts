// -ペンツール: アンカークリックでアンカーを削除する。
//
// 1 クリックで完結 (ドラッグ無し)。アンカー数が下限 (M のみ等) になる場合は
// removeAnchor が拒否するので何もしない。
//
// hover 時はアンカー上で 'pointer' カーソルにする。

class PenRemoveTool implements Tool {
  onActivate(_host: ToolHost): void { /* no-op */ }
  onDeactivate(host: ToolHost): void { host.setCursor(''); }

  onPointerDown(e: PointerInput, host: ToolHost): PointerHandled {
    const path = host.getActivePath();
    if (!path) return 'pass';

    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, host.getViewportMatrix());
    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    if (aIdx < 0) return 'pass';

    const newCmds = removeAnchor(snapshot.commands, aIdx);
    // removeAnchor が拒否した場合 (アンカー数不足) は配列長が同じなので変更しない
    if (newCmds.length === snapshot.commands.length) return 'consumed';

    path.setCommands(newCmds);
    path.finalizeEdit();
    host.requestRerender();
    return 'consumed';
  }

  onPointerMove(e: PointerInput, host: ToolHost): void {
    const path = host.getActivePath();
    if (!path) {
      host.setCursor('');
      return;
    }
    const layout = computeOverlayLayout(path.snapshot(), host.getViewportMatrix());
    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    host.setCursor(aIdx >= 0 ? 'pointer' : '');
  }

  onPointerUp(_e: PointerInput, _host: ToolHost): void { /* no-op */ }
  isDragging(): boolean { return false; }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _host: ToolHost): void { /* no-op */ }
  onSelectionChanged(_host: ToolHost): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _host: ToolHost): void { /* no-op */ }
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.PenRemoveTool = PenRemoveTool;
}

// Node test 時に依存モジュールを pre-load
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('../path/coords');
  // @ts-ignore
  require('../path/anchors');
  // @ts-ignore
  require('./overlay-layout');
}
