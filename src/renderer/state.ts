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
import type { Command, ObjectSnapshot } from '../core/history/types';
import { History } from '../core/history/history';
import type {
  ObjectHandle,
  PathHandle,
  PathSnapshot,
  TextCreateProps,
  Mode,
  SelectionProps,
  State as StateContract,
} from '../core/state-interface';
import type { DocumentSnapshot } from '../core/document/snapshot';
import type { Mat2x3 } from '../core/path/coords';
import { Path } from '../core/path/path';
import { fromFabricPath, toFabricPath } from './path-adapter';
import { logger, fmtObj } from './logger';
import { generateGroupId } from './group-id';
import { outlineTextToPath } from './outline-conversion';
import { exportObjectToPngDataUrl } from './copy-export';
import {
  getUpperCanvasEl,
  getContextTop,
  focusITextTextarea,
  initITextDimensions,
  getITextLines,
  getITextCharBounds,
  getPathOffset,
  markPathDirty,
  recomputePathDimensions,
} from './fabric-internals';

export interface CreateStateOptions {
  /** History 上限。default 100 */
  historyMax?: number;
}

// fabric.Path.path は @types/fabric が `Point[]` と誤定義しているが、実体は
// [['M', x, y], ['L', x, y], ...] という command tuple 配列。reads / writes 時に
// `as unknown as { path: PathCommandArray }` で narrow する。
type PathCommandArray = ReadonlyArray<ReadonlyArray<number | string>>;

// State 内部の ObjectHandle は fabric.Object 参照を _obj に保持する。
// 公開 interface (ObjectHandle) に _obj は出さず、setActiveSelection 等の
// State 内部で型 narrow して取り出す。
type InternalHandle = ObjectHandle & { _obj: fabric.Object };

export class State implements StateContract {
  private readonly canvas: fabric.Canvas;
  private readonly history: History;
  private readonly upperCanvas: HTMLCanvasElement;

  // ObjectHandle canonical 化キャッシュ。
  // SelectGroupTool は alreadyExpanded 判定で identity (===) を使うため、
  // 毎回別 instance を返すと「展開済み」を検出できず無限再帰し、fabric の
  // drag state を破壊する。WeakMap で fabric.Object が GC されると自動で抜けるので
  // メモリリークも無い。
  private readonly objectHandleCache = new WeakMap<
    fabric.Object,
    ObjectHandle & { _obj: fabric.Object }
  >();

  // fabric-driven な transform (drag / scale / rotate) の直前 snapshot を保持。
  // mouse:down で capture、object:modified で消費。ObjectId をキー (multi-select 用)。
  private readonly transformBeforeSnapshots = new Map<ObjectId, ObjectSnapshot>();

  // dirty tracking 用の opaque token。state を変えうる全操作 (pushCommand / undo / redo /
  // clearHistory / applySnapshot) で increment し、mutationListeners を発火する。
  private tokenCounter = 0;
  private mutationListeners: Array<() => void> = [];

  // 現在のツールモード。setMode で更新、commitActiveText の selectable 判定で参照。
  // Controller 側の Tool dispatch / button class 切替は依然 Controller の責務。
  private currentMode: Mode = 'select-group';

  constructor(canvas: fabric.Canvas, options: CreateStateOptions = {}) {
    this.canvas = canvas;
    this.history = new History({ max: options.historyMax ?? 100 });
    this.upperCanvas = getUpperCanvasEl(canvas);

    // fabric event hook (mouse:down で before snapshot capture、object:modified で
    // fabric-driven な transform を Command 化して history に push、
    // text:editing:exited で IText を 1 文字ずつ fabric.Text に分割)
    this.canvas.on('mouse:down', this.handleMouseDown);
    this.canvas.on('object:modified', this.handleObjectModified);
    this.canvas.on('text:editing:exited', this.handleTextEditingExited);
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
    const objs: fabric.Object[] =
      active.type === 'activeSelection'
        ? (active as fabric.ActiveSelection).getObjects()
        : [active];
    return objs.map((o) => this.makeObjectHandle(o));
  }

  getAllObjects(): ReadonlyArray<ObjectHandle> {
    return this.canvas.getObjects().map((o) => this.makeObjectHandle(o));
  }

  setActiveSelection(handles: ReadonlyArray<ObjectHandle>): void {
    const objs = handles.map((h) => (h as InternalHandle)._obj);
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
      left: x,
      top: y,
      fontFamily: props.fontFamily,
      fontSize: props.fontSize,
      fontWeight: props.fontWeight,
      fontStyle: props.fontStyle,
      fill: props.fill,
      selectable: true,
      evented: true,
    });
    this.canvas.add(it);
    this.canvas.setActiveObject(it);
    it.enterEditing();
    focusITextTextarea(it);
  }

  pushCommand(cmd: Command): void {
    this.history.push(cmd);
    logger.debug(`[history] push kind=${cmd.kind}`);
    this.bumpToken();
  }

  // ===== History 操作 =====

  undo(): void {
    const cmd = this.history.undo();
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
    const cmd = this.history.redo();
    if (!cmd) {
      logger.debug('[history] redo: nothing to redo');
      return;
    }
    logger.debug(`[history] redo kind=${cmd.kind}`);
    this.applyCommand(cmd);
    this.bumpToken();
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }
  canRedo(): boolean {
    return this.history.canRedo();
  }

  // ===== 永続化 (snapshot 境界変換) =====

  toSnapshot(): DocumentSnapshot {
    return {
      format: 'mojiplay',
      version: 1,
      canvas: this.canvas.toJSON(['data']),
    };
  }

  async applySnapshot(s: DocumentSnapshot): Promise<void> {
    this.canvas.clear();
    // canvas.loadFromJSON は内部で enlivenObjects を呼ぶため非同期。callback で resolve。
    await new Promise<void>((resolve) => this.canvas.loadFromJSON(s.canvas, () => resolve()));
    this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    this.canvas.requestRenderAll();
    // 注: data.objectId は信頼してそのまま採用 (再発行しない)。
    // 単一 window 前提。複数 window 同時 load を許す機能を入れる時は要検討。
    this.clearHistory();
  }

  commitActiveText(): void {
    // discardActiveObject は IText 編集中なら 'text:editing:exited' を発火させ、
    // private handleTextEditingExited が 1 文字ずつ fabric.Text に分割する。
    // それ以外なら無害な選択解除。
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  // ===== 高レベル副作用 (= 旧 app.ts business logic) =====

  applyPropsToSelection(props: SelectionProps): void {
    const active = this.canvas.getActiveObjects();
    if (!active.length) return;

    const cmds: Command[] = [];
    for (const obj of active) {
      const id = obj.data?.objectId;
      if (!id) continue;
      const before = this.captureObjectSnapshot(obj);
      obj.set(props as Partial<fabric.Object>);
      const after = this.captureObjectSnapshot(obj);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        cmds.push({ kind: 'objectChanged', objectId: id, before, after });
      }
    }
    this.canvas.requestRenderAll();

    if (cmds.length === 1) {
      this.pushCommand(cmds[0]);
      logger.debug('[history] push toolbar property change');
    } else if (cmds.length > 1) {
      this.pushCommand({ kind: 'compound', commands: cmds });
      logger.debug(`[history] push compound (toolbar) ${cmds.length} changes`);
    }
  }

  setMode(mode: Mode): void {
    this.currentMode = mode;
    const isSelectMode = mode === 'select-group' || mode === 'select-char';
    const isPenMode = mode === 'pen-add' || mode === 'pen-remove';
    this.canvas.selection = isSelectMode;
    this.canvas.defaultCursor = mode === 'text' ? 'text' : 'default';
    // 白矢印 (select-char) は Illustrator の Direct Selection 同様に標準アローを維持
    // (path 本体ホバーで move カーソルになると「十字」表示になり混乱する)。
    this.canvas.hoverCursor =
      mode === 'text' ? 'text' : mode === 'select-char' ? 'default' : 'move';

    this.canvas.forEachObject((o) => {
      o.selectable = isSelectMode;
      o.evented = isSelectMode;
    });

    this.clearOverlay();
    // ペンモードでは選択中パスを維持する (= IText 編集中の commit は別経路)。
    if (!isSelectMode && !isPenMode) this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  getCurrentMode(): Mode {
    return this.currentMode;
  }

  clearAll(): void {
    this.canvas.clear();
    this.canvas.backgroundColor = '';
    this.canvas.renderAll();
  }

  clearOverlay(): void {
    const ctx = getContextTop(this.canvas);
    if (ctx) this.canvas.clearContext(ctx);
  }

  // ===== dirty tracking =====

  getHistoryToken(): number {
    return this.tokenCounter;
  }

  onMutate(cb: () => void): () => void {
    this.mutationListeners.push(cb);
    return () => {
      this.mutationListeners = this.mutationListeners.filter((c) => c !== cb);
    };
  }

  clearHistory(): void {
    this.history.clear();
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
      const id = obj.data?.objectId;
      if (id) {
        cmds.push({
          kind: 'objectDeleted',
          objectId: id,
          before: this.captureObjectSnapshot(obj),
        });
      }
    }

    selected.forEach((obj) => this.canvas.remove(obj));
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
      const snapshot = orig.toObject(['data']) as ObjectSnapshot;
      const origData = snapshot.data;
      const type = snapshot.type as string;
      const objType: 'text' | 'path' = origData.type ?? (type === 'path' ? 'path' : 'text');

      // groupId 再マップ (同じ元 groupId なら同じ新 groupId を共有)
      const oldGid = origData.groupId;
      let newGid: string | undefined;
      if (oldGid) {
        let mapped = groupIdRemap.get(oldGid);
        if (!mapped) {
          mapped = generateGroupId();
          groupIdRemap.set(oldGid, mapped);
        }
        newGid = mapped;
      }

      let cloned: fabric.Object;
      if (type === 'path') {
        const { path: pathData, type: _t, data: _d, ...opts } = snapshot;
        cloned = new fabric.Path(
          pathData as unknown as fabric.Point[],
          opts as fabric.IPathOptions,
        );
      } else if (type === 'text' || type === 'i-text') {
        const { text: textValue, type: _t, data: _d, ...opts } = snapshot;
        cloned = new fabric.Text(textValue as string, opts as fabric.TextOptions);
      } else {
        logger.warn(`[duplicate] skipping unknown type: ${type}`);
        continue;
      }

      cloned.set({
        left: (cloned.left ?? 0) + offset.x,
        top: (cloned.top ?? 0) + offset.y,
      });

      // data: 新 objectId は ensureObjectId で発行、groupId は再マップ後の値、
      // sourceText / charIndex / outlined 等の custom field は origData から保持。
      cloned.data = {
        ...origData,
        objectId: undefined,
        groupId: newGid,
      };
      const newId = ensureObjectId(cloned, objType);

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
    succeeded: number;
    failedChars: string;
    failedFamilies: ReadonlyArray<string>;
  }> {
    const isOutlineable = (obj: fabric.Object): boolean => {
      if (obj.data?.outlined) return false;
      const t = obj as fabric.Object & Partial<fabric.Text>;
      return typeof t.text === 'string' && typeof t.fontFamily === 'string';
    };
    const targets = this.canvas.getActiveObjects().filter(isOutlineable) as fabric.Text[];
    if (targets.length === 0) {
      return { succeeded: 0, failedChars: '', failedFamilies: [] };
    }

    // ActiveSelection 解除で子の座標を世界座標に戻す (outlineTextToPath は世界座標前提)
    this.canvas.discardActiveObject();

    const conversions = await Promise.all(
      targets.map(async (ft) => ({ ft, path: await outlineTextToPath(ft) })),
    );

    const succeeded = conversions.filter((x) => x.path) as Array<{
      ft: fabric.Text;
      path: fabric.Path;
    }>;
    const failed = conversions.filter((x) => !x.path);
    const failedChars = failed.map((x) => x.ft.text || '').join('');
    const failedFamilies = Array.from(new Set(failed.map((x) => x.ft.fontFamily || '?')));

    if (succeeded.length === 0) {
      return { succeeded: 0, failedChars, failedFamilies };
    }

    const vt = this.canvas.viewportTransform;
    logger.debug(
      `[outline] outlineActiveTexts: succeeded=${succeeded.length}` +
        ` viewportTransform=[${vt?.map((n) => n.toFixed(3)).join(',')}]` +
        ` zoom=${this.canvas.getZoom()}`,
    );

    const outlineCommands: Command[] = [];
    for (const { ft, path } of succeeded) {
      const ftId = ft.data?.objectId;
      const pathId = path.data?.objectId;
      if (ftId)
        outlineCommands.push({
          kind: 'objectDeleted',
          objectId: ftId,
          before: this.captureObjectSnapshot(ft),
        });
      this.canvas.remove(ft);
      this.canvas.add(path);
      if (pathId)
        outlineCommands.push({
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

  exportActiveAsPngDataUrl(
    multiplier: number,
  ): { dataUrl: string; width: number; height: number } | null {
    const active = this.canvas.getActiveObject();
    if (!active) return null;
    logger.debug(`[copy] export active=${fmtObj(active)} multiplier=${multiplier}`);
    return exportObjectToPngDataUrl(active, multiplier);
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
    return this.history.linearize();
  }

  // ============================================================
  // 以下 private
  // ============================================================

  // ----- dirty tracking -----

  private bumpToken(): void {
    this.tokenCounter++;
    this.mutationListeners.forEach((cb) => cb());
  }

  // ----- ObjectSnapshot 境界変換 -----

  private resolveObjectById(id: ObjectId): fabric.Object | null {
    return this.canvas.getObjects().find((o) => o.data?.objectId === id) ?? null;
  }

  private writeSnapshotToCanvas(snapshot: ObjectSnapshot): void {
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

  private createObjectOnCanvas(snapshot: ObjectSnapshot): fabric.Object {
    const type = snapshot.type as string;
    let obj: fabric.Object;

    if (type === 'path') {
      const { path: pathData, type: _t, ...opts } = snapshot;
      obj = new fabric.Path(pathData as unknown as fabric.Point[], opts as fabric.IPathOptions);
    } else if (type === 'text' || type === 'i-text') {
      const { text: textValue, type: _t, ...opts } = snapshot;
      obj = new fabric.Text(textValue as string, opts as fabric.TextOptions);
    } else {
      throw new Error(`Unknown object type for createObjectOnCanvas: ${type}`);
    }

    if (!obj.data || !obj.data.objectId) {
      obj.data = { ...snapshot.data };
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
    const oldPOSrc = getPathOffset(p);
    const oldPO = { x: oldPOSrc.x, y: oldPOSrc.y };
    recomputePathDimensions(p, { left: p.left, top: p.top });
    const newPO = getPathOffset(p);
    const dxLocal = oldPO.x - newPO.x;
    const dyLocal = oldPO.y - newPO.y;
    const sx = (p.scaleX as number) ?? 1;
    const sy = (p.scaleY as number) ?? 1;
    const rad = (((p.angle as number) ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    p.left = (p.left ?? 0) + dxLocal * sx * cos - dyLocal * sy * sin;
    p.top = (p.top ?? 0) + dxLocal * sx * sin + dyLocal * sy * cos;
    p.setCoords();
    this.canvas.fire('object:modified', { target: p });
  }

  private makePathHandle(p: fabric.Path): PathHandle {
    const pp = p as unknown as { path: PathCommandArray };
    return {
      snapshot: (): PathSnapshot => {
        const po = getPathOffset(p);
        return {
          path: new Path(fromFabricPath(pp.path)),
          pathMatrix: p.calcTransformMatrix() as unknown as Mat2x3,
          pathOffset: { x: po.x, y: po.y },
        };
      },
      setPath: (path: Path) => {
        pp.path = toFabricPath(path.commands) as PathCommandArray;
        markPathDirty(p);
      },
      finalizeEdit: () => this.finalizeDrag(p),
      getId: () => p.data!.objectId!,
      captureForHistory: () => p.toObject(['data']) as ObjectSnapshot,
    };
  }

  private makeObjectHandle(o: fabric.Object): InternalHandle {
    let h = this.objectHandleCache.get(o);
    if (!h) {
      h = {
        getGroupId: () => o.data?.groupId,
        _obj: o,
      };
      this.objectHandleCache.set(o, h);
    }
    return h;
  }

  private getActiveOutlinedPath(): fabric.Path | null {
    const obj = this.canvas.getActiveObject();
    if (!obj || obj.type !== 'path') return null;
    if (!obj.data?.outlined) return null;
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
        cmd.commands.forEach((c) => this.applyCommand(c));
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
        [...cmd.commands].reverse().forEach((c) => this.revertCommand(c));
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
    const objs: fabric.Object[] =
      target.type === 'activeSelection'
        ? (target as fabric.ActiveSelection).getObjects()
        : [target];
    for (const o of objs) {
      const id = o.data?.objectId;
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
        ` data.groupId=${o.data?.groupId ?? '-'}` +
        ` action=${e.action ?? '-'}` +
        ` vt=[${vt?.map((n: number) => n.toFixed(3)).join(',')}]`,
    );

    const action = e.action;
    if (!action) return; // tool-driven な finalizeDrag からの fire は skip

    const objs: fabric.Object[] =
      o.type === 'activeSelection' ? (o as fabric.ActiveSelection).getObjects() : [o];

    const cmds: Command[] = [];
    for (const obj of objs) {
      const id = obj.data?.objectId;
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

  /**
   * IText 編集終了 (Enter / Esc / クリックアウェイ) で発火。
   * IText を 1 文字ずつの fabric.Text に分割し、N×objectCreated を 1 個の
   * compound Command として push する。詳細は CLAUDE.md「文字モデル」参照。
   *
   * 位置計算は IText の内部計測 (__charBounds) をそのまま流用する。__charBounds は
   * pair-wise なカーニング (例: "AV" / "To") を反映しているので、編集中の見た目と
   * ピクセル一致する。initDimensions() で populated を保証してから読む。
   */
  private readonly handleTextEditingExited = (e: fabric.IEvent): void => {
    const it = e.target as fabric.IText | undefined;
    if (!it) return;
    // 二重呼び出し防止 (Enter keydown → exitEditing → text:editing:exited の流れ)
    if (!this.canvas.contains(it)) return;

    const text = it.text || '';
    if (!text.trim()) {
      this.canvas.remove(it);
      this.canvas.requestRenderAll();
      return;
    }

    const groupId = generateGroupId();
    const fontFamily = it.fontFamily || 'Arial';
    const fontSize = (it.fontSize as number) || 72;
    const fontWeight = (it.fontWeight as number | string) ?? 400;
    const fontStyle: 'normal' | 'italic' | 'oblique' =
      (it.fontStyle as 'normal' | 'italic' | 'oblique') || 'normal';
    const fill = (it.fill as string) || '#000000';
    const startX = (it.left as number) || 0;
    const startY = (it.top as number) || 0;

    initITextDimensions(it);
    const lines = getITextLines(it);
    const bounds = getITextCharBounds(it);
    const lineHeightPx = fontSize * ((it.lineHeight as number) || 1.16);

    const newSelectable = this.currentMode !== 'text';

    let charIndex = 0;
    const createdCommands: Command[] = [];

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (let ci = 0; ci < line.length; ci++) {
        const char = line[ci];
        // 空白は fabric.Text を生成しない (既存挙動踏襲)。bounds[li][ci].left は
        // 空白を含んだ座標なので、スキップしても次文字の left はズレない。
        if (char === ' ') {
          charIndex++;
          continue;
        }

        const obj = new fabric.Text(char, {
          left: startX + bounds[li][ci].left,
          top: startY + li * lineHeightPx,
          fontFamily,
          fontSize,
          fontWeight,
          fontStyle,
          fill,
          selectable: newSelectable,
          evented: newSelectable,
          hasControls: true,
          hasBorders: true,
          data: { groupId, charIndex, sourceText: text },
        });
        const objectId = ensureObjectId(obj, 'text');

        this.canvas.add(obj);
        createdCommands.push({
          kind: 'objectCreated',
          objectId,
          after: this.captureObjectSnapshot(obj),
        });
        charIndex++;
      }
    }

    this.canvas.remove(it);
    this.canvas.requestRenderAll();

    if (createdCommands.length === 1) {
      this.pushCommand(createdCommands[0]);
    } else if (createdCommands.length > 1) {
      this.pushCommand({ kind: 'compound', commands: createdCommands });
    }
    if (createdCommands.length > 0) {
      logger.debug(`[history] push commitIText: ${createdCommands.length} chars`);
    }

    const vt = this.canvas.viewportTransform;
    logger.debug(
      `[commitIText] created ${charIndex} chars for groupId=${groupId}` +
        ` startX=${startX} startY=${startY}` +
        ` vt=[${vt?.map((n) => n.toFixed(3)).join(',')}] zoom=${this.canvas.getZoom()}`,
    );
  };
}
