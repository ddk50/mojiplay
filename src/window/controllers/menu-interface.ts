// MenuController の public 契約。
//
// Impl は ./menu-controller.ts の MenuControllerImpl。

import type { MenuActions } from '../menu-action-registry';
import type { HostShell } from '../usecases/host-shell-interface';
import type { State } from '../core/state-interface';

export interface MenuControllerDeps {
  menuActions: MenuActions;
  host: HostShell;
  state: State;
}

export interface MenuController {
  onMenuAction(actionId: string): void;
  onCopyRequest(): void;
  attach(): void;
  detach(): void;
}
