// KeyboardController: document keydown を MenuAction / Tool command に dispatch する
// Input Adapter。
//
// 旧 app.ts に散在した複数 keydown listener (capture phase Enter / Cmd+Z / Cmd+S /
// bubble phase 各種 shortcut) を 2 個の listener (capture + bubble) に集約。
//
// IText 編集中のスキップ条件も明示化:
//   - capture Enter: 編集中ならむしろ exitEditing を呼ぶ (= commit を完了)
//   - capture meta+Z / meta+S: 編集中なら bypass (IME / 文字編集を妨げない)
//   - bubble shortcut: 編集中なら一律 bypass

import type { State } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';
import type { KeyboardController, KeyboardControllerDeps } from './keyboard-interface';
import { isITextEditing } from '../renderer/fabric-internals';

export class KeyboardControllerImpl implements KeyboardController {
  private readonly state: State;
  private readonly selectCharTool: SelectCharTool;
  private readonly menuActions: MenuActionRegistry;
  private readonly canvas: fabric.Canvas;

  constructor(deps: KeyboardControllerDeps) {
    this.state = deps.state;
    this.selectCharTool = deps.selectCharTool;
    this.menuActions = deps.menuActions;
    this.canvas = deps.canvas;
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  /**
   * capture phase keydown。Fabric の keydown より先に走らせたいもの:
   *   - Enter で IText を exitEditing (= commit を完了)
   *   - Cmd+Z / Cmd+S 系 (IME / fabric の標準動作と競合しないよう capture で奪う)
   * IText 編集中は Enter 以外を bypass。
   */
  readonly onKeyDownCapture = (e: KeyboardEvent): void => {
    const editing = this.isEditingIText();

    // Enter で IText 確定 (capture phase で Fabric の keydown より先に exitEditing)
    if (e.key === 'Enter' && editing) {
      e.preventDefault();
      e.stopPropagation();
      const it = this.canvas.getActiveObject() as fabric.IText;
      it.exitEditing(); // → text:editing:exited → State.handleTextEditingExited
      return;
    }

    // 編集中は以降の global shortcut を bypass
    if (editing) return;
    if (e.isComposing) return;

    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;

    // Cmd+Z / Cmd+Shift+Z: undo / redo
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      void this.menuActions.execute('undo');
      return;
    }
    if (e.key === 'Z' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      void this.menuActions.execute('redo');
      return;
    }

    // Cmd+S / Cmd+Shift+S / Cmd+O
    if ((e.key === 'o' || e.key === 'O') && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      void this.menuActions.execute('file-open');
      return;
    }
    if ((e.key === 's' || e.key === 'S') && e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      void this.menuActions.execute('file-save-as');
      return;
    }
    if (e.key === 's' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      void this.menuActions.execute('file-save');
      return;
    }
  };

  /** bubble phase keydown。fabric の処理後で良いもの (shortcut 全般)。 */
  readonly onKeyDownBubble = (e: KeyboardEvent): void => {
    if (this.isEditingIText()) return;

    const meta = e.metaKey || e.ctrlKey;

    // Ctrl+C / Cmd+C: 選択を透過 PNG でクリップボードにコピー
    if (meta && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (!this.isToolbarInput() && this.canvas.getActiveObject()) {
        e.preventDefault();
        void this.menuActions.execute('copy');
      }
      return;
    }

    // Delete / Backspace: 選択削除
    if ((e.key === 'Delete' || e.key === 'Backspace') && !this.isToolbarInput()) {
      void this.menuActions.execute('delete');
    }

    // Cmd/Ctrl+D: 選択を複製 (Affinity / Sketch 慣例)
    if (meta && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      if (!this.isToolbarInput() && this.canvas.getActiveObject()) {
        e.preventDefault();
        void this.menuActions.execute('duplicate');
      }
      return;
    }

    // Cmd/Ctrl+Shift+O: 選択中テキストをアウトライン化 (Illustrator 慣例)
    if (meta && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      void this.menuActions.execute('outline');
    }

    // 矢印キー: select-char モードで選択中アンカーを world delta で平行移動
    // (1 unit / Shift+矢印で 10 unit、Photoshop 慣例)。Modifier 無し前提。
    if (
      this.state.getCurrentMode() === 'select-char' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !this.isToolbarInput()
    ) {
      let dx = 0,
        dy = 0;
      if (e.key === 'ArrowLeft') dx = -1;
      else if (e.key === 'ArrowRight') dx = 1;
      else if (e.key === 'ArrowUp') dy = -1;
      else if (e.key === 'ArrowDown') dy = 1;
      if (dx !== 0 || dy !== 0) {
        const step = e.shiftKey ? 10 : 1;
        if (this.selectCharTool.getSelectedAnchorIndices().size > 0) {
          e.preventDefault();
          this.selectCharTool.moveSelectedAnchorsBy(this.state, dx * step, dy * step);
        }
      }
    }

    // F12 / Ctrl+Shift+I: DevTools 開閉
    if (
      e.key === 'F12' ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'))
    ) {
      e.preventDefault();
      void this.menuActions.execute('devtools');
    }
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    document.addEventListener('keydown', this.onKeyDownCapture, true);
    document.addEventListener('keydown', this.onKeyDownBubble);
  }

  detach(): void {
    document.removeEventListener('keydown', this.onKeyDownCapture, true);
    document.removeEventListener('keydown', this.onKeyDownBubble);
  }

  // ====================================================================
  //  内部 helper
  // ====================================================================

  private isEditingIText(): boolean {
    return isITextEditing(this.canvas.getActiveObject());
  }

  private isToolbarInput(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }
}
