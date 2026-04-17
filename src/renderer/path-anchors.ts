// パスアンカーポイント抽出・移動ヘルパー (純粋関数)
//
// fabric.Path.path (コマンド配列) からアンカーポイントを抽出し、
// 個別アンカーの剛体移動 (アンカー + 付属ベジェハンドル) を行う。
// fabric / DOM 非依存で単体テスト可能。
//
// outline-position.ts と同様の dual-mode パターン:
// ブラウザでは module が未定義なのでグローバル関数として機能。
// Node test では module.exports として export。

// ── SVG パスコマンド型 ──────────────────────────────────────────────────
//
// M x y          : MoveTo       — サブパス開始点に移動
// L x y          : LineTo       — 直線を引く
// C x1 y1 x2 y2 x y : CurveTo — 三次ベジェ曲線
//   x1,y1 = 始点側制御点 (outgoing handle)
//   x2,y2 = 終点側制御点 (incoming handle)
//   x,y   = 終点 (アンカー)
// Q x1 y1 x y    : QuadCurveTo — 二次ベジェ曲線
//   x1,y1 = 制御点 (始点と終点の両方に影響)
//   x,y   = 終点 (アンカー)
// Z              : ClosePath    — サブパス開始点 (直前の M) に戻る

type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

interface HandleRef {
  readonly cmdIndex: number;
  readonly paramIndices: readonly [number, number];
}

interface PathAnchor {
  readonly cmdIndex: number;
  readonly x: number;
  readonly y: number;
  incomingHandle: HandleRef | null;
  outgoingHandle: HandleRef | null;
  readonly subpathStart: boolean;
}

function extractAnchors(path: PathCommand[]): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  let subpathStartIdx = -1;

  for (let i = 0; i < path.length; i++) {
    const cmd = path[i];
    switch (cmd[0]) {
      case 'M':
        subpathStartIdx = anchors.length;
        anchors.push({
          cmdIndex: i,
          x: cmd[1],
          y: cmd[2],
          incomingHandle: null,
          outgoingHandle: null,
          subpathStart: true,
        });
        break;

      case 'L':
        anchors.push({
          cmdIndex: i,
          x: cmd[1],
          y: cmd[2],
          incomingHandle: null,
          outgoingHandle: null,
          subpathStart: false,
        });
        break;

      case 'C': {
        // C x1 y1 x2 y2 x y
        // 直前アンカーの outgoingHandle = (x1, y1) = params [1],[2]
        const prev = anchors.length > 0 ? anchors[anchors.length - 1] : null;
        if (prev) {
          prev.outgoingHandle = { cmdIndex: i, paramIndices: [1, 2] };
        }
        anchors.push({
          cmdIndex: i,
          x: cmd[5],
          y: cmd[6],
          incomingHandle: { cmdIndex: i, paramIndices: [3, 4] },
          outgoingHandle: null,
          subpathStart: false,
        });
        break;
      }

      case 'Q': {
        // Q x1 y1 x y
        // 二次ベジェ: 制御点 (x1,y1) は直前アンカーの outgoing でもあり
        // このアンカーの incoming でもある
        const prevQ = anchors.length > 0 ? anchors[anchors.length - 1] : null;
        if (prevQ) {
          prevQ.outgoingHandle = { cmdIndex: i, paramIndices: [1, 2] };
        }
        anchors.push({
          cmdIndex: i,
          x: cmd[3],
          y: cmd[4],
          incomingHandle: { cmdIndex: i, paramIndices: [1, 2] },
          outgoingHandle: null,
          subpathStart: false,
        });
        break;
      }

      case 'Z': {
        // 閉パス: 直前コマンドが C/Q の場合、サブパス先頭 M の incomingHandle を設定
        if (subpathStartIdx >= 0 && subpathStartIdx < anchors.length) {
          const startAnchor = anchors[subpathStartIdx];
          const lastCmd = i > 0 ? path[i - 1] : null;
          if (lastCmd) {
            if (lastCmd[0] === 'C') {
              startAnchor.incomingHandle = { cmdIndex: i - 1, paramIndices: [3, 4] };
            } else if (lastCmd[0] === 'Q') {
              startAnchor.incomingHandle = { cmdIndex: i - 1, paramIndices: [1, 2] };
            }
          }
        }
        break;
      }
    }
  }

  return anchors;
}

function moveAnchorRigid(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
  dx: number,
  dy: number,
): PathCommand[] {
  const anchors = extractAnchors(path as PathCommand[]);
  if (anchorIndex < 0 || anchorIndex >= anchors.length) {
    return path.slice() as PathCommand[];
  }

  const anchor = anchors[anchorIndex];
  const modified = new Set<number>();

  // コマンドタプルの特定パラメータを (dx, dy) シフトした新タプルを返す
  function shiftParams(cmdIdx: number, xIdx: number, yIdx: number): void {
    modified.add(cmdIdx);
    const old = result[cmdIdx] as any[];
    if (!touched[cmdIdx]) {
      result[cmdIdx] = old.slice() as PathCommand;
      touched[cmdIdx] = true;
    }
    const cmd = result[cmdIdx] as any[];
    cmd[xIdx] = (old[xIdx] as number) + dx;
    cmd[yIdx] = (old[yIdx] as number) + dy;
  }

  const result: PathCommand[] = new Array(path.length);
  const touched: boolean[] = new Array(path.length).fill(false);
  for (let i = 0; i < path.length; i++) {
    result[i] = path[i] as PathCommand;
  }

  // アンカー本体を移動
  const cmd = path[anchor.cmdIndex];
  switch (cmd[0]) {
    case 'M':
    case 'L':
      shiftParams(anchor.cmdIndex, 1, 2);
      break;
    case 'C':
      shiftParams(anchor.cmdIndex, 5, 6);
      break;
    case 'Q':
      shiftParams(anchor.cmdIndex, 3, 4);
      break;
  }

  // 付属ハンドルを平行移動
  if (anchor.incomingHandle) {
    const h = anchor.incomingHandle;
    shiftParams(h.cmdIndex, h.paramIndices[0], h.paramIndices[1]);
  }
  if (anchor.outgoingHandle) {
    const h = anchor.outgoingHandle;
    shiftParams(h.cmdIndex, h.paramIndices[0], h.paramIndices[1]);
  }

  return result;
}

// ── 個別ハンドル (制御点) 移動 ──────────────────────────────────────────
//
// HandleRef が指す制御点のみを (dx, dy) 移動する。
// アンカー本体や反対側ハンドルには一切触れない。
// moveAnchorRigid と同じイミュータビリティ契約:
//   変更したタプルだけ新規配列、他は参照維持。

function moveHandle(
  path: ReadonlyArray<PathCommand>,
  handle: HandleRef,
  dx: number,
  dy: number,
): PathCommand[] {
  const result: PathCommand[] = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    result[i] = path[i] as PathCommand;
  }

  const ci = handle.cmdIndex;
  if (ci < 0 || ci >= path.length) return result;

  const [xi, yi] = handle.paramIndices;
  const old = path[ci] as any[];
  const cmd = old.slice() as PathCommand;
  (cmd as any[])[xi] = (old[xi] as number) + dx;
  (cmd as any[])[yi] = (old[yi] as number) + dy;
  result[ci] = cmd;

  return result;
}

// ── ベジェ曲線評価 ──────────────────────────────────────────────────────

function evalCubicAt(
  p0x: number, p0y: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  p3x: number, p3y: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return [
    uuu * p0x + 3 * uu * t * c1x + 3 * u * tt * c2x + ttt * p3x,
    uuu * p0y + 3 * uu * t * c1y + 3 * u * tt * c2y + ttt * p3y,
  ];
}

function evalQuadAt(
  p0x: number, p0y: number,
  c1x: number, c1y: number,
  p2x: number, p2y: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  return [
    u * u * p0x + 2 * u * t * c1x + t * t * p2x,
    u * u * p0y + 2 * u * t * c1y + t * t * p2y,
  ];
}

// ── セグメント始点取得 ──────────────────────────────────────────────────

function getSegmentStart(
  path: ReadonlyArray<PathCommand>, cmdIndex: number,
): [number, number] | null {
  for (let i = cmdIndex - 1; i >= 0; i--) {
    const c = path[i];
    switch (c[0]) {
      case 'M': return [c[1], c[2]];
      case 'L': return [c[1], c[2]];
      case 'C': return [c[5], c[6]];
      case 'Q': return [c[3], c[4]];
    }
  }
  return null;
}

// ── セグメント分割 (De Casteljau) ───────────────────────────────────────
//
// cmdIndex が指す C / Q / L コマンドをパラメータ t で分割し、
// 新しいアンカーポイントを挿入した新パスを返す。

function splitSegment(
  path: ReadonlyArray<PathCommand>,
  cmdIndex: number,
  t: number,
): PathCommand[] {
  if (cmdIndex < 0 || cmdIndex >= path.length) return path.slice() as PathCommand[];

  const cmd = path[cmdIndex];
  const start = getSegmentStart(path, cmdIndex);
  if (!start) return path.slice() as PathCommand[];

  const [p0x, p0y] = start;
  let first: PathCommand;
  let second: PathCommand;

  if (cmd[0] === 'C') {
    const [, c1x, c1y, c2x, c2y, p3x, p3y] = cmd;
    const u = 1 - t;
    // De Casteljau level 1
    const q0x = u * p0x + t * c1x;
    const q0y = u * p0y + t * c1y;
    const q1x = u * c1x + t * c2x;
    const q1y = u * c1y + t * c2y;
    const q2x = u * c2x + t * p3x;
    const q2y = u * c2y + t * p3y;
    // level 2
    const r0x = u * q0x + t * q1x;
    const r0y = u * q0y + t * q1y;
    const r1x = u * q1x + t * q2x;
    const r1y = u * q1y + t * q2y;
    // level 3 — 分割点
    const sx = u * r0x + t * r1x;
    const sy = u * r0y + t * r1y;

    first  = ['C', q0x, q0y, r0x, r0y, sx, sy];
    second = ['C', r1x, r1y, q2x, q2y, p3x, p3y];
  } else if (cmd[0] === 'Q') {
    const [, c1x, c1y, p2x, p2y] = cmd;
    const u = 1 - t;
    const q0x = u * p0x + t * c1x;
    const q0y = u * p0y + t * c1y;
    const q1x = u * c1x + t * p2x;
    const q1y = u * c1y + t * p2y;
    const sx = u * q0x + t * q1x;
    const sy = u * q0y + t * q1y;

    first  = ['Q', q0x, q0y, sx, sy];
    second = ['Q', q1x, q1y, p2x, p2y];
  } else if (cmd[0] === 'L') {
    const [, lx, ly] = cmd;
    const sx = p0x + t * (lx - p0x);
    const sy = p0y + t * (ly - p0y);

    first  = ['L', sx, sy];
    second = ['L', lx, ly];
  } else {
    return path.slice() as PathCommand[];
  }

  const result: PathCommand[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i === cmdIndex) {
      result.push(first);
      result.push(second);
    } else {
      result.push(path[i] as PathCommand);
    }
  }
  return result;
}

// ── アンカーポイント削除 ────────────────────────────────────────────────
//
// 指定アンカーを削除し、後続セグメントを直線 (L) に置換する。
// サブパス内のアンカー数が 2 以下になる場合は操作を拒否する。

function removeAnchor(
  path: ReadonlyArray<PathCommand>,
  anchorIndex: number,
): PathCommand[] {
  const anchors = extractAnchors(path as PathCommand[]);
  if (anchorIndex < 0 || anchorIndex >= anchors.length) {
    return path.slice() as PathCommand[];
  }

  // サブパス境界の特定
  let subStart = anchorIndex;
  while (subStart > 0 && !anchors[subStart].subpathStart) subStart--;
  let subEnd = anchorIndex + 1;
  while (subEnd < anchors.length && !anchors[subEnd].subpathStart) subEnd++;
  const subCount = subEnd - subStart;

  // アンカーが 2 以下になる削除は拒否
  if (subCount <= 2) return path.slice() as PathCommand[];

  const anchor = anchors[anchorIndex];
  const result: PathCommand[] = [];

  if (anchor.subpathStart) {
    // M アンカーの削除: 次のアンカーを新しい M にする
    const next = anchors[anchorIndex + 1];
    for (let i = 0; i < path.length; i++) {
      if (i === anchor.cmdIndex) {
        result.push(['M', next.x, next.y]);
      } else if (i === next.cmdIndex) {
        // 次のアンカーへのコマンドをスキップ (M に置換済み)
        continue;
      } else {
        result.push(path[i] as PathCommand);
      }
    }
  } else {
    // 非 M アンカーの削除
    const hasNext = (anchorIndex + 1) < subEnd;
    const nextCmdIndex = hasNext ? anchors[anchorIndex + 1].cmdIndex : -1;
    const nextAnchor = hasNext ? anchors[anchorIndex + 1] : null;

    for (let i = 0; i < path.length; i++) {
      if (i === anchor.cmdIndex) {
        continue; // 削除
      } else if (hasNext && i === nextCmdIndex && nextAnchor) {
        result.push(['L', nextAnchor.x, nextAnchor.y]);
      } else {
        result.push(path[i] as PathCommand);
      }
    }
  }

  return result;
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.extractAnchors = extractAnchors;
  // @ts-ignore
  module.exports.moveAnchorRigid = moveAnchorRigid;
  // @ts-ignore
  module.exports.moveHandle = moveHandle;
  // @ts-ignore
  module.exports.evalCubicAt = evalCubicAt;
  // @ts-ignore
  module.exports.evalQuadAt = evalQuadAt;
  // @ts-ignore
  module.exports.getSegmentStart = getSegmentStart;
  // @ts-ignore
  module.exports.splitSegment = splitSegment;
  // @ts-ignore
  module.exports.removeAnchor = removeAnchor;
}
