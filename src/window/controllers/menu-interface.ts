// MenuController の public 契約。
//
// Impl は ./menu-controller.ts の MenuControllerImpl。

import type { MenuActions } from '../menu-action-registry';
import type { HostShell } from '../usecases/host-shell-interface';

export interface MenuControllerDeps {
  menuActions: MenuActions;
  host: HostShell;
  canvas: fabric.Canvas;
}

export interface MenuController {
  onMenuAction(actionId: string): void;
  onCopyRequest(): void;
  attach(): void;
  detach(): void;
}
