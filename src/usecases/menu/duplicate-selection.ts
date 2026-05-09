// 選択オブジェクトを複製 (Edit メニュー / Ctrl+D から呼ばれる)。
// 旧 src/renderer/actions/duplicate.ts を fabric 不知化して移動。
//
// Affinity / Sketch 風の Ctrl+D = duplicate。連続押下で step-and-repeat に
// なるよう、複製後の選択を新オブジェクトに付け替える (= state.duplicateActiveObjects 内部で実装)。
//
// オフセットは「画面上 10px」相当 (= 10 / zoom の canvas 座標)。zoom 倍率に
// 関わらず一貫して "ややずれて見える" よう viewport 倍率を加味する。

import type { State } from '../../core/state';

const SCREEN_PX_OFFSET = 10;

export function duplicateSelection(state: State): void {
  const zoom = state.getZoom();
  const offset = { x: SCREEN_PX_OFFSET / zoom, y: SCREEN_PX_OFFSET / zoom };
  state.duplicateActiveObjects(offset);
}
