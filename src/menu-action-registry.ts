// メニューアクションの dispatch table を構築する factory。
//
// 中身は「ID → 既存 use case 関数 + DI された依存」の wiring (= no logic)。
// CA 上は Composition Root (= renderer.ts) の sibling。Controller (event → ID) と
// Use Case (ID 後の orchestration) の間を繋ぐ "shared dispatch table" で、それ自体
// は Use Case でも Controller でもない。
//
// 設計判断: object literal を `as const` で直接返し、`MenuActionId` を `keyof` から
// 導出する。これにより:
//   - 全 ID が compile-time に union 型として固定される (typo は型エラー)
//   - IDE で 'copy' 等の literal は object key の定義へ jump-to-definition できる
//   - rename symbol で全 use site (KeyBinding table / controller 引数 等) 一括追従
// 旧 `MenuAction { id, execute }` interface + `MenuActionRegistry` interface は
// 「id field と Map key の二重持ち」+「test (.get(id)?.id) のためだけに存在」だった
// ので削除した。

import type { State } from './core/state-interface';
import type { UIPort } from './usecases/ui-port-interface';
import type { HostShell } from './usecases/host-shell-interface';
import type { FileIOInteractor } from './usecases/menu/file-io-interactor-interface';

import { selectAll } from './usecases/menu/select-all';
import { deleteSelection } from './usecases/menu/delete-selection';
import { duplicateSelection } from './usecases/menu/duplicate-selection';
import { doCopy } from './usecases/menu/copy-selection-as-png';
import { outlineSelection } from './usecases/menu/outline-selection';
import { exportCanvasAsPng } from './usecases/menu/export-canvas-as-png';
import { clearAllWithConfirm } from './usecases/menu/clear-all';

export interface MenuActionsDeps {
  state: State;
  ui: UIPort;
  fileIO: FileIOInteractor;
  host: HostShell;
}

export function makeMenuActions(deps: MenuActionsDeps) {
  const { state, ui, fileIO, host } = deps;
  return {
    // ── Edit ──
    copy: () => doCopy(state, ui),
    undo: () => state.undo(),
    redo: () => state.redo(),
    paste: () => {
      /* HostShell 経由で webContents.paste を呼ぶ将来の拡張用 hook。
         現状は Electron native menu 側で完結 */
    },
    delete: () => deleteSelection(state),
    duplicate: () => duplicateSelection(state),
    'select-all': () => selectAll(state),
    outline: () => outlineSelection(state, ui),

    // ── View ──
    devtools: () => host.toggleDevTools(),
    'zoom-in': () => host.setZoom('in'),
    'zoom-out': () => host.setZoom('out'),
    'zoom-reset': () => host.setZoom('reset'),
    fullscreen: () => host.toggleFullscreen(),

    // ── File ──
    'file-open': () => fileIO.openFile(),
    'file-save': () => fileIO.saveCurrent(),
    'file-save-as': () => fileIO.saveAs(),
    'export-canvas-png': () => exportCanvasAsPng(state, host, ui),
    'clear-all': () => clearAllWithConfirm(state, ui),
  } as const;
}

/** dispatch object 全体の型 (factory 戻り値からの導出)。controller の dep 型に使う。 */
export type MenuActions = ReturnType<typeof makeMenuActions>;

/** 全 action ID の union 型。KeyBinding / 直接呼び出し / boundary narrowing に使う。 */
export type MenuActionId = keyof MenuActions;

/** HTML data-action / IPC など外部から来る string を MenuActionId に narrow する type guard。 */
export function isMenuActionId(s: string, m: MenuActions): s is MenuActionId {
  return s in m;
}
