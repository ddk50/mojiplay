// -ペンツール: アンカークリックでアンカーを削除する。
//
// 1 クリックで完結 (ドラッグ無し)。アンカー数が下限 (M のみ等) になる場合は
// removeAnchor が拒否するので何もしない。
//
// hover 時はアンカー上で 'pointer' カーソルにする。

import { removeAnchor } from '../path/anchors';
import { computeOverlayLayout, hitTestAnchorAt } from './overlay-layout';
import type {
  Tool, ToolDescriptor, ToolHost, PointerInput, PointerHandled,
  MovingTarget, CanvasMouseDownInput,
} from './tool-interface';

export class PenRemoveTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id:    'pen-remove',
    label: 'アンカーポイント削除 (-ペン)',
    iconSvg:
      '<svg class="tool-icon pen-icon" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">' +
        '<path class="pen-nib" d="M9,1 L13,5.5 L11.5,10.5 L9,16 L6.5,10.5 L5,5.5 Z"/>' +
        '<circle class="pen-dot" cx="9" cy="6.5" r="1.6"/>' +
        '<line class="pen-sign" x1="12" y1="14.5" x2="17" y2="14.5" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>',
  };

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

    // History: 削除前に before を捕捉
    const before = path.captureForHistory();
    path.setCommands(newCmds);
    path.finalizeEdit();
    host.requestRerender();

    host.pushCommand({
      kind: 'objectChanged',
      objectId: path.getId(),
      before,
      after: path.captureForHistory(),
    });
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
