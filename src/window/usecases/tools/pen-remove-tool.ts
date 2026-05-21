// -ペンツール: アンカークリックでアンカーを削除する。
//
// 1 クリックで完結 (ドラッグ無し)。アンカー数が下限 (M のみ等) になる場合は
// path.removeAnchor が null を返すので何もしない。
//
// hover 時はアンカー上で 'pointer' カーソルにする。

import { computeOverlayLayout, hitTestAnchorAt } from '../../core/path/overlay-layout';
import type {
  Tool,
  ToolDescriptor,
  PointerInput,
  PointerHandled,
  MovingTarget,
  CanvasMouseDownInput,
} from './tool-interface';
import type { State } from '../../core/state-interface';
import penRemoveToolIcon from './icons/pen-remove-tool.svg';

export class PenRemoveTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: 'pen-remove',
    label: 'アンカーポイント削除 (-ペン)',
    iconSvg: penRemoveToolIcon,
  };

  onActivate(_state: State): void {
    /* no-op */
  }
  onDeactivate(state: State): void {
    state.setCursor('');
  }

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

  onPointerUp(_e: PointerInput, _state: State): void {
    /* no-op */
  }
  isDragging(): boolean {
    return false;
  }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _state: State): void {
    /* no-op */
  }
  onSelectionChanged(_state: State): void {
    /* no-op */
  }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _state: State): void {
    /* no-op */
  }
}
