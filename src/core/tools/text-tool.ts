// テキストツール: キャンバスの空き領域クリックで IText を生成し、編集モードに入る。
//
// 本クラスは「フォントプロパティを供給する関数」と「host.createTextAt 呼び出し」の
// 配線役。IText の生成と編集モード突入は host (fabric) 側に閉じ込める。
//
// fabric の mouse:down (= fabric の hit-test 後) に乗る。target がある (既存
// オブジェクトクリック) 場合は何もしない (fabric の通常選択動作に任せる)。
//
// pointer 系イベントは全て no-op (DOM capture 段階では何もしない)。

interface FontPropsProvider {
  (): TextCreateProps;
}

class TextTool implements Tool {
  constructor(private getFontProps: FontPropsProvider) {}

  onActivate(_host: ToolHost): void { /* no-op */ }
  onDeactivate(_host: ToolHost): void { /* no-op */ }

  onPointerDown(_e: PointerInput, _host: ToolHost): PointerHandled { return 'pass'; }
  onPointerMove(_e: PointerInput, _host: ToolHost): void { /* no-op */ }
  onPointerUp(_e: PointerInput, _host: ToolHost): void { /* no-op */ }
  isDragging(): boolean { return false; }

  onObjectMoving(_t: MovingTarget, _e: { altKey: boolean }, _host: ToolHost): void { /* no-op */ }
  onSelectionChanged(_host: ToolHost): void { /* no-op */ }

  onCanvasMouseDown(e: CanvasMouseDownInput, host: ToolHost): void {
    if (e.hasTarget) return;
    host.createTextAt(e.worldX, e.worldY, this.getFontProps());
  }
}

// Dual-mode export
// @ts-ignore
if (typeof module !== 'undefined' && module.exports) {
  // @ts-ignore
  module.exports.TextTool = TextTool;
}
