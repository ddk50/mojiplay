// renderer/state.ts — fabric.Canvas を encapsulate した State モジュール。
//
// CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」の State 層を
// 一つのモジュールに集約。fabric への結合を 1 ファイルに閉じ込め、外部 (Tool / app.ts /
// menu) には ToolHost interface + History API + 永続化 API を提供する。
//
// 集約された旧コード:
//   - app.ts の FabricToolHost (匿名 ToolHost 実装)
//   - app.ts の makeFabricObjectHandle + キャッシュ
//   - app.ts の transformBeforeSnapshots Map + mouse:down/object:modified hook
//   - app.ts の handleUndo / handleRedo
//   - fabric-path-handle.ts (makeFabricPathHandle / finalizeDrag)
//   - snapshot.ts (capture / write / create / remove / resolve)
//   - history-adapter.ts (applyCommand / revertCommand)
//
// fabric の癖 (path 配列の直接代入 / _setPositionDimensions / pathOffset 補正 /
// ActiveSelection の座標系) はすべてこの中に閉じ込められている。

import type { ObjectId } from '../core/object-id';
import type { Command, ObjectSnapshot, HistoryStack } from '../core/history/types';
import { createHistoryStack } from '../core/history/stack';
import type {
  ObjectHandle, PathHandle, PathSnapshot, TextCreateProps, ToolHost,
} from '../core/tools/tool-interface';
import type { Mat2x3 } from '../core/path/coords';
import type { PathCommand } from '../core/path/types';
import { fromFabricPath, toFabricPath } from '../core/path/fabric-adapter';
import { logger, fmtObj } from './logger';

export interface State extends ToolHost {
  // History 操作 (= app.ts の Cmd+Z handler が呼ぶ)
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // 永続化 (将来用、現状 stub)
  serialize(): unknown;
  loadSerialized(data: unknown): void;

  // 高レベル UI handler 用ヘルパ。state を経由しない直接 canvas 操作 (commitIText /
  // outlineSelection / menuDeleteSelection / applyToSelection 等) で使用。
  // 「state が完全に encapsulate」ではなく「foundational ops は state、高レベル
  // orchestration は app.ts」という現状の分担に対する妥協。将来高レベルハンドラも
  // state 内部に取り込めばこの公開は不要になる。
  captureObjectSnapshot(obj: fabric.Object): ObjectSnapshot;

  // debug / 検査用
  linearizeHistory(): ReadonlyArray<Command>;
}

export interface CreateStateOptions {
  /** History 上限。default 100 */
  historyMax?: number;
}

/**
 * fabric.Canvas を取り込む State を生成。
 *
 * 設計上 State は fabric を public に露出させない (= public method の戻り値型に
 * fabric.* が現れない)。例外は ToolHost.getActivePath() の PathHandle で、これは
 * abstract interface なので fabric.Path 自体は隠蔽されている。
 */
export function createState(
  canvas: fabric.Canvas,
  options: CreateStateOptions = {},
): State {
  const historyStack: HistoryStack = createHistoryStack({ max: options.historyMax ?? 100 });

  // ───── ObjectHandle キャッシュ ─────
  // 同じ fabric.Object に対しては常に同じ handle instance を返す (canonical 化)。
  // SelectGroupTool は alreadyExpanded 判定で identity (===) を使うため、
  // 毎回別 instance を返すと「展開済み」を検出できず無限再帰する。
  // WeakMap で fabric.Object が GC されると自動で抜けるのでメモリリークも無い。
  const objectHandleCache = new WeakMap<fabric.Object, ObjectHandle & { _obj: fabric.Object }>();
  function makeObjectHandle(o: fabric.Object): ObjectHandle & { _obj: fabric.Object } {
    let h = objectHandleCache.get(o);
    if (!h) {
      h = {
        getGroupId: () => (o as any).data?.groupId,
        _obj: o,
      };
      objectHandleCache.set(o, h);
    }
    return h;
  }

  // ───── ObjectSnapshot 境界変換 ─────

  function resolveObjectById(id: ObjectId): fabric.Object | null {
    return canvas.getObjects().find(o => (o as any).data?.objectId === id) ?? null;
  }

  function captureObjectSnapshot(obj: fabric.Object): ObjectSnapshot {
    return obj.toObject(['data']) as ObjectSnapshot;
  }

  function writeSnapshotToCanvas(snapshot: ObjectSnapshot): void {
    const id = snapshot.data.objectId;
    const obj = resolveObjectById(id);
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

  function createObjectOnCanvas(snapshot: ObjectSnapshot): fabric.Object {
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

    canvas.add(obj);
    return obj;
  }

  function removeObjectFromCanvas(id: ObjectId): void {
    const obj = resolveObjectById(id);
    if (obj) canvas.remove(obj);
  }

  // ───── PathHandle 実装 (fabric.Path → abstract interface) ─────

  function finalizeDrag(p: fabric.Path): void {
    // drag 中・drag 終了時に bbox 中心を視覚的に保つための pathOffset 補正。
    // 詳細は CLAUDE.md「Tool-driven vs fabric-driven の区別」参照。
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
    canvas.fire('object:modified', { target: p } as any);
  }

  function makePathHandle(p: fabric.Path): PathHandle {
    return {
      snapshot(): PathSnapshot {
        return {
          commands:   fromFabricPath((p as any).path as ReadonlyArray<ReadonlyArray<unknown>>),
          pathMatrix: p.calcTransformMatrix() as unknown as Mat2x3,
          pathOffset: { x: (p as any).pathOffset.x, y: (p as any).pathOffset.y },
        };
      },
      setCommands(cmds: ReadonlyArray<PathCommand>): void {
        (p as any).path = toFabricPath(cmds);
        (p as any).dirty = true;
      },
      finalizeEdit(): void {
        finalizeDrag(p);
      },
      getId(): ObjectId {
        return (p as any).data?.objectId as ObjectId;
      },
      captureForHistory(): ObjectSnapshot {
        return p.toObject(['data']) as ObjectSnapshot;
      },
    };
  }

  function getActiveOutlinedPath(): fabric.Path | null {
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'path') return null;
    if (!(obj as any).data?.outlined) return null;
    return obj as fabric.Path;
  }

  // ───── Command apply / revert ─────

  function applyCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        writeSnapshotToCanvas(cmd.after);
        break;
      case 'objectCreated':
        createObjectOnCanvas(cmd.after);
        break;
      case 'objectDeleted':
        removeObjectFromCanvas(cmd.objectId);
        break;
      case 'compound':
        cmd.commands.forEach(c => applyCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    canvas.requestRenderAll();
  }

  function revertCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'objectChanged':
        writeSnapshotToCanvas(cmd.before);
        break;
      case 'objectCreated':
        removeObjectFromCanvas(cmd.objectId);
        break;
      case 'objectDeleted':
        createObjectOnCanvas(cmd.before);
        break;
      case 'compound':
        // 逆順で revert (= apply の逆順序で打ち消す)
        [...cmd.commands].reverse().forEach(c => revertCommand(c));
        break;
      default: {
        const _: never = cmd;
        return _;
      }
    }
    canvas.requestRenderAll();
  }

  // ───── fabric event hook (fabric-driven な transform を Command 化) ─────
  // CLAUDE.md「Tool-driven vs fabric-driven の区別」参照。
  // tool-driven な finalizeDrag からの fire は e.action が無いので skip する。

  const transformBeforeSnapshots = new Map<ObjectId, ObjectSnapshot>();

  canvas.on('mouse:down', (opt) => {
    const target = opt.target;
    if (!target) return;
    const objs: fabric.Object[] = target.type === 'activeSelection'
      ? (target as fabric.ActiveSelection).getObjects()
      : [target];
    for (const o of objs) {
      const id = (o as any).data?.objectId as ObjectId | undefined;
      if (id) transformBeforeSnapshots.set(id, captureObjectSnapshot(o));
    }
  });

  canvas.on('object:modified', (e: fabric.IEvent) => {
    const o = e.target as fabric.Object | undefined;
    if (!o) return;
    const vt = canvas.viewportTransform;
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
      const before = transformBeforeSnapshots.get(id);
      transformBeforeSnapshots.delete(id);
      if (!before) continue;
      const after = captureObjectSnapshot(obj);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        cmds.push({ kind: 'objectChanged', objectId: id, before, after });
      }
    }

    if (cmds.length === 1) {
      historyStack.push(cmds[0]);
      logger.debug(`[history] push objectChanged ${fmtObj(objs[0])} action=${action}`);
    } else if (cmds.length > 1) {
      historyStack.push({ kind: 'compound', commands: cmds });
      logger.debug(`[history] push compound ${cmds.length} changes action=${action}`);
    }
  });

  // upperCanvas は cursor 設定にだけ使う。constructor 引数でも良いが、canvas から
  // 取得できるので self-contain している。
  const upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;

  // ───── public API ─────

  return {
    // ===== ToolHost interface =====

    getActivePath(): PathHandle | null {
      const p = getActiveOutlinedPath();
      return p ? makePathHandle(p) : null;
    },

    getViewportMatrix(): Mat2x3 {
      return canvas.viewportTransform as unknown as Mat2x3;
    },

    requestRerender(): void {
      canvas.requestRenderAll();
    },

    setCursor(c: string): void {
      upperCanvas.style.cursor = c;
    },

    getActiveObjects(): ReadonlyArray<ObjectHandle> {
      const active = canvas.getActiveObject();
      if (!active) return [];
      const objs: fabric.Object[] = active.type === 'activeSelection'
        ? (active as fabric.ActiveSelection).getObjects()
        : [active];
      return objs.map(makeObjectHandle);
    },

    getAllObjects(): ReadonlyArray<ObjectHandle> {
      return canvas.getObjects().map(makeObjectHandle);
    },

    setActiveSelection(handles: ReadonlyArray<ObjectHandle>): void {
      const objs = handles.map(h => (h as any)._obj as fabric.Object);
      canvas.discardActiveObject();
      if (objs.length === 1) {
        canvas.setActiveObject(objs[0]);
      } else if (objs.length > 1) {
        const sel = new fabric.ActiveSelection(objs, { canvas });
        canvas.setActiveObject(sel);
      }
      canvas.requestRenderAll();
    },

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
      canvas.add(it);
      canvas.setActiveObject(it);
      it.enterEditing();
      (it as any).hiddenTextarea?.focus();
    },

    pushCommand(cmd: Command): void {
      historyStack.push(cmd);
      logger.debug(`[history] push kind=${cmd.kind}`);
    },

    // ===== History 操作 =====

    undo(): void {
      const cmd = historyStack.undo();
      if (!cmd) {
        logger.debug('[history] undo: nothing to undo');
        return;
      }
      logger.debug(`[history] undo kind=${cmd.kind}`);
      revertCommand(cmd);
      // Phase A 規約: undo は selection を能動的に変更しない (camera 層は履歴対象外)
    },

    redo(): void {
      const cmd = historyStack.redo();
      if (!cmd) {
        logger.debug('[history] redo: nothing to redo');
        return;
      }
      logger.debug(`[history] redo kind=${cmd.kind}`);
      applyCommand(cmd);
    },

    canUndo(): boolean { return historyStack.canUndo(); },
    canRedo(): boolean { return historyStack.canRedo(); },

    // ===== 永続化 (stub。実装は後日) =====

    serialize(): unknown {
      // TODO: バージョニング / format 確定。今は generic JSON 化のみ。
      return { version: 1, objects: canvas.toJSON(['data']) };
    },

    loadSerialized(data: unknown): void {
      // TODO: 実装。schema 検証 / canvas.loadFromJSON / viewport reset / history.clear。
      // 永続化機能を実装するときに本実装する。
      throw new Error('loadSerialized: not yet implemented');
    },

    // ===== 高レベル handler 用ヘルパ =====

    captureObjectSnapshot(obj: fabric.Object): ObjectSnapshot {
      return captureObjectSnapshot(obj);
    },

    // ===== debug =====

    linearizeHistory(): ReadonlyArray<Command> {
      return historyStack.linearize();
    },
  };
}
