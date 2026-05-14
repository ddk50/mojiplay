// renderer エントリーポイント (DI 容器)。
//
// CA Interface Adapter (Controller / Presenter / Gateway) を物理ディレクトリで
// sibling 分離し、ここは「依存解決と attach の wiring」だけを担う薄い容器。
// business logic は state.ts (renderer/) と各 controllers/ に分散している。
//
// 起動シーケンス:
//   1. fabric.Canvas / State / HostShell / UIPort / Repository / FileIOInteractor 構築
//   2. Tool インスタンスと buildToolbar (modeButtons) 生成
//   3. MenuActionRegistry 構築 (= dispatch table)
//   4. 5 個の Controller を構築して attach
//   5. window.unload で全 Controller を detach (event listener leak 防止)

import type { Tool } from '../usecases/tools/tool-interface';
import type { Mode } from '../core/state-interface';
import { SelectCharTool } from '../usecases/tools/select-char-tool';
import { SelectGroupTool } from '../usecases/tools/select-group-tool';
import { TextTool } from '../usecases/tools/text-tool';
import { PenAddTool } from '../usecases/tools/pen-add-tool';
import { PenRemoveTool } from '../usecases/tools/pen-remove-tool';

import { State } from './state';
import { ElectronUIPort } from './ui-port-impl';
import { ElectronHostShell } from './electron-host-shell';
import { FileIOInteractor } from '../usecases/menu/file-io-interactor';
import { FileSystemDocumentRepository } from '../repository/file-system-document';
import { createMenuActionRegistry } from '../usecases/menu/menu-action-registry';
import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';
import { buildToolbar } from './toolbar';
import { currentTextProps } from './font-current';

import type { CanvasInputController } from '../controllers/canvas-input-interface';
import type { KeyboardController } from '../controllers/keyboard-interface';
import type { MenuController } from '../controllers/menu-interface';
import type { ViewController } from '../controllers/view-interface';
import type { ToolbarController } from '../controllers/toolbar-interface';
import { CanvasInputControllerImpl } from '../controllers/canvas-input';
import { KeyboardControllerImpl } from '../controllers/keyboard';
import { MenuControllerImpl } from '../controllers/menu';
import { ViewControllerImpl } from '../controllers/view';
import { ToolbarControllerImpl } from '../controllers/toolbar';

// ── 1. fabric / State / Host / UI / Repo / FileIO ──────────────────────────

const container = document.getElementById('canvas-container') as HTMLDivElement;

const canvas = new fabric.Canvas('main-canvas', {
  backgroundColor: undefined,
  preserveObjectStacking: true,
  selection: true,
  // 範囲選択 (ドラッグマーキー) の見た目: 薄いブルー塗り + ブルー点線
  selectionColor: 'rgba(0, 102, 255, 0.08)',
  selectionBorderColor: '#0066ff',
  selectionLineWidth: 1,
  selectionDashArray: [5, 3],
});

const state = new State(canvas, { historyMax: 100 });
const host = new ElectronHostShell();
const ui = new ElectronUIPort();
const repo = new FileSystemDocumentRepository();

// renderer (browser context) では Node.js の path module を使えないので basename は inline。
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

const fileIO = new FileIOInteractor(state, repo, ui, basename);

// ── 2. Tool インスタンスと buildToolbar ────────────────────────────────────

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

const toolButtonsContainer = document.getElementById('tool-buttons');
if (!toolButtonsContainer) throw new Error('#tool-buttons container not found in index.html');
const modeButtons = buildToolbar(
  Object.values(tools),
  toolButtonsContainer,
  // ToolbarController が attach 時に setMode を上書きで配線するため、ここの onSelect は
  // 初期 placeholder。ToolbarController のコンストラクタが呼ばれる前にユーザが
  // クリックする状況は無い (= 同期 init flow)。
  () => {
    /* no-op (overridden in ToolbarController.attach) */
  },
);

// ── 3. MenuActionRegistry ─────────────────────────────────────────────────

const menuActions: MenuActionRegistry = createMenuActionRegistry({ state, ui, fileIO, host });

// ── 4. Controllers ────────────────────────────────────────────────────────
// 変数の型は interface 側を使う (= consumer は contract のみに依存)。
// 構築は Impl クラス経由 (= construction の詳細だけが Impl を知る)。

const viewController: ViewController = new ViewControllerImpl({ host, fileIO, canvas, container });
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
const menuController: MenuController = new MenuControllerImpl({ menuActions, host, canvas });
const toolbarController: ToolbarController = new ToolbarControllerImpl({
  state,
  tools,
  selectCharTool,
  host,
  menuActions,
  canvas,
  modeButtons,
});

// 構造的型付けで .attach / .detach を持つことを推論させる (= 共有 interface 不要)。
const controllers = [
  viewController,
  canvasInputController,
  keyboardController,
  menuController,
  toolbarController,
] as const;

controllers.forEach((c) => c.attach());

// ── 5. unload で detach ───────────────────────────────────────────────────

window.addEventListener('unload', () => {
  for (const c of controllers) c.detach();
});
