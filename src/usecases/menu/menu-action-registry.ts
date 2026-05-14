// MenuActionRegistry: id → MenuAction の dispatch table。
//
// app.ts の旧 handleMenuAction は switch 文だったが、Registry にすると Controller 側
// (KeyboardController / MenuController) が `registry.execute(id)` の 1 行で済む。
// 新しいメニュー追加も registry の factory 1 か所に追加するだけになる。
//
// 構築は createMenuActionRegistry({ state, ui, fileIO, host }) factory で行う。
// 各 MenuAction は対応する free function (selectAll / doCopy 等) や Interactor method
// (fileIO.saveCurrent 等) を呼ぶ thin wrapper として実装する。

import type { MenuAction } from './menu-action-interface';
import type { MenuActionRegistry, MenuActionRegistryDeps } from './menu-action-registry-interface';

import { selectAll } from './select-all';
import { deleteSelection } from './delete-selection';
import { duplicateSelection } from './duplicate-selection';
import { doCopy } from './copy-selection-as-png';
import { outlineSelection } from './outline-selection';
import { exportCanvasAsPng } from './export-canvas-as-png';
import { clearAllWithConfirm } from './clear-all';

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
