// Local Font Access API (Chromium 103+) の最小型宣言。
// lib.dom.d.ts には現時点でまだ入っていないため、ここで Window を拡張する。
// 参考: https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts

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
