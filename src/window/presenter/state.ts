// renderer/state.ts — fabric.Canvas を encapsulate した State クラス (canvas Gateway)。
//
// CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」の State 層を
// 集約。外部 (Tool / app.ts / menu) には ToolHost interface + History API +
// 永続化 API を提供する。presenter/ 配下だが役割は Presenter (内→外の表示整形)
// ではなく canvas という device への Gateway (双方向の fabric 接触面)。
//
// 不透明 snapshot の canvas 読み書き (undo/redo の Command 適用・永続化) は
// CanvasPort (usecases/canvas-port-interface.ts) 経由 — 実装は
// presenter/fabric-canvas-port.ts。それ以外の fabric 癒着 (object 構築 /
// イベント正規化 / 選択操作) は当面このファイルに残り、DocumentInteractor
// 切り出し (Step 2 以降) で段階的に港へ寄せる。
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
import {
  outlineTextToPath,
  type OutlineTextProps,
  type OutlinedPathSpec,
} from '../usecases/outline-text-to-path';
import type { FontProvider } from '../usecases/font-provider-interface';
import type { DocumentInteractor } from '../usecases/document-interactor-interface';
import { DocumentInteractorImpl } from '../usecases/document-interactor';
import { FabricCanvasPort } from './fabric-canvas-port';
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
  // ドキュメントの抽象的内部表現 (History + dirty token + 永続化) の所有者。
  // fabric 不知の Use Case で、canvas への反映は CanvasPort 経由。
  // State は history 系 API をここへ委譲する facade。
  private readonly doc: DocumentInteractor;
  private readonly upperCanvas: HTMLCanvasElement;
  private readonly fontProvider: FontProvider;

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

  // 現在のツールモード。setMode で更新、commitActiveText の selectable 判定で参照。
  // Controller 側の Tool dispatch / button class 切替は依然 Controller の責務。
  private currentMode: Mode = 'select-group';

  constructor(canvas: fabric.Canvas, fontProvider: FontProvider, options: CreateStateOptions = {}) {
    this.canvas = canvas;
    // 暫定: port / interactor は State 内部で構築 (constructor signature を変えず
    // consumer / テストを無傷に保つ)。facade が痩せきったら Composition Root 注入へ。
    this.doc = new DocumentInteractorImpl({
      port: new FabricCanvasPort(canvas),
      historyMax: options.historyMax ?? 100,
    });
    this.upperCanvas = getUpperCanvasEl(canvas);
    this.fontProvider = fontProvider;

    // fabric event hook (mouse:down で before snapshot capture、object:modified で
    // fabric-driven な transform を Command 化して history に push、
    // text:editing:exited で IText を 1 文字ずつ fabric.Text に分割、
    // object:added で選択枠 affordance を導出適用)
    this.canvas.on('mouse:down', this.handleMouseDown);
    this.canvas.on('object:modified', this.handleObjectModified);
    this.canvas.on('text:editing:exited', this.handleTextEditingExited);
    this.canvas.on('object:added', this.handleObjectAdded);
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
    this.doc.pushCommand(cmd);
    logger.debug(`[history] push kind=${cmd.kind}`);
  }

  // ===== History 操作 (DocumentInteractor へ委譲、log だけ facade が担う) =====

  undo(): void {
    const cmd = this.doc.undo();
    if (!cmd) {
      logger.debug('[history] undo: nothing to undo');
      return;
    }
    logger.debug(`[history] undo kind=${cmd.kind}`);
  }

  redo(): void {
    const cmd = this.doc.redo();
    if (!cmd) {
      logger.debug('[history] redo: nothing to redo');
      return;
    }
    logger.debug(`[history] redo kind=${cmd.kind}`);
  }

  canUndo(): boolean {
    return this.doc.canUndo();
  }
  canRedo(): boolean {
    return this.doc.canRedo();
  }

  // ===== 永続化 (DocumentInteractor へ委譲) =====

  toSnapshot(): DocumentSnapshot {
    return this.doc.toSnapshot();
  }

  async applySnapshot(s: DocumentSnapshot): Promise<void> {
    await this.doc.applySnapshot(s);
    // fabric イベント正規化用の before-snapshot も document と一緒にリセット
    this.transformBeforeSnapshots.clear();
  }

  commitActiveText(): void {
    // discardActiveObject は IText 編集中なら 'text:editing:exited' を発火させ、
    // private handleTextEditingExited が 1 文字ずつ fabric.Text に分割する。
    // それ以外なら無害な選択解除。
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  isEditingText(): boolean {
    const active = this.canvas.getActiveObject();
    return active?.type === 'i-text' && (active as fabric.IText).isEditing === true;
  }

  exitTextEditing(): void {
    const active = this.canvas.getActiveObject();
    if (active?.type === 'i-text' && (active as fabric.IText).isEditing) {
      // → 'text:editing:exited' → handleTextEditingExited が文字分割 commit
      (active as fabric.IText).exitEditing();
    }
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
      // outlined path のハンドルはモード連動 (applyDerivedSelectionStyle と同じ規則)
      if (o.type === 'path' && o.data?.outlined) {
        o.hasControls = mode === 'select-group';
      }
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
    return this.doc.getHistoryToken();
  }

  onMutate(cb: () => void): () => void {
    return this.doc.onMutate(cb);
  }

  clearHistory(): void {
    this.doc.clearHistory();
    this.transformBeforeSnapshots.clear();
  }

  // ===== 高レベル selection 操作 (= 旧 actions/* の fabric 操作をここに閉じ込め) =====

  getZoom(): number {
    return this.canvas.getZoom() || 1;
  }

  zoomToPoint(zoom: number, focal: { x: number; y: number }): void {
    this.canvas.zoomToPoint(focal, zoom);
  }

  panBy(dx: number, dy: number): void {
    // relativePan 経由 (viewportTransform 直接変異は各 object の coords 再計算が
    // 走らず hit-test がずれる)
    this.canvas.relativePan(new fabric.Point(dx, dy));
    this.canvas.requestRenderAll();
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
      targets.map(async (ft) => {
        const props = extractOutlineTextProps(ft);
        const spec = await outlineTextToPath(props, this.fontProvider);
        return { ft, path: spec ? this.constructFabricPathFromSpec(spec) : null };
      }),
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

  /** OutlinedPathSpec から fabric.Path を構築 + ObjectId 発行 + debug log。
   *  outlineTextToPath use case が返す pure data spec を、framework 側 (fabric.Path
   *  + ensureObjectId) に橋渡しするのが State の責務。 */
  private constructFabricPathFromSpec(spec: OutlinedPathSpec): fabric.Path {
    const p = new fabric.Path(spec.pathData, {
      left: spec.left,
      top: spec.top,
      fill: spec.fill,
      angle: spec.angle,
      scaleX: spec.scaleX,
      scaleY: spec.scaleY,
      selectable: spec.selectable,
      evented: spec.evented,
    } as fabric.IPathOptions);
    p.data = { ...spec.data };
    ensureObjectId(p, 'path');

    // デバッグ: fabric が実際に保持している値をダンプ。
    const po = getPathOffset(p);
    const rect = p.getBoundingRect(true, true);
    logger.debug(
      `[outline] fabric.Path post-init: p.left=${p.left} p.top=${p.top}` +
        ` p.width=${p.width} p.height=${p.height}` +
        ` pathOffset=(${po?.x},${po?.y})` +
        ` boundingRect=(${rect.left.toFixed(2)},${rect.top.toFixed(2)},${rect.width.toFixed(2)},${rect.height.toFixed(2)})`,
    );
    return p;
  }

  exportActiveAsPngDataUrl(
    multiplier: number,
  ): { dataUrl: string; width: number; height: number } | null {
    const active = this.canvas.getActiveObject();
    if (!active) return null;
    logger.debug(`[copy] export active=${fmtObj(active)} multiplier=${multiplier}`);
    return exportObjectToPngDataUrl(active, multiplier);
  }

  exportCanvasAsPngDataUrl(multiplier: number): string {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    return this.canvas.toDataURL({
      format: 'png',
      multiplier,
      enableRetinaScaling: true,
    });
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
    return this.doc.linearizeHistory();
  }

  // ============================================================
  // 以下 private
  // ============================================================

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

  // ----- 選択枠 affordance の導出適用 -----

  private static readonly OUTLINED_BORDER_COLOR = '#f59e0b';

  /** fabric の object:added。全オブジェクト生成経路 (新規 / アウトライン化 /
   *  undo-redo 復元 / 複製 / loadFromJSON) がここに合流する。 */
  private readonly handleObjectAdded = (e: fabric.IEvent): void => {
    if (e.target) this.applyDerivedSelectionStyle(e.target);
  };

  /** 選択枠スタイル (borderColor / hasControls 等) は toObject snapshot に載らない
   *  ため、per-object に一度だけ設定すると複製 / undo-redo / 再ロードで剥がれる。
   *  data.outlined と現在モードから毎回導出して付け直す。 */
  private applyDerivedSelectionStyle(obj: fabric.Object): void {
    if (obj.type === 'path' && obj.data?.outlined) {
      obj.set({
        borderColor: State.OUTLINED_BORDER_COLOR,
        hasBorders: true,
        // ハンドルは select-group (変形) のみ。select-char / pen 系はアンカー編集と
        // コーナーハンドルの当たり判定が競合するため非表示 (setMode でも追従)。
        hasControls: this.currentMode === 'select-group',
        // 反転禁止: アンカー編集の確定処理 (finalizeDrag) と undo 復元が flip 未対応
        lockScalingFlip: true,
      });
    }
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

// fabric.Text → outlineTextToPath use case が要求する pure data props への抽出。
// renderer/ に住む (= fabric を知る) ことで、use case 側を fabric 不知に保てる。
function extractOutlineTextProps(ft: fabric.Text): OutlineTextProps {
  return {
    text: ft.text || '',
    left: ft.left ?? 0,
    top: ft.top ?? 0,
    fontFamily: ft.fontFamily || 'Arial',
    fontWeight: ft.fontWeight,
    fontStyle: ft.fontStyle,
    fontSize: (ft.fontSize as number) || 72,
    fill: ft.fill as string | undefined,
    angle: ft.angle ?? 0,
    scaleX: (ft.scaleX as number) ?? 1,
    scaleY: (ft.scaleY as number) ?? 1,
    selectable: ft.selectable,
    evented: ft.evented,
    data: ft.data,
  };
}
