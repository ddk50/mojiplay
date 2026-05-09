// renderer/state.ts — fabric.Canvas を encapsulate した State クラス。
//
// CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」の State 層を
// 1 クラスに集約。fabric への結合を 1 ファイルに閉じ込め、外部 (Tool / app.ts /
// menu) には ToolHost interface + History API + 永続化 API を提供する。
//
// fabric の癖 (path 配列の直接代入 / `_setPositionDimensions` / pathOffset 補正 /
// ActiveSelection の座標系) はすべてこの中に閉じ込められている。
//
// 設計判断:
//   - 巨大 factory 関数 (createState) ではなく class State として書く。private 化は
//     TS の `private` キーワードで明示。サイズ的にも domain 概念としても class が妥当。
//   - `class State implements ToolHost` で contract 充足を明示。継承 mixin はしない。
//   - constructor injection で canvas / options を受ける (Clean Architecture の
//     UseCase 流)。
//   - canvas event handler は arrow メソッドで定義し `this` binding を保つ。

import { ensureObjectId } from '../core/object-id';
import type { ObjectId } from '../core/object-id';
import type { Command, ObjectSnapshot, HistoryStack } from '../core/history/types';
import { createHistoryStack } from '../core/history/stack';
import type {
  ObjectHandle, PathHandle, PathSnapshot, TextCreateProps,
  State as StateContract,
} from '../core/state';
import type { DocumentSnapshot } from '../core/document/snapshot';
import type { Mat2x3 } from '../core/path/coords';
import type { PathCommand } from '../core/path/types';
import { fromFabricPath, toFabricPath } from './path-adapter';
import { logger, fmtObj } from './logger';
import { generateGroupId } from './group-id';
import { outlineTextToPath } from './outline-conversion';
import { exportObjectToPngDataUrl } from './copy-export';

export interface CreateStateOptions {
  /** History 上限。default 100 */
  historyMax?: number;
}

export class State implements StateContract {
  private readonly canvas: fabric.Canvas;
  private readonly historyStack: HistoryStack;
  private readonly upperCanvas: HTMLCanvasElement;

  // ObjectHandle canonical 化キャッシュ。
  // SelectGroupTool は alreadyExpanded 判定で identity (===) を使うため、
  // 毎回別 instance を返すと「展開済み」を検出できず無限再帰し、fabric の
  // drag state を破壊する。WeakMap で fabric.Object が GC されると自動で抜けるので
  // メモリリークも無い。
  private readonly objectHandleCache = new WeakMap<fabric.Object, ObjectHandle & { _obj: fabric.Object }>();

  // fabric-driven な transform (drag / scale / rotate) の直前 snapshot を保持。
  // mouse:down で capture、object:modified で消費。ObjectId をキー (multi-select 用)。
  private readonly transformBeforeSnapshots = new Map<ObjectId, ObjectSnapshot>();

  // dirty tracking 用の opaque token。state を変えうる全操作 (pushCommand / undo / redo /
  // clearHistory / applySnapshot) で increment し、mutationListeners を発火する。
  private tokenCounter = 0;
  private mutationListeners: Array<() => void> = [];

  constructor(canvas: fabric.Canvas, options: CreateStateOptions = {}) {
    this.canvas = canvas;
    this.historyStack = createHistoryStack({ max: options.historyMax ?? 100 });
    this.upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;

    // fabric event hook (mouse:down で before snapshot capture、object:modified で
    // fabric-driven な transform を Command 化して history に push)
    this.canvas.on('mouse:down', this.handleMouseDown);
    this.canvas.on('object:modified', this.handleObjectModified);
  }

  // ===== ToolHost interface 実装 =====

  getActivePath(): PathHandle | null {
    const p = this.getActiveOutlinedPath();
    return p ? this.makePathHandle(p) : null;
  }

  getViewportMatrix(): Mat2x3 {
    return this.canvas.viewportTransform as unknown as Mat2x3;
  }

  requestRerender(): void {
    this.canvas.requestRenderAll();
  }

  setCursor(c: string): void {
    this.upperCanvas.style.cursor = c;
  }

  getActiveObjects(): ReadonlyArray<ObjectHandle> {
    const active = this.canvas.getActiveObject();
    if (!active) return [];
    const objs: fabric.Object[] = active.type === 'activeSelection'
      ? (active as fabric.ActiveSelection).getObjects()
      : [active];
    return objs.map(o => this.makeObjectHandle(o));
  }

  getAllObjects(): ReadonlyArray<ObjectHandle> {
    return this.canvas.getObjects().map(o => this.makeObjectHandle(o));
  }

  setActiveSelection(handles: ReadonlyArray<ObjectHandle>): void {
    const objs = handles.map(h => (h as any)._obj as fabric.Object);
    this.canvas.discardActiveObject();
    if (objs.length === 1) {
      this.canvas.setActiveObject(objs[0]);
    } else if (objs.length > 1) {
      const sel = new fabric.ActiveSelection(objs, { canvas: this.canvas });
      this.canvas.setActiveObject(sel);
    }
    this.canvas.requestRenderAll();
  }

  createTextAt(x: number, y: number, props: TextCreateProps): void {
    const it = new fabric.IText('', {
      left:       x,
      top:        y,
      fontFamily: props.fontFamily,
      fontSize:   props.fontSize,
      fontWeight: props.fontWeight,
      fontStyle:  props.fontStyle,
      fill:       props.fill,
      selectable: true,
      evented:    true,
    });
    this.canvas.add(it);
    this.canvas.setActiveObject(it);
    it.enterEditing();
    (it as any).hiddenTextarea?.focus();
  }

  pushCommand(cmd: Command): void {
    this.historyStack.push(cmd);
    logger.debug(`[history] push kind=${cmd.kind}`);
    this.bumpToken();
  }

  // ===== History 操作 =====

  undo(): void {
    const cmd = this.historyStack.undo();
    if (!cmd) {
      logger.debug('[history] undo: nothing to undo');
      return;
    }
    logger.debug(`[history] undo kind=${cmd.kind}`);
    this.revertCommand(cmd);
    this.bumpToken();
    // Phase A 規約: undo は selection を能動的に変更しない (camera 層は履歴対象外)
  }

  redo(): void {
    const cmd = this.historyStack.redo();
    if (!cmd) {
      logger.debug('[history] redo: nothing to redo');
      return;
    }
    logger.debug(`[history] redo kind=${cmd.kind}`);
    this.applyCommand(cmd);
    this.bumpToken();
  }

  canUndo(): boolean { return this.historyStack.canUndo(); }
  canRedo(): boolean { return this.historyStack.canRedo(); }

  // ===== 永続化 (snapshot 境界変換) =====

  toSnapshot(): DocumentSnapshot {
    return {
      format:  'mojiplay',
      version: 1,
      canvas:  this.canvas.toJSON(['data']),
    };
  }

  async applySnapshot(s: DocumentSnapshot): Promise<void> {
    this.canvas.clear();
    // canvas.loadFromJSON は内部で enlivenObjects を呼ぶため非同期。callback で resolve。
    await new Promise<void>(resolve =>
      this.canvas.loadFromJSON(s.canvas, () => resolve())
    );
    this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    this.canvas.requestRenderAll();
    // 注: data.objectId は信頼してそのまま採用 (再発行しない)。
    // 単一 window 前提。複数 window 同時 load を許す機能を入れる時は要検討。
    this.clearHistory();
  }

  commitActiveText(): void {
    // discardActiveObject は IText 編集中なら 'text:editing:exited' を発火させ、
    // app.ts の commitIText ハンドラが分割を完了する。それ以外なら無害な選択解除。
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  // ===== dirty tracking =====

  getHistoryToken(): number { return this.tokenCounter; }

  onMutate(cb: () => void): () => void {
    this.mutationListeners.push(cb);
    return () => {
      this.mutationListeners = this.mutationListeners.filter(c => c !== cb);
    };
  }

  clearHistory(): void {
    this.historyStack.clear();
    this.transformBeforeSnapshots.clear();
    this.bumpToken();
  }

  // ===== 高レベル selection 操作 (= 旧 actions/* の fabric 操作をここに閉じ込め) =====

  getZoom(): number {
    return this.canvas.getZoom() || 1;
  }

  removeActiveObjects(): void {
    const selected = this.canvas.getActiveObjects();
    if (!selected.length) return;

    // History: 削除前に各 object の snapshot を捕捉、compound として push。
    const cmds: Command[] = [];
    for (const obj of selected) {
      const id = (obj as any).data?.objectId as ObjectId | undefined;
      if (id) {
        cmds.push({
          kind: 'objectDeleted',
          objectId: id,
          before: this.captureObjectSnapshot(obj),
        });
      }
    }

    selected.forEach(obj => this.canvas.remove(obj));
    this.canvas.discardActiveObject();
    this.canvas.renderAll();

    if (cmds.length === 1) {
      this.pushCommand(cmds[0]);
    } else if (cmds.length > 1) {
      this.pushCommand({ kind: 'compound', commands: cmds });
    }
    if (cmds.length > 0) {
      logger.debug(`[history] push delete: ${cmds.length} object(s)`);
    }
  }

  duplicateActiveObjects(offset: { x: number; y: number }): void {
    const selected = this.canvas.getActiveObjects();
    if (selected.length === 0) return;

    // ActiveSelection の子は left/top が group 中心相対なので、世界座標で扱うため
    // 一旦 discardActiveObject する (outlineActiveTexts と同じ理由)。
    this.canvas.discardActiveObject();

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
        left: (cloned.left ?? 0) + offset.x,
        top:  (cloned.top  ?? 0) + offset.y,
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
      this.canvas.add(cloned);
      newObjects.push(cloned);
      cmds.push({
        kind: 'objectCreated',
        objectId: newId,
        after: this.captureObjectSnapshot(cloned),
      });
    }

    // 複製群を新しい active selection にする (= 連続 Ctrl+D で step-and-repeat)
    if (newObjects.length === 1) {
      this.canvas.setActiveObject(newObjects[0]);
    } else if (newObjects.length > 1) {
      const sel = new fabric.ActiveSelection(newObjects, { canvas: this.canvas });
      this.canvas.setActiveObject(sel);
    }
    this.canvas.requestRenderAll();

    if (cmds.length === 1) {
      this.pushCommand(cmds[0]);
    } else if (cmds.length > 1) {
      this.pushCommand({ kind: 'compound', commands: cmds });
    }
    if (cmds.length > 0) {
      logger.debug(`[history] push duplicate: ${cmds.length} object(s)`);
    }
  }

  selectAllObjects(): void {
    this.canvas.discardActiveObject();
    const all = this.canvas.getObjects();
    if (!all.length) return;
    const sel = new fabric.ActiveSelection(all, { canvas: this.canvas });
    this.canvas.setActiveObject(sel);
    this.canvas.requestRenderAll();
  }

  async outlineActiveTexts(): Promise<{
    succeeded:      number;
    failedChars:    string;
    failedFamilies: ReadonlyArray<string>;
  }> {
    const isOutlineable = (obj: fabric.Object): boolean => {
      const anyObj = obj as any;
      if (anyObj.data?.outlined) return false;
      return typeof anyObj.text === 'string' && typeof anyObj.fontFamily === 'string';
    };
    const targets = this.canvas.getActiveObjects().filter(isOutlineable) as fabric.Text[];
    if (targets.length === 0) {
      return { succeeded: 0, failedChars: '', failedFamilies: [] };
    }

    // ActiveSelection 解除で子の座標を世界座標に戻す (outlineTextToPath は世界座標前提)
    this.canvas.discardActiveObject();

    const conversions = await Promise.all(
      targets.map(async (ft) => ({ ft, path: await outlineTextToPath(ft) }))
    );

    const succeeded = conversions.filter(x => x.path) as Array<{ ft: fabric.Text; path: fabric.Path }>;
    const failed    = conversions.filter(x => !x.path);
    const failedChars    = failed.map(x => x.ft.text || '').join('');
    const failedFamilies = Array.from(new Set(failed.map(x => x.ft.fontFamily || '?')));

    if (succeeded.length === 0) {
      return { succeeded: 0, failedChars, failedFamilies };
    }

    const vt = this.canvas.viewportTransform;
    logger.debug(
      `[outline] outlineActiveTexts: succeeded=${succeeded.length}` +
      ` viewportTransform=[${vt?.map(n => n.toFixed(3)).join(',')}]` +
      ` zoom=${this.canvas.getZoom()}`
    );

    const outlineCommands: Command[] = [];
    for (const { ft, path } of succeeded) {
      const ftId   = (ft   as any).data?.objectId as ObjectId | undefined;
      const pathId = (path as any).data?.objectId as ObjectId | undefined;
      if (ftId) outlineCommands.push({
        kind: 'objectDeleted',
        objectId: ftId,
        before: this.captureObjectSnapshot(ft),
      });
      this.canvas.remove(ft);
      this.canvas.add(path);
      if (pathId) outlineCommands.push({
        kind: 'objectCreated',
        objectId: pathId,
        after: this.captureObjectSnapshot(path),
      });
    }
    if (outlineCommands.length === 1) {
      this.pushCommand(outlineCommands[0]);
    } else if (outlineCommands.length > 1) {
      this.pushCommand({ kind: 'compound', commands: outlineCommands });
    }
    if (outlineCommands.length > 0) {
      logger.debug(`[history] push outline: ${succeeded.length} text(s) outlined`);
    }
    this.canvas.requestRenderAll();

    return { succeeded: succeeded.length, failedChars, failedFamilies };
  }

  exportActiveAsPngDataUrl(multiplier: number): { dataUrl: string; width: number; height: number } | null {
    const active = this.canvas.getActiveObject();
    if (!active) return null;
    logger.debug(`[copy] export active=${fmtObj(active)} multiplier=${multiplier}`);
    return exportObjectToPngDataUrl(active as any, multiplier);
  }

  // ===== 高レベル handler 用ヘルパ =====

  /**
   * 高レベル UI handler 用ヘルパ。state を経由しない直接 canvas 操作 (commitIText /
   * outlineSelection / menuDeleteSelection / applyToSelection 等) で使用。
   * 「state が完全に encapsulate」ではなく「foundational ops は state、高レベル
   * orchestration は app.ts」という現状の分担に対する妥協。将来高レベルハンドラも
   * state 内部に取り込めばこの公開は不要になる。
   */
  captureObjectSnapshot(obj: fabric.Object): ObjectSnapshot {
    return obj.toObject(['data']) as ObjectSnapshot;
  }

  // ===== debug =====

  linearizeHistory(): ReadonlyArray<Command> {
    return this.historyStack.linearize();
  }

  // ============================================================
  // 以下 private
  // ============================================================

  // ----- dirty tracking -----

  private bumpToken(): void {
    this.tokenCounter++;
    this.mutationListeners.forEach(cb => cb());
  }

  // ----- ObjectSnapshot 境界変換 -----

  private resolveObjectById(id: ObjectId): fabric.Object | null {
    return this.canvas.getObjects().find(o => (o as any).data?.objectId === id) ?? null;
  }

  private writeSnapshotToCanvas(snapshot: ObjectSnapshot): void {
    const id = snapshot.data.objectId;
    const obj = this.resolveObjectById(id);
    if (!obj) return;

    const type = snapshot.type as string;

    if (type === 'path') {
      const p = obj as fabric.Path;
      // path 配列の上書きは set() に任せず直接代入 (fabric 内部の正規化を回避)。
      (p as any).path = (snapshot as any).path;
      p.set({
        left:   snapshot.left   as number,
        top:    snapshot.top    as number,
        scaleX: snapshot.scaleX as number,
        scaleY: snapshot.scaleY as number,
        angle:  snapshot.angle  as number,
        fill:   snapshot.fill   as string | undefined,
      });
      // commands 変更後、width / height / pathOffset を再算出
      (fabric.Polyline.prototype as any)._setPositionDimensions.call(p, { left: p.left, top: p.top });
      (p as any).dirty = true;
    } else if (type === 'text' || type === 'i-text') {
      const t = obj as fabric.Text;
      t.set({
        text:       snapshot.text       as string,
        left:       snapshot.left       as number,
        top:        snapshot.top        as number,
        scaleX:     snapshot.scaleX     as number,
        scaleY:     snapshot.scaleY     as number,
        angle:      snapshot.angle      as number,
        fill:       snapshot.fill       as string | undefined,
        fontFamily: snapshot.fontFamily as string | undefined,
        fontSize:   snapshot.fontSize   as number | undefined,
        fontWeight: snapshot.fontWeight as string | number | undefined,
        fontStyle:  snapshot.fontStyle  as fabric.IText['fontStyle'],
      });
    }

    // data (objectId / type / その他 custom field) を snapshot から復元。
    (obj as any).data = { ...(obj as any).data, ...snapshot.data };

    obj.setCoords();
  }

  private createObjectOnCanvas(snapshot: ObjectSnapshot): fabric.Object {
    const type = snapshot.type as string;
    let obj: fabric.Object;

    if (type === 'path') {
      const { path: pathData, type: _t, ...opts } = snapshot as any;
      obj = new fabric.Path(pathData, opts as fabric.IPathOptions);
    } else if (type === 'text' || type === 'i-text') {
      const { text: textValue, type: _t, ...opts } = snapshot as any;
      obj = new fabric.Text(textValue, opts as fabric.TextOptions);
    } else {
      throw new Error(`Unknown object type for createObjectOnCanvas: ${type}`);
    }

    if (!(obj as any).data || !(obj as any).data.objectId) {
      (obj as any).data = { ...snapshot.data };
    }

    this.canvas.add(obj);
    return obj;
  }

  private removeObjectFromCanvas(id: ObjectId): void {
    const obj = this.resolveObjectById(id);
    if (obj) this.canvas.remove(obj);
  }

  // ----- PathHandle / ObjectHandle 実装 -----

  /** drag 終了時の bbox 再計算 + pathOffset 補正 + object:modified 発火。 */
  private finalizeDrag(p: fabric.Path): void {
    const oldPO = { x: (p as any).pathOffset.x, y: (p as any).pathOffset.y };
    (fabric.Polyline.prototype as any)._setPositionDimensions.call(p, {
      left: p.left,
      top:  p.top,
    });
    const newPO = (p as any).pathOffset as { x: number; y: number };
    const dxLocal = oldPO.x - newPO.x;
    const dyLocal = oldPO.y - newPO.y;
    const sx = (p.scaleX as number) ?? 1;
    const sy = (p.scaleY as number) ?? 1;
    const rad = ((p.angle as number) ?? 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    p.left = (p.left ?? 0) + dxLocal * sx * cos - dyLocal * sy * sin;
    p.top  = (p.top  ?? 0) + dxLocal * sx * sin + dyLocal * sy * cos;
    p.setCoords();
    this.canvas.fire('object:modified', { target: p } as any);
  }

  private makePathHandle(p: fabric.Path): PathHandle {
    return {
      snapshot: (): PathSnapshot => ({
        commands:   fromFabricPath((p as any).path as ReadonlyArray<ReadonlyArray<unknown>>),
        pathMatrix: p.calcTransformMatrix() as unknown as Mat2x3,
        pathOffset: { x: (p as any).pathOffset.x, y: (p as any).pathOffset.y },
      }),
      setCommands: (cmds: ReadonlyArray<PathCommand>) => {
        (p as any).path = toFabricPath(cmds);
        (p as any).dirty = true;
      },
      finalizeEdit: () => this.finalizeDrag(p),
      getId: () => (p as any).data?.objectId as ObjectId,
      captureForHistory: () => p.toObject(['data']) as ObjectSnapshot,
    };
  }

  private makeObjectHandle(o: fabric.Object): ObjectHandle & { _obj: fabric.Object } {
    let h = this.objectHandleCache.get(o);
    if (!h) {
      h = {
        getGroupId: () => (o as any).data?.groupId,
        _obj: o,
      };
      this.objectHandleCache.set(o, h);
    }
    return h;
  }

  private getActiveOutlinedPath(): fabric.Path | null {
    const obj = this.canvas.getActiveObject();
    if (!obj || obj.type !== 'path') return null;
    if (!(obj as any).data?.outlined) return null;
    return obj as fabric.Path;
  }

  // ----- Command apply / revert -----

  private applyCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        this.writeSnapshotToCanvas(cmd.after);
        break;
      case 'objectCreated':
        this.createObjectOnCanvas(cmd.after);
        break;
      case 'objectDeleted':
        this.removeObjectFromCanvas(cmd.objectId);
        break;
      case 'compound':
        cmd.commands.forEach(c => this.applyCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    this.canvas.requestRenderAll();
  }

  private revertCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        this.writeSnapshotToCanvas(cmd.before);
        break;
      case 'objectCreated':
        this.removeObjectFromCanvas(cmd.objectId);
        break;
      case 'objectDeleted':
        this.createObjectOnCanvas(cmd.before);
        break;
      case 'compound':
        // 逆順で revert (= apply の逆順序で打ち消す)
        [...cmd.commands].reverse().forEach(c => this.revertCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    this.canvas.requestRenderAll();
  }

  // ----- fabric event handlers (arrow methods で this binding を保つ) -----

  /**
   * 各 object の現在 snapshot を保持しておき、object:modified で diff を取って
   * objectChanged Command を構築する。tool が consume した drag (アンカー編集等) は
   * DOM capture phase で stopImmediatePropagation されているので fabric は
   * mouse:down を受け取らない。
   */
  private readonly handleMouseDown = (opt: fabric.IEvent): void => {
    const target = opt.target;
    if (!target) return;
    const objs: fabric.Object[] = target.type === 'activeSelection'
      ? (target as fabric.ActiveSelection).getObjects()
      : [target];
    for (const o of objs) {
      const id = (o as any).data?.objectId as ObjectId | undefined;
      if (id) this.transformBeforeSnapshots.set(id, this.captureObjectSnapshot(o));
    }
  };

  /**
   * fabric-driven な transform (drag / scale / rotate via selection controls) を
   * Command 化。tool-driven な finalizeDrag からの fire は e.action が無いので skip。
   * 詳細は CLAUDE.md「Tool-driven vs fabric-driven の区別」参照。
   */
  private readonly handleObjectModified = (e: fabric.IEvent): void => {
    const o = e.target as fabric.Object | undefined;
    if (!o) return;
    const vt = this.canvas.viewportTransform;
    logger.debug(
      `[object:modified] ${fmtObj(o)} left=${o.left} top=${o.top}` +
      ` data.groupId=${(o as any).data?.groupId ?? '-'}` +
      ` action=${(e as any).action ?? '-'}` +
      ` vt=[${vt?.map((n: number) => n.toFixed(3)).join(',')}]`
    );

    const action = (e as any).action;
    if (!action) return;  // tool-driven な finalizeDrag からの fire は skip

    const objs: fabric.Object[] = o.type === 'activeSelection'
      ? (o as fabric.ActiveSelection).getObjects()
      : [o];

    const cmds: Command[] = [];
    for (const obj of objs) {
      const id = (obj as any).data?.objectId as ObjectId | undefined;
      if (!id) continue;
      const before = this.transformBeforeSnapshots.get(id);
      this.transformBeforeSnapshots.delete(id);
      if (!before) continue;
      const after = this.captureObjectSnapshot(obj);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        cmds.push({ kind: 'objectChanged', objectId: id, before, after });
      }
    }

    if (cmds.length === 1) {
      logger.debug(`[history] push objectChanged ${fmtObj(objs[0])} action=${action}`);
      this.pushCommand(cmds[0]);
    } else if (cmds.length > 1) {
      logger.debug(`[history] push compound ${cmds.length} changes action=${action}`);
      this.pushCommand({ kind: 'compound', commands: cmds });
    }
  };
}
