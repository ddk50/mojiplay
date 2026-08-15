// CanvasPort の fabric 実装。旧 State private の ObjectSnapshot 境界変換
// (resolveObjectById / writeSnapshotToCanvas / createObjectOnCanvas /
// removeObjectFromCanvas) と永続化の canvas 側半分をここに移設。
//
// snapshot の中身 (fabric の toObject 形式) を解釈するのはこのファイルだけ。
// port の呼び手 (State の undo/redo 機構、将来の DocumentInteractor) は snapshot を
// 不透明 blob として受け渡すのみ。

import type { ObjectId } from '../core/object-id';
import type { ObjectSnapshot } from '../core/history/types';
import type { CanvasPort } from '../usecases/canvas-port-interface';
import { markPathDirty, recomputePathDimensions } from './fabric-internals';

// fabric.Path.path は @types/fabric が `Point[]` と誤定義しているが、実体は
// [['M', x, y], ['L', x, y], ...] という command tuple 配列。
type PathCommandArray = ReadonlyArray<ReadonlyArray<number | string>>;

export class FabricCanvasPort implements CanvasPort {
  private readonly canvas: fabric.Canvas;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  writeSnapshot(snapshot: ObjectSnapshot): void {
    const id = snapshot.data.objectId;
    const obj = this.resolveObjectById(id);
    if (!obj) return;

    const type = snapshot.type as string;

    if (type === 'path') {
      const p = obj as fabric.Path;
      // path 配列の上書きは set() に任せず直接代入 (fabric 内部の正規化を回避)。
      (p as unknown as { path: PathCommandArray }).path = snapshot.path as PathCommandArray;
      p.set({
        left: snapshot.left as number,
        top: snapshot.top as number,
        scaleX: snapshot.scaleX as number,
        scaleY: snapshot.scaleY as number,
        angle: snapshot.angle as number,
        flipX: snapshot.flipX as boolean | undefined,
        flipY: snapshot.flipY as boolean | undefined,
        skewX: snapshot.skewX as number | undefined,
        skewY: snapshot.skewY as number | undefined,
        fill: snapshot.fill as string | undefined,
      });
      // commands 変更後、width / height / pathOffset を再算出
      recomputePathDimensions(p, { left: p.left, top: p.top });
      markPathDirty(p);
    } else if (type === 'text' || type === 'i-text') {
      const t = obj as fabric.Text;
      t.set({
        text: snapshot.text as string,
        left: snapshot.left as number,
        top: snapshot.top as number,
        scaleX: snapshot.scaleX as number,
        scaleY: snapshot.scaleY as number,
        angle: snapshot.angle as number,
        flipX: snapshot.flipX as boolean | undefined,
        flipY: snapshot.flipY as boolean | undefined,
        skewX: snapshot.skewX as number | undefined,
        skewY: snapshot.skewY as number | undefined,
        fill: snapshot.fill as string | undefined,
        fontFamily: snapshot.fontFamily as string | undefined,
        fontSize: snapshot.fontSize as number | undefined,
        fontWeight: snapshot.fontWeight as string | number | undefined,
        fontStyle: snapshot.fontStyle as fabric.IText['fontStyle'],
      });
    }

    // data (objectId / type / その他 custom field) を snapshot から復元。
    obj.data = { ...obj.data, ...snapshot.data };

    obj.setCoords();
  }

  createFromSnapshot(snapshot: ObjectSnapshot): void {
    const type = snapshot.type as string;
    let obj: fabric.Object;

    if (type === 'path') {
      const { path: pathData, type: _t, ...opts } = snapshot;
      obj = new fabric.Path(pathData as unknown as fabric.Point[], opts as fabric.IPathOptions);
    } else if (type === 'text' || type === 'i-text') {
      const { text: textValue, type: _t, ...opts } = snapshot;
      obj = new fabric.Text(textValue as string, opts as fabric.TextOptions);
    } else {
      throw new Error(`Unknown object type for createFromSnapshot: ${type}`);
    }

    if (!obj.data || !obj.data.objectId) {
      obj.data = { ...snapshot.data };
    }

    this.canvas.add(obj);
  }

  removeObject(id: ObjectId): void {
    const obj = this.resolveObjectById(id);
    if (obj) this.canvas.remove(obj);
  }

  requestRender(): void {
    this.canvas.requestRenderAll();
  }

  async loadDocument(canvasJson: unknown): Promise<void> {
    this.canvas.clear();
    // canvas.loadFromJSON は内部で enlivenObjects を呼ぶため非同期。callback で resolve。
    await new Promise<void>((resolve) => this.canvas.loadFromJSON(canvasJson, () => resolve()));
    this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    this.canvas.requestRenderAll();
  }

  dumpDocument(): unknown {
    return this.canvas.toJSON(['data']);
  }

  private resolveObjectById(id: ObjectId): fabric.Object | null {
    return this.canvas.getObjects().find((o) => o.data?.objectId === id) ?? null;
  }
}
