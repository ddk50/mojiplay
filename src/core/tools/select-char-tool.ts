// 白矢印 (Direct Selection) ツール。
//
// 役割:
//   - アウトライン化済 fabric.Path のアンカー / ベジェハンドルを掴んでドラッグ移動
//   - 何にもヒットしない時はホストの選択 (= パス全体ドラッグ) に道を譲る
//   - ホバー時にアンカー/ハンドル上ならカーソルを切替
//   - パス全体ドラッグ中はグリッドスナップ (Alt で一時バイパス)
//
// 入力 (PointerInput) と出力 (PathHandle / ToolHost) は core/tools/tool-interface.ts で
// 抽象化されており、本クラスは fabric / DOM を一切知らない。
// テストは FakePathHandle と FakeToolHost を渡すだけで全挙動を検証可能。
//
// 中間ドラッグ更新は path.setCommands() で頻繁に呼び、bbox 再計算は
// pointerUp で 1 回だけ path.finalizeEdit() を呼ぶ (コスト集約)。

import type { Point, PathCommand, HandleRef } from '../path/types';
import { moveAnchorRigid, moveHandle } from '../path/anchors';
import { worldDeltaToPathLocalDelta } from '../path/coords';
import { computeOverlayLayout, hitTestAnchorAt, hitTestHandleAt } from './overlay-layout';
import type {
  Tool, ToolDescriptor, ToolHost, PathHandle, PointerInput, PointerHandled,
  MovingTarget, CanvasMouseDownInput,
} from './tool-interface';
import type { ObjectSnapshot } from '../history/types';

export interface SnapConfig {
  readonly enabled: boolean;
  readonly pitch: number;
  readonly threshold: number;
}

type SelectCharDragState =
  | {
      readonly kind: 'anchor';
      readonly anchorIndex: number;
      lastWorld: Point;
    }
  | {
      readonly kind: 'handle';
      readonly handle: HandleRef;
      lastWorld: Point;
    };

export class SelectCharTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id:    'select-char',
    label: '文字選択/カーニング (白矢印)',
    iconSvg:
      '<svg class="tool-icon outline-arrow" viewBox="0 0 14 18" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M2,1 L2,14 L5,11 L7.5,16.5 L9.5,15.5 L7,10 L12,10 Z"/>' +
      '</svg>',
  };

  // 既定値は app.ts のトップ初期値と一致させる (pitch=8, threshold=5)。
  private snap: SnapConfig = { enabled: true, pitch: 8, threshold: 5 };
  private drag: SelectCharDragState | null = null;
  private dragPath: PathHandle | null = null;
  // History 用: drag 開始時の snapshot を保持し、drag 終了時に Command を構築する
  private beforeSnapshot: ObjectSnapshot | null = null;

  setSnapConfig(cfg: SnapConfig): void {
    this.snap = cfg;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  onActivate(_host: ToolHost): void { /* no-op */ }

  onDeactivate(host: ToolHost): void {
    this.drag = null;
    this.dragPath = null;
    this.beforeSnapshot = null;
    host.setCursor('');
  }

  onPointerDown(e: PointerInput, host: ToolHost): PointerHandled {
    const path = host.getActivePath();
    if (!path) return 'pass';

    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, host.getViewportMatrix());

    // ハンドルを優先 (アンカーと重なって見える事があるため)
    const hitHandle = hitTestHandleAt(layout, e.screenX, e.screenY);
    if (hitHandle) {
      this.drag = {
        kind: 'handle',
        handle: hitHandle.handle,
        lastWorld: { x: e.worldX, y: e.worldY },
      };
      this.dragPath = path;
      this.beforeSnapshot = path.captureForHistory();
      return 'consumed';
    }

    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    if (aIdx >= 0) {
      this.drag = {
        kind: 'anchor',
        anchorIndex: aIdx,
        lastWorld: { x: e.worldX, y: e.worldY },
      };
      this.dragPath = path;
      this.beforeSnapshot = path.captureForHistory();
      return 'consumed';
    }

    return 'pass';
  }

  onPointerMove(e: PointerInput, host: ToolHost): void {
    if (this.drag && this.dragPath) {
      const path = this.dragPath;
      const snapshot = path.snapshot();
      const worldDx = e.worldX - this.drag.lastWorld.x;
      const worldDy = e.worldY - this.drag.lastWorld.y;
      const localDelta = worldDeltaToPathLocalDelta(
        { x: worldDx, y: worldDy },
        snapshot.pathMatrix,
      );

      let updated: PathCommand[];
      if (this.drag.kind === 'anchor') {
        updated = moveAnchorRigid(snapshot.commands, this.drag.anchorIndex, localDelta.x, localDelta.y);
      } else {
        updated = moveHandle(snapshot.commands, this.drag.handle, localDelta.x, localDelta.y);
      }
      path.setCommands(updated);
      this.drag.lastWorld = { x: e.worldX, y: e.worldY };
      host.requestRerender();
      return;
    }

    // ── Hover cursor ────────────────────────────────────────────────
    const path = host.getActivePath();
    if (!path) {
      host.setCursor('');
      return;
    }
    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, host.getViewportMatrix());
    if (hitTestHandleAt(layout, e.screenX, e.screenY)) {
      host.setCursor('pointer');
    } else if (hitTestAnchorAt(layout, e.screenX, e.screenY) >= 0) {
      host.setCursor('move');
    } else {
      host.setCursor('');
    }
  }

  onPointerUp(_e: PointerInput, host: ToolHost): void {
    if (!this.drag || !this.dragPath) return;
    const p = this.dragPath;
    const before = this.beforeSnapshot;
    this.drag = null;
    this.dragPath = null;
    this.beforeSnapshot = null;
    p.finalizeEdit();
    host.requestRerender();

    // History: anchor / handle drag が完了したら Command を push。
    // before/after が同一なら drag が ノーオペだったとみなして push しない。
    if (before) {
      const after = p.captureForHistory();
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        host.pushCommand({
          kind: 'objectChanged',
          objectId: p.getId(),
          before,
          after,
        });
      }
    }
  }

  onObjectMoving(target: MovingTarget, e: { altKey: boolean }, _host: ToolHost): void {
    if (!this.snap.enabled) return;
    if (e.altKey) return;  // Illustrator 慣例: Alt 押下中は一時バイパス

    const pitch = this.snap.pitch;
    const threshold = this.snap.threshold;

    const freeX = target.getLeft();
    const nearestX = Math.round(freeX / pitch) * pitch;
    if (Math.abs(freeX - nearestX) < threshold) target.setLeft(nearestX);

    const freeY = target.getTop();
    const nearestY = Math.round(freeY / pitch) * pitch;
    if (Math.abs(freeY - nearestY) < threshold) target.setTop(nearestY);
  }

  onSelectionChanged(_host: ToolHost): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _host: ToolHost): void { /* no-op */ }
}
