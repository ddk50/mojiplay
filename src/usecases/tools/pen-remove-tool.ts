// -ペンツール: アンカークリックでアンカーを削除する。
//
// 1 クリックで完結 (ドラッグ無し)。アンカー数が下限 (M のみ等) になる場合は
// path.removeAnchor が null を返すので何もしない。
//
// hover 時はアンカー上で 'pointer' カーソルにする。

import { computeOverlayLayout, hitTestAnchorAt } from '../../core/path/overlay-layout';
import type {
  Tool, ToolDescriptor, PointerInput, PointerHandled,
  MovingTarget, CanvasMouseDownInput,
} from './tool-interface';
import type { State } from '../../core/state-interface';

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

  onActivate(_state: State): void { /* no-op */ }
  onDeactivate(state: State): void { state.setCursor(''); }

  onPointerDown(e: PointerInput, state: State): PointerHandled {
    const path = state.getActivePath();
    if (!path) return 'pass';

    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, state.getViewportMatrix());
    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    if (aIdx < 0) return 'pass';

    const next = snapshot.path.removeAnchor(aIdx);
    // removeAnchor が拒否した場合 (アンカー数不足) は null
    if (!next) return 'consumed';

    // History: 削除前に before を捕捉
    const before = path.captureForHistory();
    path.setPath(next);
    path.finalizeEdit();
    state.requestRerender();

    state.pushCommand({
      kind: 'objectChanged',
      objectId: path.getId(),
      before,
      after: path.captureForHistory(),
    });
    return 'consumed';
  }

  onPointerMove(e: PointerInput, state: State): void {
    const path = state.getActivePath();
    if (!path) {
      state.setCursor('');
      return;
    }
    const layout = computeOverlayLayout(path.snapshot(), state.getViewportMatrix());
    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    state.setCursor(aIdx >= 0 ? 'pointer' : '');
  }

  onPointerUp(_e: PointerInput, _state: State): void { /* no-op */ }
  isDragging(): boolean { return false; }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _state: State): void { /* no-op */ }
  onSelectionChanged(_state: State): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _state: State): void { /* no-op */ }
}
