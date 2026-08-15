// DocumentInteractor の Impl。History + dirty token + 永続化オーケストレーションを
// 所有し、canvas への反映はすべて CanvasPort 経由 (fabric 不知)。
//
// snapshot は不透明 blob として扱う — 中身 (fabric の toObject 形式) を解釈するのは
// port の impl (presenter/fabric-canvas-port.ts) だけ。ここには差分計算も座標数学も
// 持たない (state-jump 設計、CLAUDE.md 参照)。
//
// logger は使わない (usecases は presenter/logger を import しない規約)。
// undo/redo が実行 Command を返すのはそのため — ログは呼び手 (State facade) が担う。

import { History } from '../core/history/history';
import type { Command } from '../core/history/types';
import type { DocumentSnapshot } from '../core/document/snapshot';
import type { CanvasPort } from './canvas-port-interface';
import type { DocumentInteractor } from './document-interactor-interface';

export interface DocumentInteractorDeps {
  port: CanvasPort;
  /** History 上限。default 100 */
  historyMax?: number;
}

export class DocumentInteractorImpl implements DocumentInteractor {
  private readonly port: CanvasPort;
  private readonly history: History;

  // dirty tracking 用の opaque token。document を変えうる全操作 (pushCommand /
  // undo / redo / clearHistory / applySnapshot) で increment し、listener を発火。
  private tokenCounter = 0;
  private mutationListeners: Array<() => void> = [];

  constructor(deps: DocumentInteractorDeps) {
    this.port = deps.port;
    this.history = new History({ max: deps.historyMax ?? 100 });
  }

  pushCommand(cmd: Command): void {
    this.history.push(cmd);
    this.bumpToken();
  }

  undo(): Command | null {
    const cmd = this.history.undo();
    if (!cmd) return null;
    this.revertCommand(cmd);
    this.bumpToken();
    // Phase A 規約: undo は selection を能動的に変更しない (camera 層は履歴対象外)
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.history.redo();
    if (!cmd) return null;
    this.applyCommand(cmd);
    this.bumpToken();
    return cmd;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  clearHistory(): void {
    this.history.clear();
    this.bumpToken();
  }

  linearizeHistory(): ReadonlyArray<Command> {
    return this.history.linearize();
  }

  getHistoryToken(): number {
    return this.tokenCounter;
  }

  onMutate(cb: () => void): () => void {
    this.mutationListeners.push(cb);
    return () => {
      this.mutationListeners = this.mutationListeners.filter((c) => c !== cb);
    };
  }

  toSnapshot(): DocumentSnapshot {
    return {
      format: 'mojiplay',
      version: 1,
      canvas: this.port.dumpDocument(),
    };
  }

  async applySnapshot(s: DocumentSnapshot): Promise<void> {
    await this.port.loadDocument(s.canvas);
    // 注: data.objectId は信頼してそのまま採用 (再発行しない)。
    // 単一 window 前提。複数 window 同時 load を許す機能を入れる時は要検討。
    this.clearHistory();
  }

  // ----- Command apply / revert (state-jump: snapshot を丸ごと書き戻すだけ) -----

  private applyCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        this.port.writeSnapshot(cmd.after);
        break;
      case 'objectCreated':
        this.port.createFromSnapshot(cmd.after);
        break;
      case 'objectDeleted':
        this.port.removeObject(cmd.objectId);
        break;
      case 'compound':
        cmd.commands.forEach((c) => this.applyCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    this.port.requestRender();
  }

  private revertCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        this.port.writeSnapshot(cmd.before);
        break;
      case 'objectCreated':
        this.port.removeObject(cmd.objectId);
        break;
      case 'objectDeleted':
        this.port.createFromSnapshot(cmd.before);
        break;
      case 'compound':
        // 逆順で revert (= apply の逆順序で打ち消す)
        [...cmd.commands].reverse().forEach((c) => this.revertCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    this.port.requestRender();
  }

  private bumpToken(): void {
    this.tokenCounter++;
    this.mutationListeners.forEach((cb) => cb());
  }
}
