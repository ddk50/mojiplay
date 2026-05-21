// Alt+wheel canvas zoom の camera 操作 (= renderer presenter)。
//
// zoom は viewport 変換 = camera 層なので history / 永続化対象外。これは「アプリの
// use case (ドキュメント編集)」ではなく「画面表示の調整」なので usecases/ ではなく
// renderer/ に置く。CanvasInputController から直接 import される (引数 (deltaY, focal)
// を取るので MenuActionRegistry には登録しない)。
//
// 構成:
//   - computeZoomFromWheel: pure function (副作用なし)。zoom 算数 + clamp。test 容易。
//   - zoomCanvasByWheel: orchestration (state 経由で zoom 操作 + 通知)。
//
// Photoshop 流の wheel zoom (deltaY 1 単位ごとに 0.999 倍) を [0.1, 20] にクランプ。
// Alt 修飾子チェック / preventDefault は controller 側 (event filter / framework 制御) に残す。

import type { State } from '../core/state-interface';

export interface ZoomBounds {
  readonly min: number;
  readonly max: number;
}

const DEFAULT_BOUNDS: ZoomBounds = { min: 0.1, max: 20 };
const WHEEL_FACTOR = 0.999;

/** Wheel deltaY と現 zoom から、新しい zoom を計算する pure function。 */
export function computeZoomFromWheel(
  prevZoom: number,
  deltaY: number,
  bounds: ZoomBounds = DEFAULT_BOUNDS,
): number {
  const next = prevZoom * Math.pow(WHEEL_FACTOR, deltaY);
  return Math.min(bounds.max, Math.max(bounds.min, next));
}

/** Wheel delta 量だけ focal point 中心に canvas を zoom する。 */
export function zoomCanvasByWheel(
  state: State,
  deltaY: number,
  focal: { x: number; y: number },
  onZoomChanged: () => void,
): void {
  const next = computeZoomFromWheel(state.getZoom(), deltaY);
  state.zoomToPoint(next, focal);
  onZoomChanged();
}
