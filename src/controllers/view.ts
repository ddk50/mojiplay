// ViewController: window 系の入出力 (resize / close guard / タイトル) を扱う
// Input Adapter。
//
// 旧 app.ts の resizeCanvas + updateWindowTitle 配線 + electronAPI.onAppCloseRequest
// 配線をここに集約。HostShell 経由で window 系の出力 (zoom / fullscreen / devtools /
// dirty 通知) にもアクセスするが、ボタン側の購読は他 Controller に委譲。

import type { HostShell, CloseGuardDecision } from '../usecases/host-shell-interface';
import type { FileIOInteractor } from '../usecases/menu/file-io-interactor';
import type {
  ViewController, ViewControllerDeps,
} from './view-interface';
import { updateWindowTitle } from '../renderer/window-title';

export class ViewControllerImpl implements ViewController {
  private readonly host: HostShell;
  private readonly fileIO: FileIOInteractor;
  private readonly canvas: fabric.Canvas;
  private readonly container: HTMLElement;
  private unsubscribeCloseGuard: (() => void) | null = null;
  private unsubscribeDocStatus: (() => void) | null = null;

  constructor(deps: ViewControllerDeps) {
    this.host = deps.host;
    this.fileIO = deps.fileIO;
    this.canvas = deps.canvas;
    this.container = deps.container;
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  /** window resize: canvas を container にフィットさせる。 */
  readonly onResize = (): void => {
    this.canvas.setWidth(this.container.clientWidth);
    this.canvas.setHeight(this.container.clientHeight);
    this.canvas.renderAll();
  };

  /** dirty / fileName / zoom 変化時にタイトルバーの表記を更新する。 */
  readonly refreshTitle = (): void => {
    updateWindowTitle(this.canvas, this.fileIO);
  };

  /** HostShell.onCloseGuardRequest (= window 閉じ要求) で呼ばれる。
   *  3 択 dialog を出して保存可否を判断し、'destroy' / 'cancel' を返す。 */
  readonly onCloseGuardRequest = async (): Promise<CloseGuardDecision> => {
    const ok = await this.fileIO.confirmDiscardIfDirty();
    return ok ? 'destroy' : 'cancel';
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    window.addEventListener('resize', this.onResize);
    this.onResize();

    // 起動初期化と継続的な title 同期
    this.refreshTitle();
    this.unsubscribeDocStatus = this.fileIO.subscribeDocStatus(() => this.refreshTitle());

    this.unsubscribeCloseGuard = this.host.onCloseGuardRequest(this.onCloseGuardRequest);
  }

  detach(): void {
    window.removeEventListener('resize', this.onResize);
    this.unsubscribeDocStatus?.();
    this.unsubscribeDocStatus = null;
    this.unsubscribeCloseGuard?.();
    this.unsubscribeCloseGuard = null;
  }
}
