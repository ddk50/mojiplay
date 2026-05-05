// パス上の最近傍セグメントを screen 座標で探索する純粋関数。
// PenAddTool が「ユーザがクリックしたセグメント上の点」を求めるのに使う。
//
// 各セグメント (L/C/Q) を等間隔 t でサンプリングし、screen 距離で
// threshold 以内かつ最近傍となる点を返す。サンプル粒度は呼び出し側が指定。
//
// fabric / DOM 非依存。座標変換は coords.ts の pathLocalToScreen を使う。

interface SegmentHit {
  readonly cmdIndex: number;
  readonly t:        number;
  readonly dist:     number;
}

function findClosestSegment(
  cmds: ReadonlyArray<PathCommand>,
  screenX: number, screenY: number,
  pathTransform: PathTransform,
  threshold: number,
  samples: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  let cur: Point = { x: 0, y: 0 };

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];

    if (cmd.type === 'M') { cur = cmd.to; continue; }
    if (cmd.type === 'Z') { continue; }

    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      let p: Point;

      if (cmd.type === 'C') {
        p = evalCubicAt(cur, cmd.c1, cmd.c2, cmd.to, t);
      } else if (cmd.type === 'Q') {
        p = evalQuadAt(cur, cmd.c, cmd.to, t);
      } else {
        // L
        p = { x: cur.x + t * (cmd.to.x - cur.x), y: cur.y + t * (cmd.to.y - cur.y) };
      }

      const scr = pathLocalToScreen(p, pathTransform);
      const dx = scr.sx - screenX;
      const dy = scr.sy - screenY;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < threshold && (!best || d < best.dist)) {
        best = { cmdIndex: i, t, dist: d };
      }
    }

    // C/Q/L は全て .to を持つ
    cur = cmd.to;
  }

  return best;
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.findClosestSegment = findClosestSegment;

  // Node test 用 globalThis 注入
  // @ts-ignore
  const G: any = globalThis;
  G.findClosestSegment = findClosestSegment;
}

// Node test 時に依存モジュールを pre-load
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('../path/coords');
  // @ts-ignore
  require('../path/anchors');
}
