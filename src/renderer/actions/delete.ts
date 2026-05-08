// 選択オブジェクト削除 (Edit メニュー / Delete キーから呼ばれる)。

import type { Command } from '../../core/history/types';
import type { ObjectId } from '../../core/object-id';
import { logger } from '../logger';
import type { State } from '../state';

export function deleteSelection(canvas: fabric.Canvas, state: State): void {
  const selected = canvas.getActiveObjects();
  if (!selected.length) return;

  // History: 削除前に各 object の snapshot を捕捉、compound として push。
  const cmds: Command[] = [];
  for (const obj of selected) {
    const id = (obj as any).data?.objectId as ObjectId | undefined;
    if (id) {
      cmds.push({
        kind: 'objectDeleted',
        objectId: id,
        before: state.captureObjectSnapshot(obj),
      });
    }
  }

  selected.forEach(obj => canvas.remove(obj));
  canvas.discardActiveObject();
  canvas.renderAll();

  if (cmds.length === 1) {
    state.pushCommand(cmds[0]);
  } else if (cmds.length > 1) {
    state.pushCommand({ kind: 'compound', commands: cmds });
  }
  if (cmds.length > 0) {
    logger.debug(`[history] push delete: ${cmds.length} object(s)`);
  }
}
