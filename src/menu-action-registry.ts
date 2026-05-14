// MenuActionRegistry: id → MenuAction の dispatch table を構築する factory。
//
// 中身は「ID 文字列 → 既存 use case 関数 + DI された依存」の wiring (= no logic)。
// CA 上は Composition Root (= renderer.ts) の sibling。Controller (event → ID) と
// Use Case (ID 後の orchestration) の間を繋ぐ "shared dispatch table" で、それ自体
// は Use Case でも Controller でもない。
//
// interface (MenuAction / MenuActionRegistry) は `usecases/menu/` に port として
// 残してある (= Controller 側は contract のみに依存)。本ファイルは concrete factory
// なので Composition Root と並べた top-level 配置。
//
// 各 MenuAction は対応する free function (selectAll / doCopy 等) や Interactor
// method (fileIO.saveCurrent 等) を呼ぶ thin wrapper として実装する。

import type { MenuAction } from './usecases/menu/menu-action-interface';
import type {
  MenuActionRegistry,
  MenuActionRegistryDeps,
} from './usecases/menu/menu-action-registry-interface';

import { selectAll } from './usecases/menu/select-all';
import { deleteSelection } from './usecases/menu/delete-selection';
import { duplicateSelection } from './usecases/menu/duplicate-selection';
import { doCopy } from './usecases/menu/copy-selection-as-png';
import { outlineSelection } from './usecases/menu/outline-selection';
import { exportCanvasAsPng } from './usecases/menu/export-canvas-as-png';
import { clearAllWithConfirm } from './usecases/menu/clear-all';

export function createMenuActionRegistry(deps: MenuActionRegistryDeps): MenuActionRegistry {
  const { state, ui, fileIO, host } = deps;

  const actions: MenuAction[] = [
    // ── Edit ──
    { id: 'copy', execute: () => doCopy(state, ui) },
    { id: 'undo', execute: () => state.undo() },
    { id: 'redo', execute: () => state.redo() },
    {
      id: 'paste',
      execute: () => {
        /* HostShell 経由で webContents.paste を呼ぶ将来の拡張用 hook。
                                              現状は Electron native menu 側で完結 */
      },
    },
    { id: 'delete', execute: () => deleteSelection(state) },
    { id: 'duplicate', execute: () => duplicateSelection(state) },
    { id: 'select-all', execute: () => selectAll(state) },
    { id: 'outline', execute: () => outlineSelection(state, ui) },

    // ── View ──
    { id: 'devtools', execute: () => host.toggleDevTools() },
    { id: 'zoom-in', execute: () => host.setZoom('in') },
    { id: 'zoom-out', execute: () => host.setZoom('out') },
    { id: 'zoom-reset', execute: () => host.setZoom('reset') },
    { id: 'fullscreen', execute: () => host.toggleFullscreen() },

    // ── File ──
    { id: 'file-open', execute: () => fileIO.openFile() },
    { id: 'file-save', execute: () => fileIO.saveCurrent() },
    { id: 'file-save-as', execute: () => fileIO.saveAs() },
    { id: 'export-canvas-png', execute: () => exportCanvasAsPng(state, host, ui) },
    { id: 'clear-all', execute: () => clearAllWithConfirm(state, ui) },
  ];

  const map = new Map<string, MenuAction>(actions.map((a) => [a.id, a]));

  return {
    execute(id: string): void | Promise<void> {
      const a = map.get(id);
      if (!a) return;
      return a.execute();
    },
    get(id: string): MenuAction | null {
      return map.get(id) ?? null;
    },
  };
}
