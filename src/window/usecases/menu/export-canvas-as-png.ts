// canvas 全体を PNG ファイルとして保存する use case。
//
// 旧 ToolbarController.onExportClick に inline で書かれていた orchestration
// (canvas.discardActiveObject / renderAll / toDataURL → host.savePng → toast 表示)
// を free function として extract。
//
// canvas 操作 (discardActiveObject / renderAll / toDataURL) は State の
// exportCanvasAsPngDataUrl method に閉じ込めてある。ここでは State + HostShell +
// UIPort の orchestration だけ。

import type { State } from '../../core/state-interface';
import type { HostShell } from '../host-shell-interface';
import type { UIPort } from '../ui-port-interface';

const PNG_MULTIPLIER = 2;

export async function exportCanvasAsPng(state: State, host: HostShell, ui: UIPort): Promise<void> {
  const dataURL = state.exportCanvasAsPngDataUrl(PNG_MULTIPLIER);
  const r = await host.savePng(dataURL);
  if (r.ok) {
    ui.showToast(`保存しました: ${r.filePath}`);
  } else if (r.reason !== 'canceled') {
    ui.showToast(`エラー: ${r.reason}`, true);
  }
}
