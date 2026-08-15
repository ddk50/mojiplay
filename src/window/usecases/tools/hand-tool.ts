// 手のひらツール: drag した screen px 分だけ viewport を pan する (Photoshop 流)。
//
// Mode には登録しない特殊ツール: CanvasInputController が中ボタン mousedown を
// 現行モードに関係なくこのツールへ routing する (= 一時的な手ツール)。mode map 外
// なので toolbar ボタンは生成されないが、Tool interface 上 descriptor は必須。
//
// delta の座標系は screen px (PointerInput.screenX/Y)。worldX/Y は pan 中に
// viewport 自体が動いて self-cancelling になるため使えない。また SelectCharTool の
// 「drag 開始点からの累積 delta 再適用」パターンも原点ごと動く pan には適用できず、
// 直前位置からの incremental delta を積む。

import type {
  Tool,
  ToolDescriptor,
  PointerInput,
  PointerHandled,
  MovingTarget,
  CanvasMouseDownInput,
} from './tool-interface';
import type { State } from '../../core/state-interface';

export class HandTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: 'hand',
    label: '手のひらツール (中ボタンドラッグ)',
    iconSvg:
      '<svg class="tool-icon" viewBox="0 0 16 16"><path d="M5 7V3.5a1 1 0 0 1 2 0V7m0-4.5v-1a1 1 0 0 1 2 0V7m0-4a1 1 0 0 1 2 0v5.5l1.6-1.6a1 1 0 0 1 1.4 1.4L10 13a3 3 0 0 1-2.2 1H7a3 3 0 0 1-3-3V4.5a1 1 0 0 1 1-1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  /** drag 中の直前 pointer 位置 (screen px)。null = drag していない。 */
  private last: { x: number; y: number } | null = null;

  onActivate(_state: State): void {
    /* no-op */
  }
  onDeactivate(state: State): void {
    this.last = null;
    state.setCursor('');
  }

  onPointerDown(e: PointerInput, state: State): PointerHandled {
    this.last = { x: e.screenX, y: e.screenY };
    state.setCursor('grabbing');
    return 'consumed';
  }

  onPointerMove(e: PointerInput, state: State): void {
    if (!this.last) return; // hover は何もしない
    state.panBy(e.screenX - this.last.x, e.screenY - this.last.y);
    this.last = { x: e.screenX, y: e.screenY };
    // fabric が mousemove で hover cursor を上書きするので毎 move で維持
    state.setCursor('grabbing');
  }

  onPointerUp(_e: PointerInput, state: State): void {
    this.last = null;
    state.setCursor('');
  }

  isDragging(): boolean {
    return this.last !== null;
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
