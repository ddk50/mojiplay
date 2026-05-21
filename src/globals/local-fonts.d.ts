// Local Font Access API (Chromium 103+) の最小型宣言。
// lib.dom.d.ts には現時点でまだ入っていないため、ここで Window を拡張する。
// 参考: https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts
//
// Window への拡張は本ファイル + globals/electron-api.d.ts (electronAPI) の
// 2 箇所に分かれる。前者は Web 標準 API、後者は Electron 固有 IPC なので
// 関心の境界として分離している。declaration merging で両方が Window に
// merge される。

declare global {
  interface FontData {
    readonly family: string;
    readonly fullName: string;
    readonly postscriptName: string;
    readonly style: string;
    blob(): Promise<Blob>;
  }

  interface QueryLocalFontsOptions {
    postscriptNames?: string[];
  }

  interface Window {
    queryLocalFonts?: (options?: QueryLocalFontsOptions) => Promise<FontData[]>;
  }
}

export {};
