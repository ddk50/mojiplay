// window.electronAPI の Window 拡張。runtime 実装は preload.ts、契約は
// src/electron-api.ts (ElectronAPI interface)。
//
// Window への拡張は本ファイル + globals/local-fonts.d.ts (queryLocalFonts) の
// 2 箇所に分かれる。前者は Electron 固有 IPC、後者は Web 標準 API なので
// 関心の境界として分離している。declaration merging で両方が Window に
// merge される。

import type { ElectronAPI } from '../electron-api';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
