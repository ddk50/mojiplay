// アンカー / ハンドルのスクリーン座標レイアウト計算とヒットテスト (純粋関数)。
//
// 「PathSnapshot + viewport 行列」から「screen 座標つきアンカー / ハンドル一覧」を
// 導出する。fabric / DOM に触れないので unit test 可能。
//
// 利用側:
//   - SelectCharTool / PenAddTool / PenRemoveTool: pointer 入力ごとに最新パスから
//     fresh に layout を計算し、hit-test に使う。
//   - app.ts の drawAnchorOverlay: 描画前に layout を計算してマーカーを描く。
//
// CA 上は Entity / pure 計算層。入力 (PointerInput) を受けず、PathSnapshot +
// viewport 行列から派生情報を計算するだけなので core/path/ に住む。

import type { HandleRef } from './types';
import type { Mat2x3, PathTransform } from './coords';
import { pathLocalToScreen } from './coords';
import type { PathSnapshot } from '../state-interface';

export interface AnchorScreenPos {
  readonly anchorIndex: number;
  readonly sx: number;
  readonly sy: number;
}

export interface HandleScreenPos {
  readonly anchorIndex: number;
  readonly which: 'in' | 'out';
  readonly handle: HandleRef;
  readonly sx: number;
  readonly sy: number;
}

export interface OverlayScreenLayout {
  readonly anchors: ReadonlyArray<AnchorScreenPos>;
  readonly handles: ReadonlyArray<HandleScreenPos>;
}

// 黒矢印 / pen ツールのヒット半径と統一された数値。
// 必要なら呼び出し側で上書きできるよう hit-test 関数は radius 引数を取る。
export const ANCHOR_HIT_RADIUS = 6;
export const HANDLE_HIT_RADIUS = 5;

export function computeOverlayLayout(
  snapshot: PathSnapshot,
  viewportMatrix: Mat2x3,
): OverlayScreenLayout {
  const t: PathTransform = {
    pathMatrix:     snapshot.pathMatrix,
    pathOffset:     snapshot.pathOffset,
    viewportMatrix: viewportMatrix,
  };
  const path = snapshot.path;
  const anchors = path.anchors();
  const aOut: AnchorScreenPos[] = [];
  const hOut: HandleScreenPos[] = [];

  for (const [i, a] of anchors.entries()) {
    const s = pathLocalToScreen(a.point, t);
    aOut.push({ anchorIndex: i, sx: s.sx, sy: s.sy });

    if (a.incomingHandle) {
      const hp = path.handlePoint(a.incomingHandle);
      if (hp) {
        const sh = pathLocalToScreen(hp, t);
        hOut.push({ anchorIndex: i, which: 'in', handle: a.incomingHandle, sx: sh.sx, sy: sh.sy });
      }
    }
    if (a.outgoingHandle) {
      const hp = path.handlePoint(a.outgoingHandle);
      if (hp) {
        const sh = pathLocalToScreen(hp, t);
        hOut.push({ anchorIndex: i, which: 'out', handle: a.outgoingHandle, sx: sh.sx, sy: sh.sy });
      }
    }
  }

  return { anchors: aOut, handles: hOut };
}

export function hitTestAnchorAt(
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

export function hitTestHandleAt(
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
