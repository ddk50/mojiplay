// すべて選択 (Edit メニュー / btn-select-all / Ctrl+A から呼ばれる)。

export function selectAll(canvas: fabric.Canvas): void {
  canvas.discardActiveObject();
  const all = canvas.getObjects();
  if (!all.length) return;
  const sel = new fabric.ActiveSelection(all, { canvas });
  canvas.setActiveObject(sel);
  canvas.requestRenderAll();
}
