// MenuController: HTML メニューバーと HostShell からの copy/paste 要求を MenuAction
// に dispatch する Input Adapter。
//
// HTML メニューバーは renderer/menu-bar.ts (initMenuBar) が data-action 属性付きの
// button click を吸い上げる。ここで受けた action id を menuActions.execute() に流す。
//
// HostShell.onCopyRequest は Electron native menu の Edit > Copy IPC を渡す。
// IText 編集中は fabric/Electron の native copy に任せたいので bypass する
// (= 既存挙動踏襲)。

import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';
import type { HostShell } from '../usecases/host-shell-interface';
import type { MenuController, MenuControllerDeps } from './menu-interface';
import { initMenuBar } from '../renderer/menu-bar';

export class MenuControllerImpl implements MenuController {
  private readonly menuActions: MenuActionRegistry;
  private readonly host: HostShell;
  private readonly canvas: fabric.Canvas;
  private unsubscribeCopy: (() => void) | null = null;

  constructor(deps: MenuControllerDeps) {
    this.menuActions = deps.menuActions;
    this.host = deps.host;
    this.canvas = deps.canvas;
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  /** HTML メニューバーの data-action click から呼ばれる (initMenuBar 経由)。 */
  readonly onMenuAction = (actionId: string): void => {
    void this.menuActions.execute(actionId);
  };

  /** HostShell.onCopyRequest (= Electron native menu の Edit > Copy IPC) から呼ばれる。
   *  IText 編集中は fabric/Electron の native copy に任せたいので bypass する。 */
  readonly onCopyRequest = (): void => {
    this.host.log.debug('[copy] menu-copy IPC received');
    const active = this.canvas.getActiveObject();
    if (active?.type === 'i-text' && (active as fabric.IText).isEditing) return;
    void this.menuActions.execute('copy');
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    initMenuBar(this.onMenuAction);
    this.unsubscribeCopy = this.host.onCopyRequest(this.onCopyRequest);
  }

  detach(): void {
    // initMenuBar が attach した DOM listener は detach 関数を返さないため、
    // window.unload まで残置する設計。複数 attach は前提しない。
    this.unsubscribeCopy?.();
    this.unsubscribeCopy = null;
  }
}
