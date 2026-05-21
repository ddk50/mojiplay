// window.electronIPC の Window 拡張。runtime 実装は src/preload.ts、契約は
// src/electron-ipc.ts (ElectronIPC interface)。
//
// Window への拡張は本ファイル + globals/local-fonts.d.ts (queryLocalFonts) の
// 2 箇所に分かれる。前者は Electron 固有 IPC、後者は Web 標準 API なので
// 関心の境界として分離している。declaration merging で両方が Window に
// merge される。

import type { ElectronIPC } from '../electron-ipc';

declare global {
  interface Window {
    electronIPC?: ElectronIPC;
  }
}

export {};
