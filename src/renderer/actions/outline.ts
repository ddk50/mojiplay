// アウトライン化 (Edit メニュー / btn-outline / Cmd+Shift+O から呼ばれる)。
//
// 純粋寄りの変換 (outlineTextToPath, getFontkitFont, loadFontData,
// fontkitFontCache) は renderer/outline-conversion.ts にある。
// canvas 操作を含む outlineSelection / isOutlineable はここ。

import type { Command } from '../../core/history/types';
import type { ObjectId } from '../../core/object-id';
import { logger } from '../logger';
import { showToast } from '../toast';
import { outlineTextToPath } from '../outline-conversion';
import type { State } from '../state';

export function isOutlineable(obj: fabric.Object): boolean {
  const anyObj = obj as any;
  if (anyObj.data?.outlined) return false;
  return typeof anyObj.text === 'string' && typeof anyObj.fontFamily === 'string';
}

export async function outlineSelection(canvas: fabric.Canvas, state: State): Promise<void> {
  const targets = canvas.getActiveObjects().filter(isOutlineable) as fabric.Text[];
  if (targets.length === 0) {
    showToast('アウトライン化する文字を選択してください', true);
    return;
  }

  // 複数選択中 (fabric.ActiveSelection) では、子オブジェクトの .left/.top は
  // group 中心からの相対座標で保持されている (fabric.ActiveSelection の
  // _updateObjectsCoords が書き換えるため)。選択を解除すると destroy() →
  // _restoreObjectsState が走って子の座標が世界座標に戻る。
  // outlineTextToPath は .left/.top を世界座標前提で読むので、ここで先に選択を
  // 解除して座標を確定させる必要がある。
  // targets は配列参照で canvas 上の同じオブジェクトを指しているので、
  // 選択解除後にも同じ fabric.Text を操作できる。
  canvas.discardActiveObject();

  const conversions = await Promise.all(
    targets.map(async (ft) => ({ ft, path: await outlineTextToPath(ft) }))
  );

  const succeeded = conversions.filter(x => x.path) as Array<{ ft: fabric.Text; path: fabric.Path }>;
  const failed = conversions.filter(x => !x.path);
  const failedChars = failed.map(x => x.ft.text || '').join('');
  const failedFamilies = Array.from(new Set(failed.map(x => x.ft.fontFamily || '?')));

  if (succeeded.length === 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    showToast(`アウトライン化失敗: ${detail}`, true);
    return;
  }

  const vt = canvas.viewportTransform;
  logger.debug(
    `[outline] outlineSelection: succeeded=${succeeded.length}` +
    ` viewportTransform=[${vt?.map(n => n.toFixed(3)).join(',')}]` +
    ` zoom=${canvas.getZoom()}`
  );

  // discardActiveObject は最上部で既に実行済み (ActiveSelection の子の座標を
  // 世界座標に戻すため)。ここでは不要。
  // History: 各 Text→Path 変換を「Text 削除 + Path 作成」の compound として
  // まとめて 1 step push (= undo すれば全 Text が戻り、redo すれば全 Path が再生成)。
  const outlineCommands: Command[] = [];
  for (const { ft, path } of succeeded) {
    const ftId = (ft as any).data?.objectId as ObjectId | undefined;
    const pathId = (path as any).data?.objectId as ObjectId | undefined;
    if (ftId) outlineCommands.push({
      kind: 'objectDeleted',
      objectId: ftId,
      before: state.captureObjectSnapshot(ft),
    });
    canvas.remove(ft);
    canvas.add(path);
    if (pathId) outlineCommands.push({
      kind: 'objectCreated',
      objectId: pathId,
      after: state.captureObjectSnapshot(path),
    });
  }
  if (outlineCommands.length === 1) {
    state.pushCommand(outlineCommands[0]);
  } else if (outlineCommands.length > 1) {
    state.pushCommand({ kind: 'compound', commands: outlineCommands });
  }
  if (outlineCommands.length > 0) {
    logger.debug(`[history] push outline: ${succeeded.length} text(s) outlined`);
  }

  // NOTE: ここで setActiveObject(path) を呼ぶと 'selection:created' が発火し、
  // select-group モードでは expandSelectionToGroup が同じ groupId のオブジェク
  // ト全てを ActiveSelection にまとめてしまう。ActiveSelection は children の
  // left/top を group 中心相対に書き換えるため、fabric.Path 相手だと視覚的に
  // 飛んで見えるバグの温床になる (fabric.Text では同じロジックで問題無いが、
  // Path では pathOffset との組み合わせが複雑で再現する)。
  // 当面は自動選択を諦め、ユーザが手動で 1 クリックしたときに select-group の
  // 通常動作で展開される経路に委ねる (data.groupId は保持している)。
  canvas.requestRenderAll();

  if (failed.length > 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    showToast(`一部失敗: ${detail}`, true);
  }
}
