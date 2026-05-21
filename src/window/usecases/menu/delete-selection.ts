// 選択オブジェクト削除 (Edit メニュー / Delete キーから呼ばれる)。
// 旧 src/renderer/actions/delete.ts を fabric 不知化して移動。

import type { State } from '../../core/state-interface';

export function deleteSelection(state: State): void {
  state.removeActiveObjects();
}
