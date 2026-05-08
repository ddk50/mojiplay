// 選択オブジェクトを複製 (Edit メニュー / Ctrl+D から呼ばれる)。
//
// Affinity / Sketch 風の Ctrl+D = duplicate。連続押下で step-and-repeat に
// なるよう、複製後の選択を新オブジェクトに付け替える。
//
// 設計判断:
//   - オフセットは「画面上 10px」相当 (= 10 / zoom の canvas 座標)。zoom 倍率に
//     関わらず一貫して "ややずれて見える" よう viewport 倍率を加味する。
//   - 同じ groupId のグループは複製側で「新しい同一 groupId」を共有する
//     (= 黒矢印で展開した時に複製群がまとめて選択される)。
//   - 各複製は新規 ULID を ensureObjectId で発行 (data.objectId を undefined に
//     してから呼ぶ)。data.outlined 等の他 custom field は origData から保持。

import { ensureObjectId } from '../../core/object-id';
import type { Command } from '../../core/history/types';
import type { ObjectId } from '../../core/object-id';
import { logger } from '../logger';
import { generateGroupId } from '../group-id';
import type { State } from '../state';

export function duplicateSelection(canvas: fabric.Canvas, state: State): void {
  const selected = canvas.getActiveObjects();
  if (selected.length === 0) return;

  // ActiveSelection の子は left/top が group 中心相対なので、世界座標で扱うため
  // 一旦 discardActiveObject する (outlineSelection と同じ理由)。
  canvas.discardActiveObject();

  const zoom = canvas.getZoom() || 1;
  const OFFSET_X = 10 / zoom;
  const OFFSET_Y = 10 / zoom;

  const groupIdRemap = new Map<string, string>();
  const cmds: Command[] = [];
  const newObjects: fabric.Object[] = [];

  for (const orig of selected) {
    const snapshot = (orig as any).toObject(['data']) as any;
    const origData = snapshot.data ?? {};
    const type = snapshot.type as string;
    const objType: 'text' | 'path' = origData.type ?? (type === 'path' ? 'path' : 'text');

    // groupId 再マップ (同じ元 groupId なら同じ新 groupId を共有)
    const oldGid = origData.groupId as string | undefined;
    let newGid: string | undefined;
    if (oldGid) {
      let mapped = groupIdRemap.get(oldGid);
      if (!mapped) { mapped = generateGroupId(); groupIdRemap.set(oldGid, mapped); }
      newGid = mapped;
    }

    let cloned: fabric.Object;
    if (type === 'path') {
      const { path: pathData, type: _t, data: _d, ...opts } = snapshot;
      cloned = new fabric.Path(pathData, opts);
    } else if (type === 'text' || type === 'i-text') {
      const { text: textValue, type: _t, data: _d, ...opts } = snapshot;
      cloned = new fabric.Text(textValue, opts);
    } else {
      logger.warn(`[duplicate] skipping unknown type: ${type}`);
      continue;
    }

    cloned.set({
      left: (cloned.left ?? 0) + OFFSET_X,
      top:  (cloned.top  ?? 0) + OFFSET_Y,
    });

    // data: 新 objectId は ensureObjectId で発行、groupId は再マップ後の値、
    // sourceText / charIndex / outlined 等の custom field は origData から保持。
    (cloned as any).data = {
      ...origData,
      objectId: undefined,
      groupId:  newGid,
    };
    const newId = ensureObjectId(cloned as any, objType);

    cloned.setCoords();
    canvas.add(cloned);
    newObjects.push(cloned);
    cmds.push({
      kind: 'objectCreated',
      objectId: newId,
      after: state.captureObjectSnapshot(cloned),
    });
  }

  // 複製群を新しい active selection にする (= 連続 Ctrl+D で step-and-repeat)
  if (newObjects.length === 1) {
    canvas.setActiveObject(newObjects[0]);
  } else if (newObjects.length > 1) {
    const sel = new fabric.ActiveSelection(newObjects, { canvas });
    canvas.setActiveObject(sel);
  }
  canvas.requestRenderAll();

  if (cmds.length === 1) {
    state.pushCommand(cmds[0]);
  } else if (cmds.length > 1) {
    state.pushCommand({ kind: 'compound', commands: cmds });
  }
  if (cmds.length > 0) {
    logger.debug(`[history] push duplicate: ${cmds.length} object(s)`);
  }
}
