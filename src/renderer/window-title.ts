// window 表示タイトルの更新 (Presenter)。
//
// document.title を更新すると Electron の BrowserWindow タイトルバーが追従する
// (BrowserWindow は title オプション未指定なので HTML の title 要素を採用)。

import type { FileIOInteractor } from '../usecases/menu/file-io-interactor-interface';

const TITLE_BASE = 'Font Layout Editor';

export function updateWindowTitle(canvas: fabric.Canvas, fileIO: FileIOInteractor): void {
  const pct = Math.round(canvas.getZoom() * 100);
  const { fileName, dirty } = fileIO.getDocStatus();
  const name = fileName ?? '名称未設定';
  const dot = dirty ? ' ●' : '';
  document.title = `${TITLE_BASE} — ${name}${dot} — ${pct}%`;
}
