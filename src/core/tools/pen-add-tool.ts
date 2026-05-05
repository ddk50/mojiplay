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

interface PenAddDragState {
  readonly cmdIndex: number;        // 分割した命令の前半 (新アンカー終端) の index
  readonly origCmdType: 'C' | 'Q' | 'L';
  readonly anchor: Point;           // 新アンカー位置 (固定)
  readonly prev:   Point;           // 直前のアンカー位置 (L→C 変換時のデフォルトハンドル算出用)
  readonly next:   Point;           // 直後のアンカー位置
}

const PEN_HIT_THRESHOLD = 8;
const PEN_SAMPLES       = 50;

class PenAddTool implements Tool {
  private drag: PenAddDragState | null = null;
  private dragPath: PathHandle | null = null;

  isDragging(): boolean { return this.drag !== null; }

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
    const transform: PathTransform = {
      pathMatrix:     snapshot.pathMatrix,
      pathOffset:     snapshot.pathOffset,
      viewportMatrix: host.getViewportMatrix(),
    };
    const hit = findClosestSegment(
      snapshot.commands, e.screenX, e.screenY, transform, PEN_HIT_THRESHOLD, PEN_SAMPLES,
    );
    if (!hit) return 'pass';

    const origCmd = snapshot.commands[hit.cmdIndex];
    if (origCmd.type !== 'C' && origCmd.type !== 'Q' && origCmd.type !== 'L') {
      // splitSegment は M/Z に対しては no-op。理論上ここには来ないが防御。
      return 'pass';
    }
    const origCmdType = origCmd.type;

    const newPath = splitSegment(snapshot.commands, hit.cmdIndex, hit.t);
    const firstCmd = newPath[hit.cmdIndex];
    if (firstCmd.type !== 'C' && firstCmd.type !== 'Q' && firstCmd.type !== 'L') return 'pass';
    const anchor = firstCmd.to;
    const secondIdx = hit.cmdIndex + 1;
    const nextCmd = newPath[secondIdx];
    if (nextCmd.type !== 'C' && nextCmd.type !== 'Q' && nextCmd.type !== 'L') return 'pass';

    const prevPt = getSegmentStart(newPath, hit.cmdIndex);
    const prev = prevPt ?? anchor;
    const next = nextCmd.to;

    path.setCommands(newPath);
    this.drag = { cmdIndex: hit.cmdIndex, origCmdType, anchor, prev, next };
    this.dragPath = path;
    host.requestRerender();
    return 'consumed';
  }

  onPointerMove(e: PointerInput, host: ToolHost): void {
    if (this.drag && this.dragPath) {
      const path = this.dragPath;
      const snapshot = path.snapshot();
      const transform: PathTransform = {
        pathMatrix:     snapshot.pathMatrix,
        pathOffset:     snapshot.pathOffset,
        viewportMatrix: host.getViewportMatrix(),
      };
      const local = screenToPathLocal({ x: e.screenX, y: e.screenY }, transform);
      const dx = local.x - this.drag.anchor.x;
      const dy = local.y - this.drag.anchor.y;

      const cur = snapshot.commands;
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

      path.setCommands(updated);
      host.requestRerender();
      return;
    }

    // ── Hover ────────────────────────────────────────────────────────
    const path = host.getActivePath();
    if (!path) {
      host.setCursor('');
      return;
    }
    const snapshot = path.snapshot();
    const transform: PathTransform = {
      pathMatrix:     snapshot.pathMatrix,
      pathOffset:     snapshot.pathOffset,
      viewportMatrix: host.getViewportMatrix(),
    };
    const hit = findClosestSegment(
      snapshot.commands, e.screenX, e.screenY, transform, PEN_HIT_THRESHOLD, PEN_SAMPLES,
    );
    host.setCursor(hit ? 'copy' : '');
  }

  onPointerUp(_e: PointerInput, host: ToolHost): void {
    if (!this.drag || !this.dragPath) return;
    const p = this.dragPath;
    this.drag = null;
    this.dragPath = null;
    p.finalizeEdit();
    host.requestRerender();
  }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _host: ToolHost): void { /* no-op */ }
  onSelectionChanged(_host: ToolHost): void { /* no-op */ }
  onCanvasMouseDown(_e: CanvasMouseDownInput, _host: ToolHost): void { /* no-op */ }
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.PenAddTool = PenAddTool;
}

// Node test 時に依存モジュールを pre-load
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('../path/coords');
  // @ts-ignore
  require('../path/anchors');
  // @ts-ignore
  require('./segment-hit');
}
