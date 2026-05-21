// 白矢印 (Direct Selection) ツール。
//
// 役割:
//   - アウトライン化済 fabric.Path のアンカー / ベジェハンドルを掴んでドラッグ移動
//   - 何にもヒットしない時はホストの選択 (= パス全体ドラッグ) に道を譲る
//   - ホバー時にアンカー/ハンドル上ならカーソルを切替
//   - パス全体ドラッグ中はグリッドスナップ (Alt で一時バイパス)
//
// 入力 (PointerInput) は core/tools/tool-interface.ts、State / PathHandle は
// core/state.ts で抽象化されており、本クラスは fabric / DOM を一切知らない。
// テストは FakePathHandle と FakeState を渡すだけで全挙動を検証可能。
//
// 中間ドラッグ更新は path.setPath() で頻繁に呼び、bbox 再計算は
// pointerUp で 1 回だけ path.finalizeEdit() を呼ぶ (コスト集約)。

import type { Point, HandleRef } from '../../core/path/types';
import { Path } from '../../core/path/path';
import { worldDeltaToPathLocalDelta } from '../../core/path/coords';
import {
  computeOverlayLayout,
  hitTestAnchorAt,
  hitTestHandleAt,
} from '../../core/path/overlay-layout';
import type {
  Tool,
  ToolDescriptor,
  PointerInput,
  PointerHandled,
  MovingTarget,
  CanvasMouseDownInput,
} from './tool-interface';
import type { State, PathHandle } from '../../core/state-interface';
import type { ObjectSnapshot } from '../../core/history/types';
import selectCharToolIcon from './icons/select-char-tool.svg';

export interface SnapConfig {
  readonly enabled: boolean;
  readonly pitch: number;
  readonly threshold: number;
}

type SelectCharDragState =
  | {
      // 1 個 or 複数アンカーを同時に剛体移動。selectedAnchors 全件を動かす。
      readonly kind: 'anchors';
      readonly anchorIndices: ReadonlyArray<number>;
      readonly startWorld: Point;
      // pointerDown 時点の Path snapshot。pointerMove の度に「累積 delta を
      // original から再適用」するモデル。これにより Shift 軸ロックの mid-drag
      // 切替が破綻せず、浮動小数点の累積誤差も防げる。
      readonly originalPath: Path;
    }
  | {
      readonly kind: 'handle';
      readonly handle: HandleRef;
      readonly startWorld: Point;
      readonly originalPath: Path;
    };

export class SelectCharTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: 'select-char',
    label: '文字選択/カーニング (白矢印)',
    iconSvg: selectCharToolIcon,
  };

  // 既定値は app.ts のトップ初期値と一致させる (pitch=8, threshold=5)。
  private snap: SnapConfig = { enabled: true, pitch: 8, threshold: 5 };
  private drag: SelectCharDragState | null = null;
  private dragPath: PathHandle | null = null;
  // History 用: drag 開始時の snapshot を保持し、drag 終了時に Command を構築する
  private beforeSnapshot: ObjectSnapshot | null = null;
  // 永続的なアンカー選択状態 (drag 開始/終了で消えない、shift クリックで蓄積)。
  // 起点パスが切り替わったとき (object 切替 / 選択クリア) は app.ts 側から
  // clearSelectedAnchors() を呼んで明示的にリセットする。
  private selectedAnchors: Set<number> = new Set();

  setSnapConfig(cfg: SnapConfig): void {
    this.snap = cfg;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  // 現在選択中のアンカー index 集合。app.ts の drawAnchorOverlay が
  // 選択中アンカーを別色で描画するために参照する。
  getSelectedAnchorIndices(): ReadonlySet<number> {
    return this.selectedAnchors;
  }

  clearSelectedAnchors(): void {
    this.selectedAnchors.clear();
  }

  /**
   * 選択中の全アンカーを world delta (worldDx, worldDy) で剛体移動 + history
   * に push。矢印キー操作のエントリポイント。選択が空ならノーオペ。
   */
  moveSelectedAnchorsBy(state: State, worldDx: number, worldDy: number): void {
    if (this.selectedAnchors.size === 0) return;
    const path = state.getActivePath();
    if (!path) return;

    const before = path.captureForHistory();
    const snapshot = path.snapshot();
    const localDelta = worldDeltaToPathLocalDelta({ x: worldDx, y: worldDy }, snapshot.pathMatrix);

    let updated = snapshot.path;
    for (const idx of this.selectedAnchors) {
      updated = updated.moveAnchor(idx, localDelta.x, localDelta.y);
    }
    path.setPath(updated);
    path.finalizeEdit();
    state.requestRerender();

    const after = path.captureForHistory();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      state.pushCommand({
        kind: 'objectChanged',
        objectId: path.getId(),
        before,
        after,
      });
    }
  }

  onActivate(_state: State): void {
    /* no-op */
  }

  onDeactivate(state: State): void {
    this.drag = null;
    this.dragPath = null;
    this.beforeSnapshot = null;
    this.selectedAnchors.clear();
    state.setCursor('');
  }

  onPointerDown(e: PointerInput, state: State): PointerHandled {
    const path = state.getActivePath();
    if (!path) return 'pass';

    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, state.getViewportMatrix());

    // ハンドルを優先 (アンカーと重なって見える事があるため)。ハンドルは常に
    // 単独 drag (= 複数選択非対応)。
    const hitHandle = hitTestHandleAt(layout, e.screenX, e.screenY);
    if (hitHandle) {
      this.drag = {
        kind: 'handle',
        handle: hitHandle.handle,
        startWorld: { x: e.worldX, y: e.worldY },
        originalPath: snapshot.path,
      };
      this.dragPath = path;
      this.beforeSnapshot = path.captureForHistory();
      return 'consumed';
    }

    const aIdx = hitTestAnchorAt(layout, e.screenX, e.screenY);
    if (aIdx >= 0) {
      // アンカー選択 semantic:
      //  - shift: クリックしたアンカーを selectedAnchors に toggle
      //  - 通常 + 未選択: 既存選択をクリアし、クリックしたアンカー 1 個だけ選択
      //  - 通常 + 既選択: 選択を維持 (= 複数選択された状態のまま drag に入れる)
      if (e.shiftKey) {
        if (this.selectedAnchors.has(aIdx)) {
          this.selectedAnchors.delete(aIdx);
        } else {
          this.selectedAnchors.add(aIdx);
        }
      } else if (!this.selectedAnchors.has(aIdx)) {
        this.selectedAnchors.clear();
        this.selectedAnchors.add(aIdx);
      }

      // shift 操作で「クリックしたアンカーが解除された」ケースは drag を起こさない
      // (= ユーザは選択解除しただけで動かす意図は無い)。
      if (!this.selectedAnchors.has(aIdx)) {
        state.requestRerender();
        return 'consumed';
      }

      this.drag = {
        kind: 'anchors',
        anchorIndices: [...this.selectedAnchors],
        startWorld: { x: e.worldX, y: e.worldY },
        originalPath: snapshot.path,
      };
      this.dragPath = path;
      this.beforeSnapshot = path.captureForHistory();
      state.requestRerender();
      return 'consumed';
    }

    // 空きエリアクリック: shift なら選択保持、通常なら選択クリア。
    // どちらでも 'pass' を返してパス全体ドラッグに道を譲る。
    if (!e.shiftKey && this.selectedAnchors.size > 0) {
      this.selectedAnchors.clear();
      state.requestRerender();
    }
    return 'pass';
  }

  onPointerMove(e: PointerInput, state: State): void {
    if (this.drag && this.dragPath) {
      const path = this.dragPath;
      const snapshot = path.snapshot();
      const cumWorldDx = e.worldX - this.drag.startWorld.x;
      const cumWorldDy = e.worldY - this.drag.startWorld.y;
      const cumLocal = worldDeltaToPathLocalDelta(
        { x: cumWorldDx, y: cumWorldDy },
        snapshot.pathMatrix,
      );

      // Shift ホールド中は累積デルタの dominant axis のみ適用 (横/縦制限)。
      // axis lock は毎フレーム再評価 — ユーザが drag 軌跡の方向を変えれば
      // 切り替わる (= 「Shift を一回押し続ければ常に水平方向に固定したい」
      // ような厳格な動作ではなく、Illustrator 風の「最も大きく動いた軸」)。
      let dxLocal = cumLocal.x;
      let dyLocal = cumLocal.y;
      if (e.shiftKey) {
        if (Math.abs(cumLocal.x) >= Math.abs(cumLocal.y)) {
          dyLocal = 0;
        } else {
          dxLocal = 0;
        }
      }

      // 累積 delta を original から再適用 (= 毎フレーム original snapshot 起点)。
      // この設計により Shift 軸ロックの mid-drag 切替で破綻しない。
      let updated: Path = this.drag.originalPath;
      if (this.drag.kind === 'anchors') {
        for (const idx of this.drag.anchorIndices) {
          updated = updated.moveAnchor(idx, dxLocal, dyLocal);
        }
      } else {
        updated = updated.moveHandle(this.drag.handle, dxLocal, dyLocal);
      }
      path.setPath(updated);
      state.requestRerender();
      return;
    }

    // ── Hover cursor ────────────────────────────────────────────────
    const path = state.getActivePath();
    if (!path) {
      state.setCursor('');
      return;
    }
    const snapshot = path.snapshot();
    const layout = computeOverlayLayout(snapshot, state.getViewportMatrix());
    if (hitTestHandleAt(layout, e.screenX, e.screenY)) {
      state.setCursor('pointer');
    } else if (hitTestAnchorAt(layout, e.screenX, e.screenY) >= 0) {
      state.setCursor('move');
    } else {
      state.setCursor('');
    }
  }

  onPointerUp(_e: PointerInput, state: State): void {
    if (!this.drag || !this.dragPath) return;
    const p = this.dragPath;
    const before = this.beforeSnapshot;
    this.drag = null;
    this.dragPath = null;
    this.beforeSnapshot = null;
    p.finalizeEdit();
    state.requestRerender();

    // History: anchor / handle drag が完了したら Command を push。
    // before/after が同一なら drag が ノーオペだったとみなして push しない。
    if (before) {
      const after = p.captureForHistory();
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        state.pushCommand({
          kind: 'objectChanged',
          objectId: p.getId(),
          before,
          after,
        });
      }
    }
  }

  onObjectMoving(target: MovingTarget, e: { altKey: boolean }, _state: State): void {
    if (!this.snap.enabled) return;
    if (e.altKey) return; // Illustrator 慣例: Alt 押下中は一時バイパス

    const pitch = this.snap.pitch;
    const threshold = this.snap.threshold;

    const freeX = target.getLeft();
    const nearestX = Math.round(freeX / pitch) * pitch;
    if (Math.abs(freeX - nearestX) < threshold) target.setLeft(nearestX);

    const freeY = target.getTop();
    const nearestY = Math.round(freeY / pitch) * pitch;
    if (Math.abs(freeY - nearestY) < threshold) target.setTop(nearestY);
  }

  onSelectionChanged(_state: State): void {
    /* no-op */
  }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _state: State): void {
    /* no-op */
  }
}
