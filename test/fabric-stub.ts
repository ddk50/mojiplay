// fabric.js の minimal stub。real `class State` (renderer/state.ts) を unit test する
// ために fabric.Canvas / fabric.ActiveSelection / fabric.Path / fabric.Text /
// fabric.IText / fabric.Polyline.prototype._setPositionDimensions の最小 surface だけ
// 模擬する。
//
// 設計方針:
//   - ここで mock するのは外部依存 (fabric) のみ。State 本体は real を使う。
//     FakeState を作って State の振る舞いを別実装してしまうと、real State の
//     canonicalization (WeakMap) や setActiveSelection / applySnapshot / pushCommand
//     の経路が一切検証されない tautology になる。
//   - test 側からはこの stub を「fabric の代用」として扱い、振る舞いの assert は
//     必ず real State の API (state.getActiveObjects() / state.toSnapshot() /
//     state.canUndo() 等) を経由する。stub の internal counter / 内部 field を peek
//     することは原則しない。例外は 2 つ:
//       1. cursor (= 実 DOM の側面なので fake DOM stand-in 経由で観測する:
//          `fabricCanvas.upperCanvasEl.style.cursor`)
//       2. 選択枠 affordance (hasControls / hasBorders / borderColor /
//          lockScalingFlip)。fabric が描画・操作可否に使う observable surface で
//          あり State API には露出しないため、canvas.getObjects() 等で取った
//          オブジェクトのプロパティを直接 assert してよい。
//   - 必要最小の surface だけ実装。state が新しい fabric API を呼ぶようになったら
//     ここに足す。production の fabric を完全模写するつもりはない。
//   - install は import の副作用にせず明示的な関数にする。test 側で「fabric stub を
//     使う」が読み取りやすい。
//
// 使い方:
//   installFabricStub();                       // ← test 冒頭で 1 回
//   const fabricCanvas = new FakeFabricCanvas();
//   const state = new State(fabricCanvas as never);
//   await state.applySnapshot({ format: 'mojiplay', version: 1, canvas: { objects: [...] } });
//   ...

// ── Path ──────────────────────────────────────────────────────────────────
//
// fabric.Path の最小 surface。state が触る field/method:
//   - .path        — 生タプル列 (['M', x, y] 等)。直接代入される
//   - .left / .top / .scaleX / .scaleY / .angle / .fill / .pathOffset / .data
//   - .dirty       — 直接代入される
//   - .set({...})
//   - .setCoords()
//   - .calcTransformMatrix()  — Mat2x3 を返す
//   - .toObject(['data'])     — snapshot を返す
//
// test では transform 無し (left=0, top=0, scaleX=1, scaleY=1, angle=0) の path を
// 扱うので calcTransformMatrix は identity 固定。pathOffset 補正経路は通るが
// _setPositionDimensions が no-op なので新旧 pathOffset が一致 → 補正 0 → 結果として
// commands 更新だけが反映される。
class FakeFabricPath {
  readonly type = 'path';
  path: ReadonlyArray<ReadonlyArray<unknown>>;
  left = 0;
  top = 0;
  scaleX = 1;
  scaleY = 1;
  angle = 0;
  fill: string | undefined;
  pathOffset: { x: number; y: number } = { x: 0, y: 0 };
  width = 0;
  height = 0;
  dirty = false;
  data: { [k: string]: unknown } = {};
  // 選択枠 affordance (default は production fabric と同値)
  hasControls = true;
  hasBorders = true;
  borderColor: string | undefined;
  lockScalingFlip = false;

  constructor(rawPath: ReadonlyArray<ReadonlyArray<unknown>>, opts: Record<string, unknown> = {}) {
    this.path = Array.isArray(rawPath) ? rawPath.slice() : [];
    Object.assign(this, opts);
  }
  set(props: Record<string, unknown>): this {
    Object.assign(this, props);
    return this;
  }
  setCoords(): void {
    /* no-op */
  }
  calcTransformMatrix(): readonly number[] {
    return [1, 0, 0, 1, 0, 0];
  }
  // constructFabricPathFromSpec の debug dump が呼ぶ。test では値を検証しない。
  getBoundingRect(
    _absolute?: boolean,
    _calculate?: boolean,
  ): { left: number; top: number; width: number; height: number } {
    return { left: this.left, top: this.top, width: this.width, height: this.height };
  }
  toObject(_keys: ReadonlyArray<string> = []): Record<string, unknown> {
    return {
      type: this.type,
      path: deepCopyRawPath(this.path),
      left: this.left,
      top: this.top,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      angle: this.angle,
      fill: this.fill,
      data: { ...this.data },
    };
  }
}

function deepCopyRawPath(p: ReadonlyArray<ReadonlyArray<unknown>>): unknown[][] {
  return p.map((c) => (Array.isArray(c) ? c.slice() : [c]));
}

// ── Text ──────────────────────────────────────────────────────────────────
class FakeFabricText {
  readonly type: 'text' | 'i-text' = 'text';
  text: string;
  left = 0;
  top = 0;
  scaleX = 1;
  scaleY = 1;
  angle = 0;
  fill: string | undefined;
  fontFamily: string | undefined;
  fontSize: number | undefined;
  fontWeight: number | string | undefined;
  fontStyle: string | undefined;
  data: { [k: string]: unknown } = {};
  // 選択枠 affordance (default は production fabric と同値)
  hasControls = true;
  hasBorders = true;
  borderColor: string | undefined;
  lockScalingFlip = false;

  constructor(text: string, opts: Record<string, unknown> = {}) {
    this.text = text;
    Object.assign(this, opts);
  }
  set(props: Record<string, unknown>): this {
    Object.assign(this, props);
    return this;
  }
  setCoords(): void {
    /* no-op */
  }
  toObject(_keys: ReadonlyArray<string> = []): Record<string, unknown> {
    return {
      type: this.type,
      text: this.text,
      left: this.left,
      top: this.top,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      angle: this.angle,
      fill: this.fill,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      data: { ...this.data },
    };
  }
}

class FakeFabricIText extends FakeFabricText {
  override readonly type = 'i-text';
  isEditing = false;
  // State.handleTextEditingExited は __charBounds / _textLines / lineHeight を読む。
  // production fabric は initDimensions() で populate するが、stub では test 側が
  // 直接セットすることもできる (= 編集後の commit splitting を simulate)。
  __charBounds: Array<Array<{ left: number; width: number }>> = [];
  _textLines: string[][] = [];
  lineHeight = 1.16;
  enterEditing(): void {
    this.isEditing = true;
  }
  exitEditing(): void {
    this.isEditing = false;
  }
  initDimensions(): void {
    /* no-op (test 側で事前 populate) */
  }
}

// ── ActiveSelection ──────────────────────────────────────────────────────
class FakeActiveSelection {
  readonly type = 'activeSelection';
  data?: { [k: string]: unknown };
  private readonly _objects: FabricObjectLike[];
  constructor(objs: ReadonlyArray<FabricObjectLike>, _opts: { canvas: FakeFabricCanvas }) {
    this._objects = objs.slice();
  }
  getObjects(): FabricObjectLike[] {
    return this._objects.slice();
  }
}

// ── Polyline.prototype._setPositionDimensions ────────────────────────────
//
// state.finalizeDrag / writeSnapshotToCanvas が `(fabric.Polyline.prototype as any)
// ._setPositionDimensions.call(p, {left, top})` で呼ぶ。production 実装は path から
// bbox を計算して width/height/pathOffset を更新するが、test では識別変換 (transform 無し)
// の path しか扱わないので no-op で十分。pathOffset を変えなければ補正 delta が 0 で
// commands 更新だけが path に反映される。
const fakePolylinePrototype = {
  _setPositionDimensions(this: FakeFabricPath, _opts: { left: number; top: number }): void {
    /* no-op */
  },
};

// ── Canvas ────────────────────────────────────────────────────────────────

type FabricObjectLike =
  | FakeFabricPath
  | FakeFabricText
  | FakeFabricIText
  | { type: string; data?: { [k: string]: unknown }; [k: string]: unknown };

type CanvasActive = FabricObjectLike | FakeActiveSelection | null;

export class FakeFabricCanvas {
  private _objects: FabricObjectLike[] = [];
  private _active: CanvasActive = null;
  private readonly _listeners = new Map<string, Array<(e: unknown) => void>>();

  // State constructor / setCursor が触る (実 DOM 側面)
  upperCanvasEl: { style: { cursor: string } } = { style: { cursor: '' } };
  viewportTransform: number[] = [1, 0, 0, 1, 0, 0];

  // State.setMode が assign する canvas-level fields
  selection = true;
  defaultCursor = 'default';
  hoverCursor = 'move';
  backgroundColor: string | undefined = undefined;

  add(o: FabricObjectLike): void {
    this._objects.push(o);
    // production fabric は canvas.add / loadFromJSON の両方で _onObjectAdded を通り
    // 'object:added' を fire する。State の導出スタイル適用フックがこれに依存。
    this._fire('object:added', { target: o });
  }
  remove(o: FabricObjectLike): void {
    this._objects = this._objects.filter((x) => x !== o);
    if (this._active === o) this._active = null;
  }
  getObjects(): FabricObjectLike[] {
    return this._objects.slice();
  }
  forEachObject(cb: (o: FabricObjectLike) => void): void {
    this._objects.forEach(cb);
  }
  contains(o: FabricObjectLike): boolean {
    return this._objects.indexOf(o) >= 0;
  }

  getActiveObject(): CanvasActive {
    return this._active;
  }
  getActiveObjects(): FabricObjectLike[] {
    if (this._active === null) return [];
    if (this._active instanceof FakeActiveSelection) return this._active.getObjects();
    return [this._active];
  }

  setActiveObject(o: FabricObjectLike | FakeActiveSelection): void {
    const wasNull = this._active === null;
    this._active = o;
    this._fire(wasNull ? 'selection:created' : 'selection:updated', {
      selected: this.getActiveObjects(),
    });
  }

  discardActiveObject(): void {
    if (this._active === null) return;
    this._active = null;
    this._fire('selection:cleared', {});
  }

  // State.applySnapshot 経由の fixture 投入。production fabric の canvas.clear() /
  // loadFromJSON(json, cb) と同じ shape (cb は同期 invoke で OK、State 側で Promise wrap)。
  // type に応じて適切な constructor (Path / Text / IText) で wrap し、production と
  // 同じ method 表面 (.set / .toObject / .calcTransformMatrix 等) を持つ instance を
  // canvas に積む。fabric.util.enlivenObjects 相当。
  clear(): void {
    this._objects = [];
    this._active = null;
  }
  loadFromJSON(
    json: { objects?: ReadonlyArray<{ type: string; [k: string]: unknown }> },
    cb?: () => void,
  ): void {
    for (const o of json?.objects ?? []) {
      this.add(reviveObject(o));
    }
    cb?.();
  }

  // state.toSnapshot 経由で readback するため。
  toJSON(_keys?: ReadonlyArray<string>): { objects: unknown[] } {
    return {
      objects: this._objects.map((o) =>
        typeof (o as { toObject?: () => unknown }).toObject === 'function'
          ? (o as { toObject: () => unknown }).toObject()
          : { ...o },
      ),
    };
  }

  on(event: string, cb: (e: unknown) => void): void {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    arr.push(cb);
  }

  // state.finalizeDrag が canvas.fire('object:modified', { target: p }) を呼ぶ。
  fire(event: string, e: unknown): void {
    this._fire(event, e);
  }

  // 設計バグ (= tool / state event hook が無限再帰する) を test で観測しやすく
  // するため、event 発火が一定深さを超えたら例外を投げる。production fabric にこの
  // guard は無いが、暴走時に fabric の drag state が破壊される症状を unit test 層で
  // 先に検出するため。
  private _fireDepth = 0;
  private readonly _maxFireDepth = 50;
  private _fire(event: string, e: unknown): void {
    if (++this._fireDepth > this._maxFireDepth) {
      this._fireDepth = 0;
      throw new Error(
        `fabric stub: '${event}' event dispatch depth exceeded ${this._maxFireDepth}` +
          ` (likely infinite recursion in handler chain)`,
      );
    }
    try {
      this._listeners
        .get(event)
        ?.slice()
        .forEach((cb) => cb(e));
    } finally {
      this._fireDepth--;
    }
  }

  // State 経路で呼ばれるが test 結果に直接影響しない no-op 群
  requestRenderAll(): void {
    /* no-op */
  }
  renderAll(): void {
    /* no-op */
  }
  getZoom(): number {
    return this._zoom;
  }
  zoomToPoint(focal: { x: number; y: number }, zoom: number): void {
    this._zoom = zoom;
    this._lastZoomFocal = focal;
  }
  // test 側で readback するための field
  private _zoom = 1;
  private _lastZoomFocal: { x: number; y: number } | null = null;
  /** test 専用: 直近の zoomToPoint focal を peek。 */
  getLastZoomFocal(): { x: number; y: number } | null {
    return this._lastZoomFocal;
  }

  // State.exportCanvasAsPngDataUrl 経路で呼ばれる。test では中身を検証しないので
  // 固定の dataURL を返す (= 「呼ばれたかどうか」だけ test 側で観測可能にする)。
  toDataURL(_opts: {
    format?: string;
    multiplier?: number;
    enableRetinaScaling?: boolean;
  }): string {
    return 'data:image/png;base64,STUB';
  }
}

function reviveObject(o: { type: string; [k: string]: unknown }): FabricObjectLike {
  if (o.type === 'path') {
    const {
      type: _t,
      path,
      ...opts
    } = o as { type: string; path?: unknown[][]; [k: string]: unknown };
    return new FakeFabricPath((path ?? []) as unknown[][], opts as Record<string, unknown>);
  }
  if (o.type === 'i-text') {
    const { type: _t, text, ...opts } = o as { type: string; text?: string; [k: string]: unknown };
    return new FakeFabricIText((text ?? '') as string, opts as Record<string, unknown>);
  }
  if (o.type === 'text') {
    const { type: _t, text, ...opts } = o as { type: string; text?: string; [k: string]: unknown };
    return new FakeFabricText((text ?? '') as string, opts as Record<string, unknown>);
  }
  // 未知 type は plain copy で通す (ある程度の forward compat)
  return { ...o };
}

/**
 * `globalThis.fabric` に最小 constructor 群を install する。State の method を
 * 呼ぶ前に 1 回呼んでおく必要がある。
 *
 * 同時に `globalThis.window` の最小 stub を入れる: state.ts → logger.ts は
 * `window.electronAPI?.log?.debug(msg)` を呼ぶが、testEnvironment: 'node' では
 * `window` 自体が未定義で ReferenceError になるため。`electronAPI` は undefined で
 * 良い (optional chaining で吸われる)。
 */
export function installFabricStub(): void {
  (globalThis as { fabric?: unknown }).fabric = {
    ActiveSelection: FakeActiveSelection,
    Path: FakeFabricPath,
    Text: FakeFabricText,
    IText: FakeFabricIText,
    Polyline: { prototype: fakePolylinePrototype },
  };
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = {};
  }
}
