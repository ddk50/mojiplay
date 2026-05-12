// 黒矢印 (SelectGroup) ツール。
//
// 1 文字をクリック / marquee 範囲選択した時に、同じ groupId を共有する
// 全文字に選択を自動展開する。これにより「単語/文字列単位」が選択粒度になる。
//
// pointer 系イベント (down/move/up) はすべて no-op で、fabric の通常選択動作に
// 任せる。展開は selection:created / selection:updated 後に host が呼ぶ
// onSelectionChanged で行う。
//
// 中核ロジックは core/group-selection.ts の computeGroupExpansion (純粋関数)。
// 本クラスは host 越しに ObjectHandle の取得 / 設定を行うだけ。

import { computeGroupExpansion } from '../../core/group-selection';
import type {
  Tool, ToolDescriptor, PointerInput, PointerHandled,
  MovingTarget, CanvasMouseDownInput,
} from './tool-interface';
import type { State, ObjectHandle } from '../../core/state-interface';

export class SelectGroupTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id:    'select-group',
    label: 'グループ選択/移動 (黒矢印)',
    iconSvg:
      '<svg class="tool-icon" viewBox="0 0 14 18" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M2,1 L2,14 L5,11 L7.5,16.5 L9.5,15.5 L7,10 L12,10 Z"/>' +
      '</svg>',
  };

  onActivate(_state: State): void { /* no-op */ }
  onDeactivate(_state: State): void { /* no-op */ }

  onPointerDown(_e: PointerInput, _state: State): PointerHandled { return 'pass'; }
  onPointerMove(_e: PointerInput, _state: State): void { /* no-op */ }
  onPointerUp(_e: PointerInput, _state: State): void { /* no-op */ }

  isDragging(): boolean { return false; }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _state: State): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _state: State): void { /* no-op */ }

  onSelectionChanged(state: State): void {
    const current = state.getActiveObjects();
    if (current.length === 0) return;

    const all = state.getAllObjects();
    const r = computeGroupExpansion(current, all, (o: ObjectHandle) => o.getGroupId());

    // 既に完全展開済みなら setActiveSelection を呼ばない (selection:updated の
    // 再帰発火を防ぐ)。
    if (r.alreadyExpanded) return;
    state.setActiveSelection(r.expanded);
  }
}
