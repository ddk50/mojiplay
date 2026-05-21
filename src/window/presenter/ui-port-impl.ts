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
    if (!window.electronIPC?.confirmDiscard) {
      // 開発中 IPC 未配線フォールバック: confirm dialog で代用 (= デフォルトはキャンセル扱い)
      return 'cancel';
    }
    return await window.electronIPC.confirmDiscard(message);
  }

  async confirmYesNo(message: string): Promise<boolean> {
    // 破壊的操作の確認は browser native confirm() で十分 (OS native dialog 経由にする
    // motivation が無い)。将来 IPC 化したくなったら electronIPC.confirmYesNo を足す。
    return Promise.resolve(window.confirm(message));
  }

  setNativeDirty(dirty: boolean): void {
    void window.electronIPC?.setDirty?.(dirty);
  }

  async copyImageToClipboard(dataUrl: string): Promise<void> {
    if (!window.electronIPC?.copyImageToClipboard) {
      throw new Error('electronIPC.copyImageToClipboard が未配線');
    }
    await window.electronIPC.copyImageToClipboard(dataUrl);
  }
}
