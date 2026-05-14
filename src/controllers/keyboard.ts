// KeyboardController: document keydown を MenuAction / Tool command に dispatch する
// Input Adapter。
//
// shortcut 表は usecases/menu/key-binding.ts の KEY_BINDINGS (pure data + matcher) に
// 移動。controller は:
//   - IText 編集中 / IME composition / toolbar input focus 等の event filter
//   - matchKeyBinding で binding を引いて menuActions に dispatch
//   - 矢印キー (= parameterized で binding table に乗らない例外)
// だけを行う。binding table 自体は単体 test 済 (test/key-binding.test.ts)。
//
// Enter による IText commit (capture phase で fabric の keydown を奪って exitEditing)
// は fabric event chain の trigger で binding table のモデル外なので inline 残す。
// (text:editing:exited → State.handleTextEditingExited → 文字分割の経路を起動)

import type { State } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';
import type { KeyboardController, KeyboardControllerDeps } from './keyboard-interface';
import {
  arrowKeyToDirection,
  arrowStepMagnitude,
  moveSelectedAnchorsByArrow,
} from '../usecases/menu/move-selected-anchors-by-arrow';
import { matchKeyBinding, type BindingContext } from '../usecases/menu/key-binding';

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

    // 編集中 / IME composition は global shortcut を bypass
    if (editing || e.isComposing) return;

    this.dispatchBinding(e, 'capture');
  };

  /** bubble phase keydown。fabric の処理後で良いもの (shortcut 全般 + 矢印キー)。 */
  readonly onKeyDownBubble = (e: KeyboardEvent): void => {
    if (this.isEditingIText()) return;

    if (this.dispatchBinding(e, 'bubble')) return;

    // 矢印キー: select-char モードで選択中アンカーを world delta で平行移動。
    // parameterized (direction + magnitude) なので binding table に乗らず inline。
    if (
      this.state.getCurrentMode() === 'select-char' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !this.isToolbarInput()
    ) {
      const dir = arrowKeyToDirection(e.key);
      if (dir) {
        const magnitude = arrowStepMagnitude(e.shiftKey);
        if (moveSelectedAnchorsByArrow(this.state, this.selectCharTool, dir, magnitude)) {
          e.preventDefault();
        }
      }
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

  /** binding に hit したら preventDefault + (capture のみ) stopPropagation + dispatch。
   *  hit したかを返す (caller が特殊フォールバックを試すかの判定用)。 */
  private dispatchBinding(e: KeyboardEvent, phase: 'capture' | 'bubble'): boolean {
    const binding = matchKeyBinding(e, phase, this.buildContext());
    if (!binding) return false;
    if (binding.preventDefault !== false) e.preventDefault();
    if (phase === 'capture') e.stopPropagation();
    void this.menuActions.execute(binding.action);
    return true;
  }

  private buildContext(): BindingContext {
    return {
      hasActiveObject: !!this.canvas.getActiveObject(),
      isToolbarInput: this.isToolbarInput(),
    };
  }

  private isEditingIText(): boolean {
    const active = this.canvas.getActiveObject();
    return active?.type === 'i-text' && (active as fabric.IText).isEditing === true;
  }

  private isToolbarInput(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }
}
