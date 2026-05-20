// Drawing Screen: ベジェ・パス・文字を扱う中心 UI 画面の Composition Root。
//
// mojiplay の主要なドローイング機能 (文字配置 / アウトライン化 / アンカー編集 /
// ペン操作 / pan/zoom 等) を担う画面。`#screen-drawing` wrapper 配下の DOM
// (`drawing-*` prefix の全 ID) と Controller / State / Tool / sidebar を生成
// して紐付ける。
//
// 別 screen (例: 将来追加予定の font-viewer) との切替は ScreenManager 経由。
// 切替トリガを呼ぶために deps として ScreenManager を受け取っておく
// (= 例: bottom-bar から「Font Viewer を開く」ボタンを足した時に
// `deps.screenManager.show('font-viewer')` を click handler から呼べる)。
//
// 起動シーケンス (mount):
//   1. fabric.Canvas / State / HostShell / UIPort / Repository / FileIOInteractor 構築
//   2. Tool インスタンスと buildToolbar (modeButtons) 生成
//   3. MenuActionRegistry 構築 + screen 内で wiring validate
//   4. 5 個の Controller を構築して attach
//   5. attachSidebar() でサイドバー operate を有効化
// unmount で全 Controller detach + sidebar detach。

import type { Tool } from '../../usecases/tools/tool-interface';
import type { Mode } from '../../core/state-interface';
import { SelectCharTool } from '../../usecases/tools/select-char-tool';
import { SelectGroupTool } from '../../usecases/tools/select-group-tool';
import { TextTool } from '../../usecases/tools/text-tool';
import { PenAddTool } from '../../usecases/tools/pen-add-tool';
import { PenRemoveTool } from '../../usecases/tools/pen-remove-tool';

import { State } from '../state';
import { FontkitFontProvider } from '../font-provider-fontkit';
import { ElectronUIPort } from '../ui-port-impl';
import { ElectronHostShell } from '../electron-host-shell';
import { FileIOInteractorImpl } from '../../usecases/menu/file-io-interactor';
import { FileSystemDocumentRepository } from '../../repository/file-system-document';
import {
  makeMenuActions,
  type MenuActions,
  validateMenuActionWiring,
} from '../../menu-action-registry';
import { buildToolbar } from '../toolbar';
import { currentTextProps } from '../font-current';
import { attachSidebar } from '../sidebar';

import type { CanvasInputController } from '../../controllers/canvas-input-interface';
import type { KeyboardController } from '../../controllers/keyboard-interface';
import type { MenuController } from '../../controllers/menu-interface';
import type { ViewController } from '../../controllers/view-interface';
import type { ToolbarController } from '../../controllers/toolbar-interface';
import { CanvasInputControllerImpl } from '../../controllers/canvas-input';
import { KeyboardControllerImpl } from '../../controllers/keyboard';
import { MenuControllerImpl } from '../../controllers/menu';
import { ViewControllerImpl } from '../../controllers/view';
import { ToolbarControllerImpl } from '../../controllers/toolbar';

import type { Screen } from './screen-interface';
import type { ScreenManager } from './screen-manager';

export interface DrawingScreenDeps {
  readonly screenManager: ScreenManager;
}

// renderer (browser context) では Node.js の path module を使えないので basename は inline。
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function createDrawingScreen(_deps: DrawingScreenDeps): Screen {
  // deps.screenManager は将来 bottom-bar の screen 切替ボタンから呼ばれる予定。
  // 現状は使用箇所が無いので unused suppress (`_deps`)。

  const root = document.getElementById('screen-drawing');
  if (!root) throw new Error('#screen-drawing not found in index.html');

  let detach: (() => void) | null = null;

  return {
    id: 'drawing',
    root,

    async mount(): Promise<void> {
      // ── 1. fabric / State / Host / UI / Repo / FileIO ────────────────
      const container = document.getElementById('drawing-canvas-container') as HTMLDivElement;
      if (!container) throw new Error('#drawing-canvas-container not found');

      const canvas = new fabric.Canvas('drawing-main-canvas', {
        backgroundColor: undefined,
        preserveObjectStacking: true,
        selection: true,
        // 範囲選択 (ドラッグマーキー) の見た目: 薄いブルー塗り + ブルー点線
        selectionColor: 'rgba(0, 102, 255, 0.08)',
        selectionBorderColor: '#0066ff',
        selectionLineWidth: 1,
        selectionDashArray: [5, 3],
      });

      const fontProvider = new FontkitFontProvider();
      const state = new State(canvas, fontProvider, { historyMax: 100 });
      const host = new ElectronHostShell();
      const ui = new ElectronUIPort();
      const repo = new FileSystemDocumentRepository();
      const fileIO = new FileIOInteractorImpl(state, repo, ui, basename);

      // ── 2. Tool インスタンスと buildToolbar ──────────────────────────
      const selectGroupTool = new SelectGroupTool();
      const selectCharTool = new SelectCharTool();
      const textTool = new TextTool(currentTextProps);
      const penAddTool = new PenAddTool();
      const penRemoveTool = new PenRemoveTool();

      const tools: Record<Mode, Tool> = {
        'select-group': selectGroupTool,
        'select-char': selectCharTool,
        text: textTool,
        'pen-add': penAddTool,
        'pen-remove': penRemoveTool,
      };

      const toolButtonsContainer = document.getElementById('drawing-tool-buttons');
      if (!toolButtonsContainer) throw new Error('#drawing-tool-buttons not found');
      const modeButtons = buildToolbar(
        Object.values(tools),
        toolButtonsContainer,
        // ToolbarController が attach 時に setMode を上書きで配線するため、ここの
        // onSelect は初期 placeholder (= 同期 init flow なので race 無し)。
        () => {
          /* no-op (overridden in ToolbarController.attach) */
        },
      );

      // ── 3. MenuActionRegistry ────────────────────────────────────────
      const menuActions: MenuActions = makeMenuActions({ state, ui, fileIO, host });
      // screen root を root として渡し、他 screen の data-action と混ざらない validation に
      validateMenuActionWiring(menuActions, root);

      // ── 4. Controllers ───────────────────────────────────────────────
      const viewController: ViewController = new ViewControllerImpl({
        host,
        fileIO,
        canvas,
        container,
      });
      const canvasInputController: CanvasInputController = new CanvasInputControllerImpl({
        state,
        tools,
        selectCharTool,
        canvas,
        onZoomChanged: () => viewController.refreshTitle(),
      });
      const keyboardController: KeyboardController = new KeyboardControllerImpl({
        state,
        selectCharTool,
        menuActions,
        canvas,
      });
      const menuController: MenuController = new MenuControllerImpl({
        menuActions,
        host,
        canvas,
      });
      const toolbarController: ToolbarController = new ToolbarControllerImpl({
        state,
        tools,
        selectCharTool,
        menuActions,
        modeButtons,
      });

      const controllers = [
        viewController,
        canvasInputController,
        keyboardController,
        menuController,
        toolbarController,
      ] as const;
      controllers.forEach((c) => c.attach());

      // ── 5. Sidebar (DOM-only helper) ─────────────────────────────────
      const sidebarRoot = document.getElementById('drawing-sidebar');
      if (!sidebarRoot) throw new Error('#drawing-sidebar not found');
      const detachSidebar = attachSidebar(sidebarRoot);

      detach = (): void => {
        for (const c of controllers) c.detach();
        detachSidebar();
      };
    },

    unmount(): void {
      detach?.();
      detach = null;
    },
  };
}
