// IPC 入口: renderer (preload 経由) からの ipcRenderer.invoke を受け取る
// ipcMain.handle ハンドラを 1 ファイルに集約。
//
// renderer 側の出口は src/preload.ts (ElectronIPC 契約の impl)、
// 契約 (channel 名 / 引数 / 戻り値の型) は src/electron-ipc.ts。
// この 3 ファイルが mojiplay の IPC 境界の全部。
//
// 設計メモ:
//  - close guard 用の dirty/allowClose 状態はここに閉じる (renderer は push 型で
//    'set-dirty' / 'app-close-response' を投げてくる、main.ts は isCloseBlocked()
//    だけを読む)。
//  - 副作用 (fs / dialog / clipboard) はメインプロセスでのみ実行可能。
//  - 戻り値は IpcSaveResult / IpcOpenResult / IpcDiscardChoice などの単純な
//    success/reason DTO で渡し、Use Case 層の domain 型への翻訳は
//    repository/file-system-document.ts が担う。

import { ipcMain, BrowserWindow, dialog, clipboard, nativeImage } from 'electron';
import * as fs from 'fs';
import log from 'electron-log';
import type { IpcSaveResult, IpcOpenResult, IpcDiscardChoice } from '../electron-ipc';

// ── Close guard state ──
// 'set-dirty' で renderer から dirty 値を受け取り、'app-close-response' で
// 'destroy' (= 閉じてよし) を受けたら allowClose を立てる。main.ts の
// wireCloseGuard は isCloseBlocked() のみを参照する。
let isDirty = false;
let allowClose = false;

export function isCloseBlocked(): boolean {
  return !allowClose && isDirty;
}

export function registerIpcHandlers(): void {
  // ── 画像 / クリップボード系 ──

  // renderer から base64 PNG dataURL を受け取り、ファイルに書き出す
  ipcMain.handle('save-png', async (_event, base64Data: string): Promise<IpcSaveResult> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export as PNG',
      defaultPath: 'layout.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });

    if (canceled || !filePath) {
      return { success: false, reason: 'canceled' };
    }

    try {
      const base64 = base64Data.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      return { success: true, filePath };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  });

  // 透過 PNG dataURL → クリップボードに画像として書き込み。
  // clipboard / nativeImage はメインプロセスでのみ利用可能
  // (サンドボックス有効の preload では使えない)。
  ipcMain.handle('copy-image', (_event, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    log.info('[copy-image] image written to clipboard');
  });

  // ── ログ ──
  ipcMain.handle('log', (_event, level: string, message: string) => {
    const fn = (log as unknown as Record<string, ((msg: string) => void) | undefined>)[level];
    fn?.(message);
  });

  // ── View 系 (HTML カスタムメニューから) ──
  ipcMain.handle('toggle-devtools', (event) => {
    event.sender.toggleDevTools();
  });
  ipcMain.handle('zoom-in', (event) => {
    const level = event.sender.getZoomLevel();
    event.sender.setZoomLevel(level + 0.5);
  });
  ipcMain.handle('zoom-out', (event) => {
    const level = event.sender.getZoomLevel();
    event.sender.setZoomLevel(level - 0.5);
  });
  ipcMain.handle('zoom-reset', (event) => {
    event.sender.setZoomLevel(0);
  });
  ipcMain.handle('toggle-fullscreen', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  // Edit メニュー (undo/redo/paste): document.execCommand は deprecated なので
  // Electron の webContents メソッド経由に統一。内部呼び出しは同じだが
  // Web 標準の deprecation サイクルから外れる。
  ipcMain.handle('undo', (event) => {
    event.sender.undo();
  });
  ipcMain.handle('redo', (event) => {
    event.sender.redo();
  });
  ipcMain.handle('paste', (event) => {
    event.sender.paste();
  });

  // ── ドキュメント保存 / 読み込み ──

  // save-mply: 上書き保存は **必ず tmp + rename** で atomic に行う。
  // 直接 writeFile は書き込み中のクラッシュ / 電源断 / disk full で旧ファイルが
  // 半端な状態で破壊されるリスクがあるため禁止。POSIX rename(2) / Windows
  // MoveFileEx は同一ファイルシステム内で atomic = 旧ファイルか新ファイルの
  // いずれかしか観測されない。
  ipcMain.handle(
    'save-mply',
    async (_event, json: string, currentPath: string | null): Promise<IpcSaveResult> => {
      let filePath = currentPath;
      if (!filePath) {
        const r = await dialog.showSaveDialog({
          title: '名前を付けて保存',
          defaultPath: '名称未設定.mply',
          filters: [{ name: 'mojiplay', extensions: ['mply'] }],
        });
        if (r.canceled || !r.filePath) return { success: false, reason: 'canceled' };
        filePath = r.filePath;
      }
      // tmp 名は process.pid + Date.now() で同時保存衝突を回避。
      const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
      try {
        fs.writeFileSync(tmpPath, json, 'utf-8');
        fs.renameSync(tmpPath, filePath);
        log.info(`[save-mply] saved: ${filePath} (${json.length} bytes)`);
        return { success: true, filePath };
      } catch (err) {
        // 失敗時は tmp を片付ける (rename 前なら tmp が残る、rename 後なら tmp は無い)。
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* tmp が無ければ無視 */
        }
        log.error(`[save-mply] failed: ${(err as Error).message}`);
        return { success: false, reason: (err as Error).message };
      }
    },
  );

  ipcMain.handle('open-mply', async (): Promise<IpcOpenResult> => {
    const r = await dialog.showOpenDialog({
      title: '開く',
      properties: ['openFile'],
      filters: [{ name: 'mojiplay', extensions: ['mply'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, reason: 'canceled' };
    const filePath = r.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      log.info(`[open-mply] loaded: ${filePath} (${content.length} bytes)`);
      return { ok: true, filePath, content };
    } catch (err) {
      log.error(`[open-mply] failed: ${(err as Error).message}`);
      return { ok: false, reason: (err as Error).message };
    }
  });

  ipcMain.handle('confirm-discard', async (_event, message: string): Promise<IpcDiscardChoice> => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = {
      type: 'warning' as const,
      buttons: ['保存', '保存しない', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
      title: '確認',
      message,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return (['save', 'discard', 'cancel'] as const)[r.response] ?? 'cancel';
  });

  // ── Close guard 制御 ──

  // dirty 状態を renderer から push 型で受け取る (= 1 mutation ごとに IPC が走るが、
  // IPC コストは無視できる程度。close 時の判定で main 側から直接読みたいので push 型を採用)。
  ipcMain.handle('set-dirty', (_event, d: boolean) => {
    isDirty = d;
  });

  ipcMain.handle('app-close-response', (event, decision: 'destroy' | 'cancel') => {
    if (decision !== 'destroy') return;
    allowClose = true;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });
}
