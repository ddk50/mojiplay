// 選択オブジェクトを透過 PNG としてクリップボードにコピー
// (Edit メニュー / Ctrl+C / Edit > Copy IPC から呼ばれる)。
// 旧 src/renderer/actions/copy-png.ts を fabric 不知化して移動。
//
// PNG レンダリングは state.exportActiveAsPngDataUrl() に閉じ込め、ここでは
// 「クリップボード IPC 呼び + ユーザ通知」だけ。
//
// メインプロセスのカスタムメニュー Edit > Copy から IPC で通知される経路と
// keydown handler の両方から呼ばれるので、200ms 間隔の debounce で二重発火を防ぐ。

import type { State } from '../../core/state';
import type { UIPort } from '../ui-port';

const DEBOUNCE_MS = 200;
const PNG_MULTIPLIER = 10;
let lastCopyTime = 0;

export function doCopy(state: State, ui: UIPort): void {
  const now = Date.now();
  if (now - lastCopyTime < DEBOUNCE_MS) return;
  lastCopyTime = now;
  void copySelectionAsPng(state, ui);
}

async function copySelectionAsPng(state: State, ui: UIPort): Promise<void> {
  const result = state.exportActiveAsPngDataUrl(PNG_MULTIPLIER);
  if (!result) return;
  try {
    await ui.copyImageToClipboard(result.dataUrl);
    ui.showToast('クリップボードにコピーしました');
  } catch {
    ui.showToast('コピーに失敗しました', true);
  }
}
