// すべて選択 (Edit メニュー / btn-select-all / Ctrl+A から呼ばれる)。
// 旧 src/renderer/actions/select-all.ts を fabric 不知化して移動。

import type { State } from '../../core/state';

export function selectAll(state: State): void {
  state.selectAllObjects();
}
