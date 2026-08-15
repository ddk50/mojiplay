// CanvasInputController の Impl。
//
// canvas 上の入力 (DOM pointer / fabric event) を Tool に dispatch する Input Adapter。
// 旧 app.ts に散在していた DOM mousedown / mousemove / fabric mouse:* 配線をここに
// 集約。Tool への dispatch、PointerInput 中立化、object:modified の e.action 判別
// (二重 push 回避) はすべてこの 1 クラスに閉じる。
//
// 内→外 (toolbar 同期 / anchor overlay 描画) はここには無い — ToolbarPresenter /
// AnchorOverlayPresenter が fabric イベントを自分で購読する (Presenter self-wiring)。
// この Controller は入力 (外→内) 専任。
//
// 設計判断:
//   - public な on* メソッドが Controller の真の contract (= 「この Controller が
//     扱う event 一覧」)。Interface は ./canvas-input-controller-interface.ts。
//   - attach() / detach() は self-wiring の convenience (= addEventListener / off の
//     boilerplate を Controller が代行するだけ)。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { CanvasInputController, CanvasInputControllerDeps } from './canvas-input-interface';
import { buildPointerInput } from '../presenter/canvas-coords';
import { getUpperCanvasEl } from '../presenter/fabric-internals';
import { zoomCanvasByWheel } from '../presenter/zoom-canvas-by-wheel';

export class CanvasInputControllerImpl implements CanvasInputController {
  private readonly state: State;
  private readonly tools: Record<Mode, Tool>;
  private readonly selectCharTool: SelectCharTool;
  private readonly canvas: fabric.Canvas;
  private readonly upperCanvas: HTMLCanvasElement;
  private readonly onZoomChanged: () => void;

  constructor(deps: CanvasInputControllerDeps) {
    this.state = deps.state;
    this.tools = deps.tools;
    this.selectCharTool = deps.selectCharTool;
    this.canvas = deps.canvas;
    this.upperCanvas = getUpperCanvasEl(deps.canvas);
    this.onZoomChanged = deps.onZoomChanged;
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  /**
   * upperCanvas の DOM mousedown (capture phase 想定)。
   * 現ツールが 'consumed' を返したら fabric 伝播を抑止し、document-level
   * mousemove/mouseup でドラッグ追跡する。
   */
  readonly onUpperCanvasMouseDown = (e: MouseEvent): void => {
    const tool = this.tools[this.state.getCurrentMode()];
    const result = tool.onPointerDown(
      buildPointerInput(e, this.canvas, this.upperCanvas),
      this.state,
    );
    if (result !== 'consumed') return;

    e.stopImmediatePropagation();
    e.preventDefault();

    const onMove = (me: MouseEvent): void => {
      tool.onPointerMove(buildPointerInput(me, this.canvas, this.upperCanvas), this.state);
    };
    const onUp = (me: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      tool.onPointerUp(buildPointerInput(me, this.canvas, this.upperCanvas), this.state);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /** upperCanvas の DOM mousemove (idle hover、ドラッグ中はツール側で skip)。 */
  readonly onUpperCanvasMouseMove = (e: MouseEvent): void => {
    const tool = this.tools[this.state.getCurrentMode()];
    if (tool.isDragging()) return;
    tool.onPointerMove(buildPointerInput(e, this.canvas, this.upperCanvas), this.state);
  };

  /** fabric の mouse:down (fabric の hit-test 後)。TextTool が空き領域クリックで使う。 */
  readonly onCanvasMouseDown = (opt: fabric.IEvent): void => {
    const w = this.canvas.getPointer(opt.e as MouseEvent);
    this.tools[this.state.getCurrentMode()].onCanvasMouseDown(
      {
        worldX: w.x,
        worldY: w.y,
        hasTarget: !!opt.target,
      },
      this.state,
    );
  };

  /** Alt + ホイールで zoom (Photoshop 流、カーソル位置中心)。 */
  readonly onCanvasMouseWheel = (e: fabric.IEvent): void => {
    const evt = e.e as WheelEvent;
    if (!evt.altKey) return;
    zoomCanvasByWheel(
      this.state,
      evt.deltaY,
      { x: evt.offsetX, y: evt.offsetY },
      this.onZoomChanged,
    );
    evt.preventDefault();
    evt.stopPropagation();
  };

  /** fabric の object:moving。MovingTarget 抽象に橋渡しして現ツールに転送する。 */
  readonly onObjectMoving = (e: fabric.IEvent): void => {
    const target = e.target;
    if (!target) return;
    const mouseEvt = e.e as MouseEvent | undefined;

    this.tools[this.state.getCurrentMode()].onObjectMoving(
      {
        getLeft: () => target.left ?? 0,
        getTop: () => target.top ?? 0,
        setLeft: (v: number) => target.set({ left: v }),
        setTop: (v: number) => target.set({ top: v }),
      },
      { altKey: !!mouseEvt?.altKey },
      this.state,
    );

    target.setCoords();
  };

  /** fabric の selection:cleared。overlay クリア + アンカー選択リセット。 */
  readonly onSelectionCleared = (): void => {
    this.state.clearOverlay();
    this.selectCharTool.clearSelectedAnchors();
  };

  /** fabric の selection:created / selection:updated 共通 handler。 */
  readonly onSelectionChanged = (): void => {
    this.state.clearOverlay();
    this.selectCharTool.clearSelectedAnchors();
    this.tools[this.state.getCurrentMode()].onSelectionChanged(this.state);
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    this.upperCanvas.addEventListener('mousedown', this.onUpperCanvasMouseDown, true);
    this.upperCanvas.addEventListener('mousemove', this.onUpperCanvasMouseMove, true);
    this.canvas.on('mouse:down', this.onCanvasMouseDown);
    this.canvas.on('mouse:wheel', this.onCanvasMouseWheel);
    this.canvas.on('object:moving', this.onObjectMoving);
    this.canvas.on('selection:cleared', this.onSelectionCleared);
    this.canvas.on('selection:created', this.onSelectionChanged);
    this.canvas.on('selection:updated', this.onSelectionChanged);
  }

  detach(): void {
    this.upperCanvas.removeEventListener('mousedown', this.onUpperCanvasMouseDown, true);
    this.upperCanvas.removeEventListener('mousemove', this.onUpperCanvasMouseMove, true);
    this.canvas.off('mouse:down', this.onCanvasMouseDown as never);
    this.canvas.off('mouse:wheel', this.onCanvasMouseWheel as never);
    this.canvas.off('object:moving', this.onObjectMoving as never);
    this.canvas.off('selection:cleared', this.onSelectionCleared as never);
    this.canvas.off('selection:created', this.onSelectionChanged as never);
    this.canvas.off('selection:updated', this.onSelectionChanged as never);
  }
}
