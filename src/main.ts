import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  Menu,
  clipboard,
  nativeImage,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';

// ログ出力先をバイナリ横の logs/ ディレクトリに固定する。
//  - Dev (`npm start`): app.getAppPath() = プロジェクトルート → logs/main.log
//  - Prod portable exe: electron-builder が PORTABLE_EXECUTABLE_DIR に元 exe の
//    ディレクトリをセットするのでそれを使う (process.execPath は temp 展開先を
//    指すため使えない)
//  - Prod non-portable: path.dirname(process.execPath) = exe の場所
function resolveLogDir(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'logs');
  }
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) {
    return path.join(portable, 'logs');
  }
  return path.join(path.dirname(process.execPath), 'logs');
}

const LOG_DIR = resolveLogDir();

// electron-log は file transport を lazy init するため、起動時に何もログを
// 出さないと logs ディレクトリが作られない。明示的に事前作成して担保する。
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  // この段階ではまだロガーも使えないので stderr にだけ出しておく
  process.stderr.write(`[mojiplay] failed to create log dir ${LOG_DIR}: ${String(err)}\n`);
}

log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.transports.file.resolvePathFn = (vars) => path.join(LOG_DIR, vars.fileName ?? 'main.log');

// 起動時に最低 1 行は書き込んで、file transport を確実に初期化し、
// かつ環境変数・パス情報を残すことで後から原因切り分け可能にする。
log.info('[startup] mojiplay main process started');
log.info(
  `[startup] isPackaged=${app.isPackaged}, execPath=${process.execPath}, cwd=${process.cwd()}`,
);
log.info(`[startup] PORTABLE_EXECUTABLE_DIR=${process.env.PORTABLE_EXECUTABLE_DIR ?? '(unset)'}`);
log.info(`[startup] log dir resolved to: ${LOG_DIR}`);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  wireCloseGuard(win);
  return win;
}

// ── Close guard: dirty 状態で window 閉じが要求された時に renderer に決断を仰ぐ ──
//
// renderer は dirty 値を IPC 'set-dirty' で push してくる (= main pull せず、
// renderer push 型)。close 時に isDirty が true なら preventDefault して、
// renderer に 'app-close-request' を投げ、'app-close-response' で 'destroy' /
// 'cancel' を受ける。preventDefault は同期で呼ぶ必要があるため、async fetch を
// close handler 内に置けないので、IPC roundtrip 型にしている。
let isDirty = false;
let allowClose = false;

function wireCloseGuard(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (allowClose || !isDirty) return;
    e.preventDefault();
    win.webContents.send('app-close-request');
  });
}

// IPC handler: renderer sends base64 PNG data URL → main writes file
ipcMain.handle('save-png', async (_event, base64Data: string): Promise<SaveResult> => {
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

// IPC handler: renderer → electron-log (ファイル + コンソール)
ipcMain.handle('log', (_event, level: string, message: string) => {
  const fn = (log as unknown as Record<string, ((msg: string) => void) | undefined>)[level];
  fn?.(message);
});

// IPC handler: 透過 PNG dataURL → クリップボードに画像として書き込み
// clipboard / nativeImage はメインプロセスでのみ利用可能
// (サンドボックス有効の preload では使えない)
ipcMain.handle('copy-image', (_event, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(img);
  log.info('[copy-image] image written to clipboard');
});

// IPC handlers: HTML カスタムメニューの View 系アクション
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
  async (_event, json: string, currentPath: string | null): Promise<SaveResult> => {
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

ipcMain.handle('open-mply', async (): Promise<OpenResult> => {
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

ipcMain.handle('confirm-discard', async (_event, message: string): Promise<DiscardChoice> => {
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

app.whenReady().then(() => {
  // Local Font Access API (window.queryLocalFonts) は local-fonts 権限を要求する。
  // Electron はデフォルトで拒否するため、request / check の両方を明示的に許可する。
  // 'local-fonts' は Electron 29 の TS 型ユニオンに未収載だが Chromium 側が実際に渡してくる。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback((permission as string) === 'local-fonts');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return (permission as string) === 'local-fonts';
  });

  // ネイティブメニューバーを非表示にし、HTML カスタムメニューに置き換える
  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
