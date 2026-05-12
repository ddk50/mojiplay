// ElectronUIPort: UIPort の Electron / DOM 実装。
//
// FileIOInteractor が DOM / IPC を直接知らずに済むよう、UI 副作用をこの 1 ファイルに集約。

import type { UIPort, DiscardChoice } from '../usecases/ui-port-interface';
import { showToast } from './toast';

export class ElectronUIPort implements UIPort {
  showToast(message: string, isError = false): void {
    showToast(message, isError);
  }

  async confirmDiscard(message: string): Promise<DiscardChoice> {
    if (!window.electronAPI?.confirmDiscard) {
      // 開発中 IPC 未配線フォールバック: confirm dialog で代用 (= デフォルトはキャンセル扱い)
      return 'cancel';
    }
    return await window.electronAPI.confirmDiscard(message);
  }

  setNativeDirty(dirty: boolean): void {
    void window.electronAPI?.setDirty?.(dirty);
  }

  async copyImageToClipboard(dataUrl: string): Promise<void> {
    if (!window.electronAPI?.copyImageToClipboard) {
      throw new Error('electronAPI.copyImageToClipboard が未配線');
    }
    await window.electronAPI.copyImageToClipboard(dataUrl);
  }
}
