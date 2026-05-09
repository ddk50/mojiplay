// +ペンツール: セグメント上クリックでアンカーを追加し、ドラッグでハンドルを設定する。
//
// フロー:
//   1. onPointerDown でセグメントヒットがあれば splitSegment を呼んで M/Z 以外の
//      C/Q/L を t で 2 分割。新アンカーを生成。
//   2. ドラッグ中の onPointerMove では、新アンカーから pointer までのオフセット dx,dy を
//      計算し、前後セグメントを C 化して対称ハンドル (c2 = anchor - d, 次の c1 = anchor + d)
//      を設定する。元が C なら反対側ハンドル (前: c1、次: c2) は元の値を維持。
//      L/Q を分割した場合は反対側ハンドルを 1/3 等分点でデフォルト生成。
//   3. onPointerUp で finalize。
//
// hover カーソルはセグメント上で 'copy'。
//
// ── 分割アルゴリズム (De Casteljau) ────────────────────────────────────
//
// onPointerDown が呼ぶ Path.splitSegment(cmdIndex, t) は De Casteljau の
// アルゴリズムでベジェ曲線を 2 本に分割する。Illustrator の「アンカーポイント追加」
// (+ペン) と同じ操作で、要点は「ヒットした位置 t に新アンカーを打っても
// 曲線形状を厳密に維持する」こと。
//
// なぜ「t における点の位置を求めるだけ」ではダメか:
//   evalCubicAt(t) で B(t) は出せるが、その点をアンカーにして前後を直線で
//   繋ぐと元の曲線形状が壊れる。De Casteljau は「分割点」と「分割後の
//   2 本のベジェに必要な新しい制御点群」を同時に出してくれる。連結すれば
//   元の曲線と数学的に完全一致 (損失なし)。
//
// アルゴリズム本体 (3 次ベジェの場合):
//   元の制御点 (p0, c1, c2, p3) と t を入力に、線形補間を 3 段重ねる:
//     level 1: 隣接ペアを t で内分 → q0, q1, q2
//     level 2: q を内分             → r0, r1
//     level 3: r を内分             → s (= 分割点 = 新アンカー位置)
//   分割後の前半は (p0, q0, r0, s)、後半は (s, r1, q2, p3) として連結。
//   2 次ベジェは 2 段、直線 (L) は単純な内分一発で同じ性質を持つ。
//   実装は core/path/path.ts の Path.splitSegment 内。
//
// この時点ではまだ曲線形状は元と同一。ユーザーがドラッグを始めると
// onPointerMove 内で前後セグメントの一方のハンドル (新アンカー側の
// c2 / c1) を pointer 方向に向けて再配置するため、ここで初めて
// 曲線形状が変わる。これは「アンカー追加 → そのままドラッグでハンドル
// を引っ張り出して曲線を作る」という Illustrator 流の操作感を再現。
//
// 関連:
//   逆操作 (アンカー削除 / -ペンツール) は curve fitting の問題で
//   De Casteljau では戻せない。pen-remove-tool.ts 参照。

import type { Point, PathCommand } from '../../core/path/types';
import { Path } from '../../core/path/path';
import type { PathTransform } from '../../core/path/coords';
import { screenToPathLocal } from '../../core/path/coords';
import { findClosestSegment } from '../../core/path/segment-hit';
import type { ObjectSnapshot } from '../../core/history/types';
import type {
  Tool, ToolDescriptor, PointerInput, PointerHandled,
  MovingTarget, CanvasMouseDownInput,
} from './tool-interface';
import type { State, PathHandle } from '../../core/state';

interface PenAddDragState {
  readonly cmdIndex: number;        // 分割した命令の前半 (新アンカー終端) の index
  readonly origCmdType: 'C' | 'Q' | 'L';
  readonly anchor: Point;           // 新アンカー位置 (固定)
  readonly prev:   Point;           // 直前のアンカー位置 (L→C 変換時のデフォルトハンドル算出用)
  readonly next:   Point;           // 直後のアンカー位置
}

const PEN_HIT_THRESHOLD = 8;
const PEN_SAMPLES       = 50;

export class PenAddTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id:    'pen-add',
    label: 'アンカーポイント追加 (+ペン)',
    iconSvg:
      '<svg class="tool-icon pen-icon" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">' +
        '<path class="pen-nib" d="M9,1 L13,5.5 L11.5,10.5 L9,16 L6.5,10.5 L5,5.5 Z"/>' +
        '<circle class="pen-dot" cx="9" cy="6.5" r="1.6"/>' +
        '<line class="pen-sign" x1="14.5" y1="12" x2="14.5" y2="17" stroke-width="1.8" stroke-linecap="round"/>' +
        '<line class="pen-sign" x1="12" y1="14.5" x2="17" y2="14.5" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>',
  };

  private drag: PenAddDragState | null = null;
  private dragPath: PathHandle | null = null;
  private beforeSnapshot: ObjectSnapshot | null = null;

  isDragging(): boolean { return this.drag !== null; }

  onActivate(_state: State): void { /* no-op */ }
  onDeactivate(state: State): void {
    this.drag = null;
    this.dragPath = null;
    this.beforeSnapshot = null;
    state.setCursor('');
  }

  onPointerDown(e: PointerInput, state: State): PointerHandled {
    const path = state.getActivePath();
    if (!path) return 'pass';

    const snapshot = path.snapshot();
    const transform: PathTransform = {
      pathMatrix:     snapshot.pathMatrix,
      pathOffset:     snapshot.pathOffset,
      viewportMatrix: state.getViewportMatrix(),
    };
    const hit = findClosestSegment(
      snapshot.path.commands, e.screenX, e.screenY, transform, PEN_HIT_THRESHOLD, PEN_SAMPLES,
    );
    if (!hit) return 'pass';

    const origCmd = snapshot.path.commands[hit.cmdIndex];
    if (origCmd.type !== 'C' && origCmd.type !== 'Q' && origCmd.type !== 'L') {
      // splitSegment は M/Z に対しては null を返す。理論上ここには来ないが防御。
      return 'pass';
    }
    const origCmdType = origCmd.type;

    const split = snapshot.path.splitSegment(hit.cmdIndex, hit.t);
    if (!split) return 'pass';
    const firstCmd = split.commands[hit.cmdIndex];
    if (firstCmd.type !== 'C' && firstCmd.type !== 'Q' && firstCmd.type !== 'L') return 'pass';
    const anchor = firstCmd.to;
    const secondIdx = hit.cmdIndex + 1;
    const nextCmd = split.commands[secondIdx];
    if (nextCmd.type !== 'C' && nextCmd.type !== 'Q' && nextCmd.type !== 'L') return 'pass';

    const prevPt = split.segmentStart(hit.cmdIndex);
    const prev = prevPt ?? anchor;
    const next = nextCmd.to;

    this.beforeSnapshot = path.captureForHistory();
    path.setPath(split);
    this.drag = { cmdIndex: hit.cmdIndex, origCmdType, anchor, prev, next };
    this.dragPath = path;
    state.requestRerender();
    return 'consumed';
  }

  onPointerMove(e: PointerInput, state: State): void {
    if (this.drag && this.dragPath) {
      const path = this.dragPath;
      const snapshot = path.snapshot();
      const transform: PathTransform = {
        pathMatrix:     snapshot.pathMatrix,
        pathOffset:     snapshot.pathOffset,
        viewportMatrix: state.getViewportMatrix(),
      };
      const local = screenToPathLocal({ x: e.screenX, y: e.screenY }, transform);
      const dx = local.x - this.drag.anchor.x;
      const dy = local.y - this.drag.anchor.y;

      const cur = snapshot.path.commands;
      const updated: PathCommand[] = cur.slice();
      const cmdIndex = this.drag.cmdIndex;
      const secondIdx = cmdIndex + 1;
      const curFirst = cur[cmdIndex];
      const curSecond = cur[secondIdx];
      const { anchor, prev, next, origCmdType } = this.drag;

      // 前半セグメント = anchor で終わる C コマンド。
      // c1 (前アンカーの outgoing) は元が C ならその値、それ以外は 1/3 等分点。
      // c2 (新アンカーの incoming) は anchor から pointer の対称ハンドル。
      const firstC1: Point = origCmdType === 'C' && curFirst.type === 'C'
        ? curFirst.c1
        : { x: prev.x + (anchor.x - prev.x) / 3, y: prev.y + (anchor.y - prev.y) / 3 };
      updated[cmdIndex] = {
        type: 'C',
        c1: firstC1,
        c2: { x: anchor.x - dx, y: anchor.y - dy },
        to: { x: anchor.x, y: anchor.y },
      };

      // 後半セグメント = next で終わる C コマンド。
      // c1 (新アンカーの outgoing) は anchor から pointer の方向。
      // c2 (next アンカーの incoming) は元が C ならその値、それ以外は 2/3 点。
      const secondC2: Point = origCmdType === 'C' && curSecond.type === 'C'
        ? curSecond.c2
        : { x: anchor.x + 2 * (next.x - anchor.x) / 3, y: anchor.y + 2 * (next.y - anchor.y) / 3 };
      updated[secondIdx] = {
        type: 'C',
        c1: { x: anchor.x + dx, y: anchor.y + dy },
        c2: secondC2,
        to: { x: next.x, y: next.y },
      };

      path.setPath(new Path(updated));
      state.requestRerender();
      return;
    }

    // ── Hover ────────────────────────────────────────────────────────
    const path = state.getActivePath();
    if (!path) {
      state.setCursor('');
      return;
    }
    const snapshot = path.snapshot();
    const transform: PathTransform = {
      pathMatrix:     snapshot.pathMatrix,
      pathOffset:     snapshot.pathOffset,
      viewportMatrix: state.getViewportMatrix(),
    };
    const hit = findClosestSegment(
      snapshot.path.commands, e.screenX, e.screenY, transform, PEN_HIT_THRESHOLD, PEN_SAMPLES,
    );
    state.setCursor(hit ? 'copy' : '');
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

    // History: アンカー追加が完了したら Command を push (anchor 追加は必ず差分が出る)
    if (before) {
      state.pushCommand({
        kind: 'objectChanged',
        objectId: p.getId(),
        before,
        after: p.captureForHistory(),
      });
    }
  }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _state: State): void { /* no-op */ }
  onSelectionChanged(_state: State): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _state: State): void { /* no-op */ }
}
