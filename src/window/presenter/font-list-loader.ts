// Local Font Access API (window.queryLocalFonts) でシステムフォントを列挙し、
// FontCatalog に流し込む。
//
// Electron 29 / Chromium 122+ に標準搭載。main 側で local-fonts 権限を許可済み。
// 取得できなかった場合は catalog を空のまま残し false を返す
// (= 呼び側は select を触らず、index.html のフォールバック Arial / Regular を維持)。
//
// Web API 接触面なので presenter/ 配置。解釈・保持は core/font-catalog.ts の担当で、
// このファイルは「取ってきて詰める」だけ。

import type { FontCatalog } from '../core/font-catalog';
import { logger } from './logger';

/** システムフォントを列挙して catalog に詰める。詰められたら true。 */
export async function loadSystemFonts(catalog: FontCatalog): Promise<boolean> {
  if (typeof window.queryLocalFonts !== 'function') return false;
  try {
    const fonts = await window.queryLocalFonts();
    if (!fonts.length) return false;
    catalog.replaceAll(fonts);
    return true;
  } catch (err) {
    logger.error('[fonts] queryLocalFonts failed', err);
    return false;
  }
}
