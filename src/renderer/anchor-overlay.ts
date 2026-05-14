// アンカー / ハンドルマーカーの contextTop 描画 (= Presenter)。
//
// select-char (白矢印) / pen-add / pen-remove モードで outline 化済 fabric.Path が
// active なときに、アンカー (正方形) と ベジェハンドル (○ + 線) を描画する。
// 元々 app.ts の drawAnchorOverlay 関数だったロジックをここに集約。
//
// 設計判断:
//   - state + selectCharTool への参照を closure で保持。CanvasInputController が
//     hook (after:render) する。
//   - DPI スケーリング: contextTop は retina 対応のため getRetinaScaling を掛ける
//     必要あり (詳細は CLAUDE.md「DPI スケーリング」)。

import type { State } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import { computeOverlayLayout } from '../core/path/overlay-layout';
import { getContextTop, getRetinaScaling } from './fabric-internals';

const ANCHOR_MARKER_PX = 7;
const ANCHOR_FILL = '#ffffff';
const ANCHOR_STROKE = '#0066ff';
// 選択中アンカーは塗り潰しを反転 (Illustrator 流: hollow → filled)。
const ANCHOR_SELECTED_FILL = '#0066ff';

const HANDLE_LINE_COLOR = '#0066ff';
const HANDLE_LINE_WIDTH = 1;
const HANDLE_CIRCLE_R = 4;
const HANDLE_FILL = '#ffffff';
const HANDLE_STROKE = '#0066ff';

export function drawAnchorOverlay(
  state: State,
  selectCharTool: SelectCharTool,
  canvas: fabric.Canvas,
): void {
  // 編集モードでなければ overlay 描画は不要。fabric は contextTop に範囲選択
  // (marquee) や free-drawing を描画するので、無条件 clearContext すると
  // それらが消えてしまう (回帰防止)。
  const mode = state.getCurrentMode();
  if (mode !== 'select-char' && mode !== 'pen-add' && mode !== 'pen-remove') return;
  const path = state.getActivePath();
  if (!path) return;
  const ctx = getContextTop(canvas);
  if (!ctx) return;
  canvas.clearContext(ctx);

  const snapshot = path.snapshot();
  const half = ANCHOR_MARKER_PX / 2;
  const layout = computeOverlayLayout(snapshot, state.getViewportMatrix());
  const aCache = layout.anchors;
  const hCache = layout.handles;

  ctx.save();
  const retina = getRetinaScaling(canvas);
  ctx.setTransform(retina, 0, 0, retina, 0, 0);

  // Pass 1: ハンドル線 (最背面)
  ctx.strokeStyle = HANDLE_LINE_COLOR;
  ctx.lineWidth = HANDLE_LINE_WIDTH;
  for (const h of hCache) {
    const anchor = aCache[h.anchorIndex];
    ctx.beginPath();
    ctx.moveTo(anchor.sx, anchor.sy);
    ctx.lineTo(h.sx, h.sy);
    ctx.stroke();
  }

  // Pass 2: ハンドル円
  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.lineWidth = 1;
  for (const h of hCache) {
    ctx.beginPath();
    ctx.arc(h.sx, h.sy, HANDLE_CIRCLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Pass 3: アンカー四角 (最前面)。select-char モードでは選択中アンカーを
  // 塗り潰し色違いで描画 (= Illustrator 流の "filled = selected")。
  const selectedSet = mode === 'select-char' ? selectCharTool.getSelectedAnchorIndices() : null;
  ctx.strokeStyle = ANCHOR_STROKE;
  ctx.lineWidth = 1;
  for (const a of aCache) {
    ctx.fillStyle =
      selectedSet && selectedSet.has(a.anchorIndex) ? ANCHOR_SELECTED_FILL : ANCHOR_FILL;
    ctx.fillRect(a.sx - half, a.sy - half, ANCHOR_MARKER_PX, ANCHOR_MARKER_PX);
    ctx.strokeRect(a.sx - half, a.sy - half, ANCHOR_MARKER_PX, ANCHOR_MARKER_PX);
  }

  ctx.restore();
}
