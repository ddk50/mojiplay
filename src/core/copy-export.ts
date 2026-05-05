// PNG エクスポート用ラッパー (純粋関数)
//
// ── 経緯: なぜこのラッパーが存在するか ──────────────────────────────────
//
// fabric.Object.prototype.toCanvasElement(options) は **options オブジェクト**
// で multiplier を受け取る。しかし Canvas-level の同名メソッド
// fabric.Canvas.prototype.toCanvasElement(multiplier, cropping) は positional
// arg を取る。この API の違いにより、Object-level で toCanvasElement(10) と
// 呼ぶと options=10 (数値) として解釈され、10.multiplier = undefined → 常に
// 1 倍でレンダリングされるバグが 3 回発生した。
//
// このモジュールで typed wrapper に閉じ込めることで:
//   1. 型システム: ExportableObject.toCanvasElement の引数が
//      { multiplier?: number } なので、数値を直接渡すとコンパイルエラー
//   2. テスト: モックで出力サイズを検証し、multiplier が正しく渡されることを保証
//
// outline-position.ts と同じ dual-mode パターン。

/** toCanvasElement を持つオブジェクトの最小インターフェース */
interface ExportableObject {
  toCanvasElement(options: { multiplier?: number }): {
    width: number;
    height: number;
    toDataURL(format: string): string;
  };
}

interface ExportResult {
  dataUrl: string;
  width: number;
  height: number;
}

function exportObjectToPngDataUrl(
  obj: ExportableObject,
  multiplier: number,
): ExportResult {
  if (typeof multiplier !== 'number' || multiplier <= 0 || !isFinite(multiplier)) {
    throw new Error(`invalid multiplier: ${multiplier}`);
  }
  const el = obj.toCanvasElement({ multiplier });
  return {
    dataUrl: el.toDataURL('image/png'),
    width: el.width,
    height: el.height,
  };
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.exportObjectToPngDataUrl = exportObjectToPngDataUrl;
}
