// アウトライン化 (Edit メニュー / btn-outline / Cmd+Shift+O から呼ばれる)。
// 旧 src/renderer/actions/outline.ts を fabric 不知化して移動。
//
// fabric.Text → fabric.Path 変換の中身は state.outlineActiveTexts() に閉じ込め、
// ここではユーザ向けの toast メッセージ組み立てのみを担当。

import type { State } from '../../core/state';
import type { UIPort } from '../ui-port';

export async function outlineSelection(state: State, ui: UIPort): Promise<void> {
  const result = await state.outlineActiveTexts();
  const { succeeded, failedChars, failedFamilies } = result;

  // 何も選択されていなかった or 全部 outlined 済 → ガイダンス
  if (succeeded === 0 && failedFamilies.length === 0) {
    ui.showToast('アウトライン化する文字を選択してください', true);
    return;
  }

  if (succeeded === 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    ui.showToast(`アウトライン化失敗: ${detail}`, true);
    return;
  }

  if (failedFamilies.length > 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    ui.showToast(`一部失敗: ${detail}`, true);
  }
}
