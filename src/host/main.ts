import { app, BrowserWindow, session, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { registerIpcHandlers, isCloseBlocked } from './ipc';

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
      // dist/host/main.js から見て preload は dist/preload.js (1 階層上)。
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  win.once('ready-to-show', () => win.show());
  // dist/host/main.js → project_root/public/index.html (2 階層上 + public)
  win.loadFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  wireCloseGuard(win);
  return win;
}

// ── Close guard: dirty 状態で window 閉じが要求された時に renderer に決断を仰ぐ ──
//
// renderer は dirty 値を IPC 'set-dirty' で push してくる (= main pull せず、
// renderer push 型)。close 時に dirty なら preventDefault して、renderer に
// 'app-close-request' を投げ、'app-close-response' で 'destroy' / 'cancel' を
// 受ける。preventDefault は同期で呼ぶ必要があるため、async fetch を close
// handler 内に置けないので、IPC roundtrip 型にしている。
// dirty / allowClose 状態の保持と IPC 受け取りは host/ipc.ts に集約してある。
function wireCloseGuard(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (!isCloseBlocked()) return;
    e.preventDefault();
    win.webContents.send('app-close-request');
  });
}

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

  // IPC 入口の handler を全部 ipcMain.handle に登録。詳細は host/ipc.ts。
  registerIpcHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
