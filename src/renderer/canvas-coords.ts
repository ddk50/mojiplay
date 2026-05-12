// DOM MouseEvent → Tool の中立 PointerInput 型への変換。
//
// CanvasInputController が DOM mousedown / mousemove / mouseup を Tool に dispatch
// する際に使う boundary 変換。fabric.Canvas.getPointer は viewportTransform を
// 加味した世界座標を返してくれる。

import type { PointerInput } from '../usecases/tools/tool-interface';

export function buildPointerInput(e: MouseEvent, canvas: fabric.Canvas, upperCanvas: HTMLCanvasElement): PointerInput {
  const rect = upperCanvas.getBoundingClientRect();
  const w = canvas.getPointer(e);
  return {
    screenX:  e.clientX - rect.left,
    screenY:  e.clientY - rect.top,
    worldX:   w.x,
    worldY:   w.y,
    altKey:   e.altKey,
    shiftKey: e.shiftKey,
  };
}
