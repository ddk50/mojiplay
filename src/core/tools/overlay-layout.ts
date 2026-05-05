// アンカー / ハンドルのスクリーン座標レイアウト計算とヒットテスト (純粋関数)。
//
// 「PathSnapshot + viewport 行列」から「screen 座標つきアンカー / ハンドル一覧」を
// 導出する。fabric / DOM に触れないので unit test 可能。
//
// 利用側:
//   - SelectCharTool: pointer 入力ごとに最新パスから fresh に layout を計算し、
//     hit-test に使う。
//   - app.ts の drawAnchorOverlay: 描画前に layout を計算してマーカーを描く。
//
// dual-mode export: ブラウザではグローバル関数、Node test では module.exports。

// Node test では本ファイルが require される時点で他 core/* モジュールの関数が
// 解決されている必要がある。各依存をここで pre-load し、それぞれの bottom block で
// globalThis に注入されるようにする。ブラウザでは require は未定義なのでこの
// ガード節は dead code になる (module: "none" のグローバル参照で解決)。
// @ts-ignore
if (typeof require === 'function' && typeof module !== 'undefined') {
  // @ts-ignore
  require('../path/coords');
  // @ts-ignore
  require('../path/anchors');
}

interface AnchorScreenPos {
  readonly anchorIndex: number;
  readonly sx: number;
  readonly sy: number;
}

interface HandleScreenPos {
  readonly anchorIndex: number;
  readonly which: 'in' | 'out';
  readonly handle: HandleRef;
  readonly sx: number;
  readonly sy: number;
}

interface OverlayScreenLayout {
  readonly anchors: ReadonlyArray<AnchorScreenPos>;
  readonly handles: ReadonlyArray<HandleScreenPos>;
}

// 黒矢印 / pen ツールのヒット半径と統一された数値。
// 必要なら呼び出し側で上書きできるよう hit-test 関数は radius 引数を取る。
const ANCHOR_HIT_RADIUS = 6;
const HANDLE_HIT_RADIUS = 5;

function computeOverlayLayout(
  snapshot: PathSnapshot,
  viewportMatrix: Mat2x3,
): OverlayScreenLayout {
  const t: PathTransform = {
    pathMatrix:     snapshot.pathMatrix,
    pathOffset:     snapshot.pathOffset,
    viewportMatrix: viewportMatrix,
  };
  const anchors = extractAnchors(snapshot.commands);
  const aOut: AnchorScreenPos[] = [];
  const hOut: HandleScreenPos[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const s = pathLocalToScreen(a.point, t);
    aOut.push({ anchorIndex: i, sx: s.sx, sy: s.sy });

    if (a.incomingHandle) {
      const hp = getHandlePoint(snapshot.commands[a.incomingHandle.cmdIndex], a.incomingHandle);
      if (hp) {
        const sh = pathLocalToScreen(hp, t);
        hOut.push({ anchorIndex: i, which: 'in', handle: a.incomingHandle, sx: sh.sx, sy: sh.sy });
      }
    }
    if (a.outgoingHandle) {
      const hp = getHandlePoint(snapshot.commands[a.outgoingHandle.cmdIndex], a.outgoingHandle);
      if (hp) {
        const sh = pathLocalToScreen(hp, t);
        hOut.push({ anchorIndex: i, which: 'out', handle: a.outgoingHandle, sx: sh.sx, sy: sh.sy });
      }
    }
  }

  return { anchors: aOut, handles: hOut };
}

function hitTestAnchorAt(
  layout: OverlayScreenLayout,
  screenX: number, screenY: number,
  radius: number = ANCHOR_HIT_RADIUS,
): number {
  let bestIdx = -1;
  let bestDist = radius + 1;
  for (const a of layout.anchors) {
    const dx = screenX - a.sx;
    const dy = screenY - a.sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = a.anchorIndex;
    }
  }
  return bestIdx;
}

function hitTestHandleAt(
  layout: OverlayScreenLayout,
  screenX: number, screenY: number,
  radius: number = HANDLE_HIT_RADIUS,
): HandleScreenPos | null {
  let best: HandleScreenPos | null = null;
  let bestDist = radius + 1;
  for (const h of layout.handles) {
    const dx = screenX - h.sx;
    const dy = screenY - h.sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.computeOverlayLayout = computeOverlayLayout;
  // @ts-ignore
  module.exports.hitTestAnchorAt = hitTestAnchorAt;
  // @ts-ignore
  module.exports.hitTestHandleAt = hitTestHandleAt;
  // @ts-ignore
  module.exports.ANCHOR_HIT_RADIUS = ANCHOR_HIT_RADIUS;
  // @ts-ignore
  module.exports.HANDLE_HIT_RADIUS = HANDLE_HIT_RADIUS;

  // Node test 用 globalThis 注入 (詳細は path/anchors.ts のコメント参照)
  // @ts-ignore
  const G: any = globalThis;
  G.computeOverlayLayout = computeOverlayLayout;
  G.hitTestAnchorAt      = hitTestAnchorAt;
  G.hitTestHandleAt      = hitTestHandleAt;
}
