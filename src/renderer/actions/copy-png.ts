// 選択オブジェクトを透過 PNG としてクリップボードにコピー
// (Edit メニュー / Ctrl+C / Edit > Copy IPC から呼ばれる)。
//
// Electron のデフォルトメニュー Edit > Copy (role:'copy') は Ctrl+C を
// ネイティブ側で捕捉し document.execCommand('copy') を呼ぶ。
// この結果 DOM に copy イベントが dispatch される（keydown は届かない）。
// そのため copy イベントで捕捉するのが正しいルート。
//
// IText 編集中は fabric 自身のテキストコピーに任せる (呼び出し側で bypass)。

import { exportObjectToPngDataUrl } from '../copy-export';
import { logger, fmtObj } from '../logger';
import { showToast } from '../toast';

export async function copySelectionAsPng(canvas: fabric.Canvas): Promise<void> {
  logger.debug('[copy] copySelectionAsPng called');
  const active = canvas.getActiveObject();
  if (!active) {
    logger.debug('[copy] no active object, skipping');
    return;
  }
  logger.debug(`[copy] active=${fmtObj(active)}`);

  try {
    // exportObjectToPngDataUrl は typed wrapper で、toCanvasElement に
    // options オブジェクト ({ multiplier }) を正しく渡すことを型で保証する。
    // 詳細は src/renderer/copy-export.ts の経緯コメント参照。
    const result = exportObjectToPngDataUrl(active as any, 10);
    const dataUrl = result.dataUrl;
    logger.debug(`[copy] dataUrl length=${dataUrl.length} canvas=${result.width}x${result.height}`);

    if (window.electronAPI) {
      await window.electronAPI.copyImageToClipboard(dataUrl);
      showToast('クリップボードにコピーしました');
      logger.info('[copy] image copied to clipboard');
    } else {
      logger.warn('[copy] electronAPI not available');
    }
  } catch (err) {
    logger.error('[copy] failed', err);
    showToast('コピーに失敗しました', true);
  }
}

// メインプロセスのカスタムメニュー Edit > Copy から IPC で通知される経路と
// keydown handler の両方から呼ばれるので、200ms 間隔の debounce で二重発火を防ぐ。
let lastCopyTime = 0;

export function doCopy(canvas: fabric.Canvas): void {
  const now = Date.now();
  if (now - lastCopyTime < 200) return;
  lastCopyTime = now;
  void copySelectionAsPng(canvas);
}
