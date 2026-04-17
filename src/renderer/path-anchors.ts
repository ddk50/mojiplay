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

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.extractAnchors = extractAnchors;
  // @ts-ignore
  module.exports.moveAnchorRigid = moveAnchorRigid;
  // @ts-ignore
  module.exports.moveHandle = moveHandle;
}
