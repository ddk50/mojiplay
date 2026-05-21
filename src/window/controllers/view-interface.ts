// ViewController の public 契約。
//
// Impl は ./view-controller.ts の ViewControllerImpl。

import type { HostShell, CloseGuardDecision } from '../usecases/host-shell-interface';
import type { FileIOInteractor } from '../usecases/menu/file-io-interactor-interface';

export interface ViewControllerDeps {
  host: HostShell;
  fileIO: FileIOInteractor;
  canvas: fabric.Canvas;
  container: HTMLElement;
}

export interface ViewController {
  onResize(): void;
  refreshTitle(): void;
  onCloseGuardRequest(): Promise<CloseGuardDecision>;
  attach(): void;
  detach(): void;
}
