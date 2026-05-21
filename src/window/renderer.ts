// renderer process の最外エントリ (= esbuild bundle entry)。
//
// Electron 3 process それぞれの Composition Root が top-level に並ぶが、
// renderer process では「Screen 抽象 (= 全画面排他で切替可能な独立 UI 単位)」を
// 1 段差し込むことで、現状の drawing 画面と将来追加予定の font-viewer 画面を
// 同じ枠組みで扱う。
//
// このファイル自体は ScreenManager と各 Screen 登録だけを行う薄い entry。
// drawing 画面の実体は `src/renderer/screens/drawing-screen.ts` 側に
// Composition Root として下りる (= state / tools / Controllers / sidebar の
// 構築と attach は drawing-screen 内で完結)。
//
// 起動シーケンス:
//   1. ScreenManager を構築 (空)
//   2. createDrawingScreen(deps) を呼んで Map に登録
//   3. manager.show('drawing') で初回 active 化
//   4. window.unload で manager.detach() (= 全 screen を tear-down)

import type { Screen, ScreenId } from './presenter/screens/screen-interface';
import { ScreenManager } from './presenter/screens/screen-manager';
import { createDrawingScreen } from './presenter/screens/drawing-screen';

void (async () => {
  const screens = new Map<ScreenId, Screen>();
  const manager = new ScreenManager(screens);

  screens.set('drawing', createDrawingScreen({ screenManager: manager }));
  // 将来: screens.set('font-viewer', createFontViewerScreen({ screenManager: manager }));

  await manager.show('drawing');

  window.addEventListener('unload', () => manager.detach());
})();
