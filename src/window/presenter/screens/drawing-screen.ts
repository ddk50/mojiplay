// Drawing Screen: ベジェ・パス・文字を扱う中心 UI 画面の Composition Root。
//
// mojiplay の主要なドローイング機能 (文字配置 / アウトライン化 / アンカー編集 /
// ペン操作 / pan/zoom 等) を担う画面。`#screen-drawing` wrapper 配下の DOM
// (`drawing-*` prefix の全 ID) と Controller / State / Tool / Presenter を生成
// して紐付ける。
//
// 別 screen (例: 将来追加予定の font-viewer) との切替は ScreenManager 経由。
// 切替トリガを呼ぶために deps として ScreenManager を受け取っておく
// (= 例: toolbar から「Font Viewer を開く」ボタンを足した時に
// `deps.screenManager.show('font-viewer')` を click handler から呼べる)。
//
// 起動シーケンス (mount):
//   1. SidebarElements / FontCatalog を用意 (DOM 取得と font 一覧の器)
//   2. fabric.Canvas / State / HostShell / UIPort / Repository / FileIOInteractor 構築
//   3. Tool インスタンスと mode button (buildModeButtons) 生成
//   4. MenuActionRegistry 構築 + screen 内で wiring validate
//   5. 6 個の Controller を構築して attach
//   6. Presenter (Sidebar / AnchorOverlay) を self-wiring attach
//   7. attachSidebarChrome() でサイドバーの枠 (幅 / 折りたたみ) を有効化
//   8. システムフォント列挙を fire-and-forget で開始 (失敗時は HTML の既定値のまま)
// unmount で全 Presenter / Controller detach + sidebar chrome detach。

import type { Tool } from '../../usecases/tools/tool-interface';
import type { Mode } from '../../core/state-interface';
import { SelectCharTool } from '../../usecases/tools/select-char-tool';
import { SelectGroupTool } from '../../usecases/tools/select-group-tool';
import { TextTool } from '../../usecases/tools/text-tool';
import { PenAddTool } from '../../usecases/tools/pen-add-tool';
import { PenRemoveTool } from '../../usecases/tools/pen-remove-tool';
import { HandTool } from '../../usecases/tools/hand-tool';

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
import { buildModeButtons } from '../toolbar';
import { SidebarPresenter } from '../sidebar';
import { AnchorOverlayPresenter } from '../anchor-overlay';
import { currentTextProps } from '../font-current';
import { attachSidebarChrome } from '../sidebar-chrome';
import { querySidebarElements } from '../sidebar-elements';
import { refreshFontLists } from '../sidebar-font-list';
import { loadSystemFonts } from '../font-list-loader';
import { FontCatalog } from '../../core/font-catalog';

import type { CanvasInputController } from '../../controllers/canvas-input-interface';
import type { KeyboardController } from '../../controllers/keyboard-interface';
import type { MenuController } from '../../controllers/menu-interface';
import type { ViewController } from '../../controllers/view-interface';
import type { ToolbarController } from '../../controllers/toolbar-interface';
import type { SidebarController } from '../../controllers/sidebar-interface';
import { CanvasInputControllerImpl } from '../../controllers/canvas-input';
import { KeyboardControllerImpl } from '../../controllers/keyboard';
import { MenuControllerImpl } from '../../controllers/menu';
import { ViewControllerImpl } from '../../controllers/view';
import { ToolbarControllerImpl } from '../../controllers/toolbar';
import { SidebarControllerImpl } from '../../controllers/sidebar';

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
  // deps.screenManager は将来 toolbar の screen 切替ボタンから呼ばれる予定。
  // 現状は使用箇所が無いので unused suppress (`_deps`)。

  const root = document.getElementById('screen-drawing');
  if (!root) throw new Error('#screen-drawing not found in index.html');

  let detach: (() => void) | null = null;

  return {
    id: 'drawing',
    root,

    async mount(): Promise<void> {
      // ── 1. Sidebar DOM / FontCatalog ─────────────────────────────────
      // DOM 取得はここ 1 か所だけ (consumer は els を DI で受け取る)。
      const els = querySidebarElements(root);
      const catalog = new FontCatalog();

      // ── 2. fabric / State / Host / UI / Repo / FileIO ────────────────
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
        // skew ジェスチャ (中間ハンドル + Shift) を無効化。アンカー編集の確定処理
        // (finalizeDrag) と undo 復元が skew 未対応のため、発動自体を封じる。
        altActionKey: 'none',
      });

      const fontProvider = new FontkitFontProvider();
      const state = new State(canvas, fontProvider, { historyMax: 100 });
      const host = new ElectronHostShell();
      const ui = new ElectronUIPort();
      const repo = new FileSystemDocumentRepository();
      const fileIO = new FileIOInteractorImpl(state, repo, ui, basename);

      // ── 3. Tool インスタンスと mode button ───────────────────────────
      const selectGroupTool = new SelectGroupTool();
      const selectCharTool = new SelectCharTool();
      const textTool = new TextTool(() => currentTextProps(els));
      const penAddTool = new PenAddTool();
      const penRemoveTool = new PenRemoveTool();
      // mode map 外の特殊ツール: 中ボタン drag で CanvasInputController が直接 routing
      const handTool = new HandTool();

      const tools: Record<Mode, Tool> = {
        'select-group': selectGroupTool,
        'select-char': selectCharTool,
        text: textTool,
        'pen-add': penAddTool,
        'pen-remove': penRemoveTool,
      };

      const modeButtonsContainer = document.getElementById('drawing-toolbar-modes');
      if (!modeButtonsContainer) throw new Error('#drawing-toolbar-modes not found');
      const modeButtons = buildModeButtons(
        Object.values(tools),
        modeButtonsContainer,
        // ToolbarController が attach 時に setMode を上書きで配線するため、ここの
        // onSelect は初期 placeholder (= 同期 init flow なので race 無し)。
        () => {
          /* no-op (overridden in ToolbarController.attach) */
        },
      );

      // ── 4. MenuActionRegistry ────────────────────────────────────────
      const menuActions: MenuActions = makeMenuActions({ state, ui, fileIO, host });
      // screen root を root として渡し、他 screen の data-action と混ざらない validation に
      validateMenuActionWiring(menuActions, root);

      // ── 5. Controllers ───────────────────────────────────────────────
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
        handTool,
        canvas,
        onZoomChanged: () => viewController.refreshTitle(),
      });
      const keyboardController: KeyboardController = new KeyboardControllerImpl({
        state,
        selectCharTool,
        menuActions,
      });
      const menuController: MenuController = new MenuControllerImpl({
        menuActions,
        host,
        state,
      });
      const toolbarController: ToolbarController = new ToolbarControllerImpl({
        state,
        tools,
        modeButtons,
      });
      const sidebarController: SidebarController = new SidebarControllerImpl({
        state,
        selectCharTool,
        menuActions,
        els,
        catalog,
      });

      const controllers = [
        viewController,
        canvasInputController,
        keyboardController,
        menuController,
        toolbarController,
        sidebarController,
      ] as const;
      controllers.forEach((c) => c.attach());

      // 内→外の Presenter self-wiring。Controller の後に attach することで、
      // selection イベント時に Tool の選択処理 → sidebar 同期の順を保つ
      // (fabric の listener は購読順に発火する)。
      const presenters = [
        new SidebarPresenter({ canvas, els, catalog }),
        new AnchorOverlayPresenter({ state, selectCharTool, canvas }),
      ] as const;
      presenters.forEach((p) => p.attach());

      // ── 7. Sidebar chrome (幅 / 折りたたみ / Tab hide。DOM-only helper) ──
      const sidebarRoot = document.getElementById('drawing-sidebar');
      if (!sidebarRoot) throw new Error('#drawing-sidebar not found');
      const detachSidebarChrome = attachSidebarChrome(sidebarRoot);

      // ── 8. システムフォント列挙 ───────────────────────────────────────
      // 数百 ms かかるので await せず fire-and-forget。取得できたら select を
      // 差し替え、失敗時は index.html の既定 (Arial / Regular) がそのまま残る。
      void loadSystemFonts(catalog).then((loaded) => {
        if (loaded) refreshFontLists(els, catalog);
      });

      detach = (): void => {
        for (const p of presenters) p.detach();
        for (const c of controllers) c.detach();
        detachSidebarChrome();
      };
    },

    unmount(): void {
      detach?.();
      detach = null;
    },
  };
}
