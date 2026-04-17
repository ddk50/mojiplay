import { app, BrowserWindow, ipcMain, dialog, session, Menu, clipboard, nativeImage } from 'electron';
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

log.transports.file.level  = 'debug';
log.transports.console.level = 'debug';
log.transports.file.resolvePathFn = (vars) =>
  path.join(LOG_DIR, vars.fileName ?? 'main.log');

// 起動時に最低 1 行は書き込んで、file transport を確実に初期化し、
// かつ環境変数・パス情報を残すことで後から原因切り分け可能にする。
log.info('[startup] mojiplay main process started');
log.info(`[startup] isPackaged=${app.isPackaged}, execPath=${process.execPath}, cwd=${process.cwd()}`);
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
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

// IPC handler: renderer sends base64 PNG data URL → main writes file
ipcMain.handle('save-png', async (_event, base64Data: string): Promise<SaveResult> => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export as PNG',
    defaultPath: 'layout.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
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
  (log as any)[level]?.(message);
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

  const win = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
