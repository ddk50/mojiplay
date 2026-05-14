// テキストツール: キャンバスの空き領域クリックで IText を生成し、編集モードに入る。
//
// 本クラスは「フォントプロパティを供給する関数」と「state.createTextAt 呼び出し」の
// 配線役。IText の生成と編集モード突入は host (fabric) 側に閉じ込める。
//
// fabric の mouse:down (= fabric の hit-test 後) に乗る。target がある (既存
// オブジェクトクリック) 場合は何もしない (fabric の通常選択動作に任せる)。
//
// pointer 系イベントは全て no-op (DOM capture 段階では何もしない)。

import type {
  Tool,
  ToolDescriptor,
  PointerInput,
  PointerHandled,
  MovingTarget,
  CanvasMouseDownInput,
} from './tool-interface';
import type { State, TextCreateProps } from '../../core/state-interface';

type FontPropsProvider = () => TextCreateProps;

export class TextTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: 'text',
    label: '文字入力 (T)',
    iconSvg: '<span style="font-weight:700;font-size:12px;">T</span>',
  };

  constructor(private getFontProps: FontPropsProvider) {}

  onActivate(_state: State): void {
    /* no-op */
  }
  onDeactivate(_state: State): void {
    /* no-op */
  }

  onPointerDown(_e: PointerInput, _state: State): PointerHandled {
    return 'pass';
  }
  onPointerMove(_e: PointerInput, _state: State): void {
    /* no-op */
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

  onCanvasMouseDown(e: CanvasMouseDownInput, state: State): void {
    if (e.hasTarget) return;
    state.createTextAt(e.worldX, e.worldY, this.getFontProps());
  }
}
