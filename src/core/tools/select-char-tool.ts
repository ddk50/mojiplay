// 白矢印 (Direct Selection) ツール。
//
// 役割:
//   - アウトライン化済 fabric.Path のアンカー / ベジェハンドルを掴んでドラッグ移動
//   - 何にもヒットしない時はホストの選択 (= パス全体ドラッグ) に道を譲る
//   - ホバー時にアンカー/ハンドル上ならカーソルを切替
//   - パス全体ドラッグ中はグリッドスナップ (Alt で一時バイパス)
//
// 入力 (PointerInput) と出力 (PathHandle / ToolHost) は core/tools/types.ts で
// 抽象化されており、本クラスは fabric / DOM を一切知らない。
// テストは FakePathHandle と FakeToolHost を渡すだけで全挙動を検証可能。
//
// 中間ドラッグ更新は path.setCommands() で頻繁に呼び、bbox 再計算は
// pointerUp で 1 回だけ path.finalizeEdit() を呼ぶ (コスト集約)。
//
// dual-mode export: ブラウザではグローバル class、Node test では module.exports。

// Node test 時に依存モジュールを pre-load して globalThis に関数を載せる。
// 詳細は overlay-layout.ts の冒頭ガードコメント参照。
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('../path/coords');
  // @ts-ignore
  require('../path/anchors');
  // @ts-ignore
  require('./overlay-layout');
}

interface SnapConfig {
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

class SelectCharTool implements Tool {
  // 既定値は app.ts のトップ初期値と一致させる (pitch=8, threshold=5)。
  private snap: SnapConfig = { enabled: true, pitch: 8, threshold: 5 };
  private drag: SelectCharDragState | null = null;
  private dragPath: PathHandle | null = null;

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
    this.drag = null;
    this.dragPath = null;
    p.finalizeEdit();
    host.requestRerender();
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
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.SelectCharTool = SelectCharTool;
}
