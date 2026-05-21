// canvas 全消去 (確認 dialog 込み) の use case。
//
// 旧 ToolbarController.onClearClick に inline で書かれていた `if (confirm(...)) {
// state.clearAll() }` を free function に extract。confirm() の browser native API
// 直叩きを UIPort.confirmYesNo 経由に格上げすることで、test 時に dialog choice を
// 制御できる + controller から raw browser API 依存が消える。

import type { State } from '../../core/state-interface';
import type { UIPort } from '../ui-port-interface';

const CONFIRM_MESSAGE = 'キャンバスの内容をすべて削除しますか？';

export async function clearAllWithConfirm(state: State, ui: UIPort): Promise<void> {
  const ok = await ui.confirmYesNo(CONFIRM_MESSAGE);
  if (!ok) return;
  state.clearAll();
}
