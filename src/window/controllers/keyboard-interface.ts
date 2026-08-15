// KeyboardController の public 契約。
//
// Impl は ./keyboard-controller.ts の KeyboardControllerImpl。test double は本
// interface を object literal で満たせばよい。

import type { State } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';

export interface KeyboardControllerDeps {
  state: State;
  selectCharTool: SelectCharTool;
  menuActions: MenuActions;
}

export interface KeyboardController {
  onKeyDownCapture(e: KeyboardEvent): void;
  onKeyDownBubble(e: KeyboardEvent): void;
  attach(): void;
  detach(): void;
}
