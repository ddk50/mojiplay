// ElectronHostShell: HostShell の Electron 実装。
//
// renderer process から window.electronIPC 経由で main process / IPC を叩く処理を
// この 1 ファイルに集約する。Controller (ViewController / MenuController) と
// Use Case (FileIOInteractor 等) はこの concrete を直接知らず、interface 経由で扱う。
//
// 設計:
//   - log は既存 logger.ts (console + window.electronIPC fallback) に委譲する。
//     これで static `import { logger } from './logger'` を使う既存コード (state.ts /
//     copy-export.ts / tools 等) と HostShell.log のバックエンドが一致し、ログが
//     1 経路に揃う。logger.ts は console fallback 付きなので Web 環境でも動く。
//   - input callback (paste / copy / close guard) は preload で expose されている
//     event subscription を内部で wrap する。

import type { HostShell, HostShellLog, CloseGuardDecision } from '../usecases/host-shell-interface';
import { logger as sharedLogger } from './logger';

export class ElectronHostShell implements HostShell {
  readonly log: HostShellLog = sharedLogger;

  async savePng(
    dataUrl: string,
  ): Promise<{ ok: true; filePath: string } | { ok: false; reason: string }> {
    if (!window.electronIPC?.savePng) {
      return { ok: false, reason: 'electronIPC.savePng が未配線' };
    }
    const r = await window.electronIPC.savePng(dataUrl);
    if (r.success) return { ok: true, filePath: r.filePath };
    return { ok: false, reason: r.reason };
  }

  async copyImageToClipboard(dataUrl: string): Promise<void> {
    if (!window.electronIPC?.copyImageToClipboard) {
      throw new Error('electronIPC.copyImageToClipboard が未配線');
    }
    await window.electronIPC.copyImageToClipboard(dataUrl);
  }

  setZoom(delta: 'in' | 'out' | 'reset'): void {
    if (!window.electronIPC) return;
    if (delta === 'in') void window.electronIPC.zoomIn();
    else if (delta === 'out') void window.electronIPC.zoomOut();
    else if (delta === 'reset') void window.electronIPC.zoomReset();
  }

  toggleFullscreen(): void {
    void window.electronIPC?.toggleFullscreen();
  }

  toggleDevTools(): void {
    void window.electronIPC?.toggleDevTools();
  }

  setNativeDirty(dirty: boolean): void {
    void window.electronIPC?.setDirty?.(dirty);
  }

  onPasteRequest(_cb: () => void): () => void {
    // Electron native menu の Edit > Paste は webContents.paste を呼ぶ IPC で処理されるが、
    // renderer 側 paste 要求も同じ entrypoint にしておくと Web 化時にも揃えられる。
    // 現状は HostShell.paste() を呼ぶ呼び元 (= MenuController) からの一方向で済むため、
    // 入力購読は no-op (= 将来 IPC で paste 要求が来るようになったら配線を追加)。
    return () => {
      /* no-op */
    };
  }

  onCopyRequest(cb: () => void): () => void {
    // main process の Edit > Copy IPC ('menu-copy') を購読。
    if (!window.electronIPC?.onMenuCopy)
      return () => {
        /* no-op */
      };
    window.electronIPC.onMenuCopy(cb);
    // 注: preload の onMenuCopy は ipcRenderer.on を呼ぶだけで removeListener API が
    // 露出していない。複数 attach すると重複するが、現状 1 controller が 1 回だけ
    // attach する設計なので問題は出ない。Web 化時は HostShell の interface に合わせて
    // 真の unsubscribe を実装する。
    return () => {
      /* unsubscribe は preload 側に未実装のため no-op */
    };
  }

  onCloseGuardRequest(cb: () => Promise<CloseGuardDecision>): () => void {
    if (!window.electronIPC?.onAppCloseRequest)
      return () => {
        /* no-op */
      };
    window.electronIPC.onAppCloseRequest(() => {
      void (async () => {
        const decision = await cb();
        void window.electronIPC?.respondAppClose(decision);
      })();
    });
    return () => {
      /* unsubscribe は preload 側に未実装のため no-op */
    };
  }
}
