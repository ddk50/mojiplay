// renderer エントリーポイント。esbuild が IIFE format でバンドル出力するので
// 本ファイルを真の ES モジュールとして書く (top-level コードはバンドルの IIFE 内で実行)。

import type { Mat2x3, PathTransform } from '../core/path/coords';
import { pathLocalToScreen } from '../core/path/coords';
import { fromFabricPath } from '../core/path/fabric-adapter';
import { computeOverlayLayout } from '../tools/overlay-layout';
import type {
  Tool, PointerInput,
} from '../tools/tool-interface';
import type { TextCreateProps } from '../core/state';
import { SelectCharTool } from '../tools/select-char-tool';
import { SelectGroupTool } from '../tools/select-group-tool';
import { TextTool } from '../tools/text-tool';
import { PenAddTool } from '../tools/pen-add-tool';
import { PenRemoveTool } from '../tools/pen-remove-tool';
import { ensureObjectId } from '../core/object-id';
import type { ObjectId } from '../core/object-id';
import type { Command } from '../core/history/types';

import { logger } from './logger';
import { showToast } from './toast';
import { initMenuBar } from './menu-bar';
import {
  fontFamilySel, fontStyleSel, populateStyleList, styleValue,
} from './font-enumeration';
import { buildToolbar } from './toolbar';
import { State } from './state';
import { generateGroupId } from './group-id';
import { selectAll } from './actions/select-all';
import { deleteSelection } from './actions/delete';
import { duplicateSelection } from './actions/duplicate';
import { outlineSelection } from './actions/outline';
import { doCopy } from './actions/copy-png';

// メニューアクション → 後で canvas 初期化後に使う関数を参照するため
// handleMenuAction は関数宣言 (hoisted) で定義し、canvas 依存部分は
// そこから呼ぶ。initMenuBar() はここで即実行。
function handleMenuAction(action: string): void {
  switch (action) {
    case 'copy':
      doCopy(canvas);
      break;
    case 'undo':
      handleUndo();
      break;
    case 'redo':
      handleRedo();
      break;
    case 'paste':
      void window.electronAPI?.paste();
      break;
    case 'delete':
      deleteSelection(canvas, state);
      break;
    case 'duplicate':
      duplicateSelection(canvas, state);
      break;
    case 'select-all':
      selectAll(canvas);
      break;
    case 'devtools':
      void window.electronAPI?.toggleDevTools();
      break;
    case 'zoom-in':
      void window.electronAPI?.zoomIn();
      break;
    case 'zoom-out':
      void window.electronAPI?.zoomOut();
      break;
    case 'zoom-reset':
      void window.electronAPI?.zoomReset();
      break;
    case 'fullscreen':
      void window.electronAPI?.toggleFullscreen();
      break;
  }
}

initMenuBar(handleMenuAction);

// ── Canvas setup ──────────────────────────────────────────────────────────

const container = document.getElementById('canvas-container') as HTMLDivElement;

const canvas = new fabric.Canvas('main-canvas', {
  backgroundColor: undefined,
  preserveObjectStacking: true,
  selection: true,
  // 範囲選択 (ドラッグマーキー) の見た目: 薄いブルー塗り + ブルー点線。
  // ハンドル色 (#0066ff) と統一して視覚言語を揃える。
  selectionColor:       'rgba(0, 102, 255, 0.08)',
  selectionBorderColor: '#0066ff',
  selectionLineWidth:   1,
  selectionDashArray:   [5, 3],
});

function resizeCanvas(): void {
  canvas.setWidth(container.clientWidth);
  canvas.setHeight(container.clientHeight);
  canvas.renderAll();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// State: fabric を内包し、ToolHost interface + History API + 永続化 API を提供。
// fabric event hook (mouse:down / object:modified による history 配線) も state 内部。
// 詳細は CLAUDE.md「Tool との関係」「Tool-driven vs fabric-driven の区別」参照。
const state = new State(canvas, { historyMax: 100 });

// ── Toolbar references ────────────────────────────────────────────────────
// fontFamilySel / fontStyleSel は renderer/font-enumeration.ts で定義済み (cross-file global)。

const fontSizeInput      = document.getElementById('font-size')             as HTMLInputElement;
const fontColorInput     = document.getElementById('font-color')            as HTMLInputElement;
const rotationInput      = document.getElementById('rotation')              as HTMLInputElement;
// モード切替ボタンは renderer/toolbar.ts が tools 配列から動的生成する。
// 生成された button マップは下段の dispatcher セットアップ後に modeButtons に代入される。
const snapEnabledInput   = document.getElementById('snap-enabled')          as HTMLInputElement;
const snapPitchInput     = document.getElementById('snap-pitch')            as HTMLInputElement;
const snapThresholdInput = document.getElementById('snap-threshold')        as HTMLInputElement;

// システムフォント列挙は renderer/font-enumeration.ts に移動済み。
// (parseStyle, fontsByFamily, populateStyleList, populateFontList,
//  fontFamilySel, fontStyleSel, styleValue, StyleInfo)

// ── Snap state (select-char モード専用) ──────────────────────────────────

let snapEnabled   = snapEnabledInput.checked;
let snapPitch     = Math.max(1, parseInt(snapPitchInput.value, 10)     || 8);
let snapThreshold = Math.max(1, parseInt(snapThresholdInput.value, 10) || 5);

function syncSnapConfigToTool(): void {
  // selectCharTool は後段で初期化されるので、最初の input イベントは setMode 直後の
  // ロード完了以降。ガード必要無し (selectCharTool は const、IIFE 内で必ず生成済み)。
  selectCharTool.setSnapConfig({
    enabled: snapEnabled, pitch: snapPitch, threshold: snapThreshold,
  });
}

snapEnabledInput.addEventListener('change', () => {
  snapEnabled = snapEnabledInput.checked;
  syncSnapConfigToTool();
});
snapPitchInput.addEventListener('input', () => {
  snapPitch = Math.max(1, parseInt(snapPitchInput.value, 10) || 8);
  syncSnapConfigToTool();
});
snapThresholdInput.addEventListener('input', () => {
  snapThreshold = Math.max(1, parseInt(snapThresholdInput.value, 10) || 5);
  syncSnapConfigToTool();
});

// ── Mode management ───────────────────────────────────────────────────────

type Mode = 'select-group' | 'select-char' | 'text' | 'pen-add' | 'pen-remove';
let currentMode: Mode = 'select-group';

// buildToolbar が tools 配列から button を生成して埋める。tool の id (= Mode) を
// キーに button 要素を保持。setMode の active class 切替で参照する。
let modeButtons: Record<string, HTMLButtonElement> = {};

function setMode(m: Mode): void {
  const prev = currentMode;
  currentMode = m;
  for (const k of Object.keys(modeButtons)) {
    modeButtons[k].classList.toggle('is-active', k === m);
  }

  if (prev !== m) {
    tools[prev].onDeactivate(state);
    tools[m].onActivate(state);
  }

  const isSelectMode = m === 'select-group' || m === 'select-char';
  const isPenMode    = m === 'pen-add' || m === 'pen-remove';
  canvas.selection     = isSelectMode;
  canvas.defaultCursor = m === 'text' ? 'text' : 'default';
  // 白矢印 (select-char) はアンカー編集モードなので、Illustrator の Direct
  // Selection 同様に標準アローを維持する (path 本体のホバーで move カーソルに
  // 切り替わるのは「十字」表示になり混乱の原因)。
  // 黒矢印 (select-group) は文字列丸ごと移動が主用途なので move を維持。
  canvas.hoverCursor   =
    m === 'text'        ? 'text' :
    m === 'select-char' ? 'default' :
    'move';

  canvas.forEachObject(o => {
    o.selectable = isSelectMode;
    o.evented    = isSelectMode;
  });

  clearAnchorState();
  // ペンモードでは選択中パスを維持する
  if (!isSelectMode && !isPenMode) canvas.discardActiveObject();
  canvas.requestRenderAll();
}

// ツールバーボタンの click 配線は buildToolbar (後段) で行う。

// ── IText 確定: 1文字ずつ fabric.Text に分割 ──────────────────────────────

function commitIText(it: fabric.IText): void {
  // 二重呼び出し防止（Enter keydown → exitEditing → text:editing:exited の流れ）
  if (!canvas.contains(it)) return;

  const text = it.text || '';
  if (!text.trim()) {
    canvas.remove(it);
    canvas.requestRenderAll();
    return;
    
  }

  const groupId    = generateGroupId();
  const fontFamily = it.fontFamily || 'Arial';
  const fontSize   = (it.fontSize as number) || 72;
  const fontWeight = (it.fontWeight as number | string) ?? 400;
  const fontStyle: 'normal' | 'italic' | 'oblique' =
    (it.fontStyle as 'normal' | 'italic' | 'oblique') || 'normal';
  const fill       = (it.fill as string) || '#000000';
  const startX     = (it.left  as number) || 0;
  const startY     = (it.top   as number) || 0;

  // 位置計算は Fabric.IText の内部計測結果 (__charBounds) をそのまま流用する。
  // かつては tmpCtx.measureText(char) で 1 文字ずつ測っていたが、それだと
  // フォントのペアカーニング（"AV" や "To" 等の詰め）が再現されず、
  // 加えて固定スペース (fontSize * 0.05 / 0.3) を足していたため、Enter 確定の
  // 瞬間にカーニングと間隔が変わる現象が発生していた。
  // Fabric は編集中に _measureChar() でペアワイズ測定を行い、各文字の左端を
  // __charBounds[line][index].left に保持しているので、これを使えば編集中の
  // 見た目とピクセル単位で一致する。initDimensions() で populated を保証する。
  (it as any).initDimensions();
  const lines  = (it as any)._textLines  as string[][];
  const bounds = (it as any).__charBounds as Array<Array<{ left: number; width: number }>>;
  const lineHeightPx = fontSize * ((it.lineHeight as number) || 1.16);

  let charIndex = 0;
  // History: 作成された各 char を objectCreated Command として捕捉、commit 後に
  // 一括で compound として push (= 1 step で N 個の char をまとめて undo/redo)。
  // IText 自体は ephemeral (編集中にしか存在しない) なので履歴対象外。undo は
  // 「commit 直前の canvas 状態」 = 「これらの char が無い状態」に戻す。
  const createdCommands: Command[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci++) {
      const char = line[ci];

      // 空白は fabric.Text を生成しない（現状踏襲）。bounds[li][ci].left は
      // 空白を含んだ座標なので、スキップしても次文字の left はズレない。
      if (char === ' ') { charIndex++; continue; }

      const obj = new fabric.Text(char, {
        left:        startX + bounds[li][ci].left,
        top:         startY + li * lineHeightPx,
        fontFamily,
        fontSize,
        fontWeight,
        fontStyle,
        fill,
        selectable:  currentMode !== 'text',
        evented:     currentMode !== 'text',
        hasControls: true,
        hasBorders:  true,
        data: { groupId, charIndex, sourceText: text }
      });
      const objectId = ensureObjectId(obj as any, 'text');

      canvas.add(obj);
      createdCommands.push({
        kind: 'objectCreated',
        objectId,
        after: state.captureObjectSnapshot(obj),
      });
      charIndex++;
    }
  }

  canvas.remove(it);
  canvas.requestRenderAll();

  if (createdCommands.length === 1) {
    state.pushCommand(createdCommands[0]);
  } else if (createdCommands.length > 1) {
    state.pushCommand({ kind: 'compound', commands: createdCommands });
  }
  if (createdCommands.length > 0) {
    logger.debug(`[history] push commitIText: ${createdCommands.length} chars`);
  }

  const vt = canvas.viewportTransform;
  logger.debug(
    `[commitIText] created ${charIndex} chars for groupId=${groupId}` +
    ` startX=${startX} startY=${startY}` +
    ` vt=[${vt?.map(n => n.toFixed(3)).join(',')}] zoom=${canvas.getZoom()}`
  );
}

// fabric-driven な transform (drag / scale / rotate via selection controls) を
// objectChanged Command として履歴に積む処理は state.ts (createState 内の
// canvas event hook) に移動した。tool-driven な finalizeDrag からの fire は
// e.action が無いので state 側で skip される。

// テキスト生成 (mouse:down) は TextTool に分離済み。配線は後段の
// ツールディスパッチャで onCanvasMouseDown を呼ぶ形に統一されている。

// ── Enter で確定（capture フェーズで Fabric の keydown より先に実行）────────

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const active = canvas.getActiveObject() as fabric.IText | null;
  if (e.key === 'Enter' && active && (active as any).isEditing) {
    e.preventDefault();
    e.stopPropagation();
    active.exitEditing(); // → text:editing:exited → commitIText
  }
}, true);

// editing:exited で commitIText（Enter / Esc / クリックアウェイ すべて対応）
canvas.on('text:editing:exited', (e: fabric.IEvent) => {
  const obj = e.target as fabric.IText;
  if (obj) commitIText(obj);
});

// 黒矢印モードのグループ自動展開ロジックは SelectGroupTool に抽出済み
// (tools/select-group-tool.ts + tools/group-selection.ts)。
// 配線は後段の selection:created / selection:updated ディスパッチャから
// onSelectionChanged 経由で呼ばれる。

// ── Apply property to selected objects ───────────────────────────────────

function applyToSelection(props: Partial<fabric.ITextOptions>): void {
  const active = canvas.getActiveObjects();
  if (!active.length) return;

  // History: 各 object の before/after snapshot を取って Command 化
  const cmds: Command[] = [];
  for (const obj of active) {
    const id = (obj as any).data?.objectId as ObjectId | undefined;
    if (!id) continue;
    const before = state.captureObjectSnapshot(obj);
    obj.set(props as Partial<fabric.Object>);
    const after = state.captureObjectSnapshot(obj);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      cmds.push({ kind: 'objectChanged', objectId: id, before, after });
    }
  }
  canvas.requestRenderAll();

  if (cmds.length === 1) {
    state.pushCommand(cmds[0]);
    logger.debug('[history] push toolbar property change');
  } else if (cmds.length > 1) {
    state.pushCommand({ kind: 'compound', commands: cmds });
    logger.debug(`[history] push compound (toolbar) ${cmds.length} changes`);
  }
}

function currentFontStyle(): { fontWeight: number; fontStyle: 'normal' | 'italic' } {
  const [weightStr, italicStr] = fontStyleSel.value.split('|');
  const fontWeight = parseInt(weightStr, 10) || 400;
  const fontStyle = italicStr === 'italic' ? 'italic' : 'normal';
  return { fontWeight, fontStyle };
}

fontFamilySel.addEventListener('change', () => {
  populateStyleList(fontFamilySel.value);
  applyToSelection({
    fontFamily: fontFamilySel.value,
    ...currentFontStyle(),
  });
});

fontStyleSel.addEventListener('change', () => {
  applyToSelection(currentFontStyle());
});

fontSizeInput.addEventListener('change', () => {
  applyToSelection({ fontSize: parseInt(fontSizeInput.value, 10) || 72 });
});

fontColorInput.addEventListener('input', () => {
  applyToSelection({ fill: fontColorInput.value });
});

// ── Rotation ──────────────────────────────────────────────────────────────

(document.getElementById('btn-apply-rotation') as HTMLButtonElement).addEventListener('click', () => {
  const angle = parseFloat(rotationInput.value) || 0;
  applyToSelection({ angle });
});

canvas.on('object:rotating', (e: fabric.IEvent) => {
  if (e.target) rotationInput.value = String(Math.round(e.target.angle ?? 0));
});

// ── Zoom: Alt + マウスホイール (Photoshop 流、カーソル位置中心) ───────────

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;

canvas.on('mouse:wheel', (e: fabric.IEvent) => {
  const evt = e.e as WheelEvent;
  if (!evt.altKey) return;

  let zoom = canvas.getZoom();
  zoom *= Math.pow(0.999, evt.deltaY); // 上スクロール(deltaY<0)=拡大、下=縮小
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

  canvas.zoomToPoint({ x: evt.offsetX, y: evt.offsetY }, zoom);
  evt.preventDefault();
  evt.stopPropagation();
});

// ── object:moving ディスパッチ ──────────────────────────────────────
// fabric.Object を MovingTarget 抽象に橋渡しして現在ツールに転送する。
// pen / text モードではオブジェクトが selectable=false なのでこのイベントは
// 通常発火しないが、念のため全ツールに dispatch して問題が起きないよう各ツールに
// 安全な no-op を実装させている。

canvas.on('object:moving', (e: fabric.IEvent) => {
  const target = e.target;
  if (!target) return;
  const mouseEvt = e.e as MouseEvent | undefined;

  tools[currentMode].onObjectMoving(
    {
      getLeft: () => target.left ?? 0,
      getTop:  () => target.top  ?? 0,
      setLeft: (v: number) => target.set({ left: v }),
      setTop:  (v: number) => target.set({ top:  v }),
    },
    { altKey: !!mouseEvt?.altKey },
    state,
  );

  target.setCoords();
});

// ── Sync toolbar when selection changes ───────────────────────────────────

function syncToolbarToSelection(): void {
  const active = canvas.getActiveObject() as any;
  if (!active || active.type === 'activeSelection') return;
  if (active.fontFamily) {
    if (fontFamilySel.value !== active.fontFamily) {
      fontFamilySel.value = active.fontFamily;
      populateStyleList(active.fontFamily);
    }
    const rawWeight = active.fontWeight;
    const weight = typeof rawWeight === 'number'
      ? rawWeight
      : (String(rawWeight).toLowerCase() === 'bold' ? 700 : 400);
    const italic = active.fontStyle === 'italic';
    fontStyleSel.value = styleValue(weight, italic);
  }
  if (active.fontSize)   fontSizeInput.value   = String(active.fontSize);
  if (active.fill)       fontColorInput.value  = active.fill as string;
  rotationInput.value = String(Math.round(active.angle ?? 0));
}

(document.getElementById('btn-select-all') as HTMLButtonElement)
  .addEventListener('click', () => selectAll(canvas));

// ── Clear canvas ──────────────────────────────────────────────────────────

(document.getElementById('btn-clear') as HTMLButtonElement).addEventListener('click', () => {
  if (confirm('キャンバスの内容をすべて削除しますか？')) {
    canvas.clear();
    canvas.backgroundColor = '';
    canvas.renderAll();
  }
});

// ── PNG export ────────────────────────────────────────────────────────────

(document.getElementById('btn-export') as HTMLButtonElement).addEventListener('click', async () => {
  canvas.discardActiveObject();
  canvas.renderAll();

  const dataURL = canvas.toDataURL({
    format:              'png',
    multiplier:          2,
    enableRetinaScaling: true
  });

  if (window.electronAPI) {
    const result = await window.electronAPI.savePng(dataURL);
    if (result.success) {
      showToast(`保存しました: ${result.filePath}`);
    } else if (result.reason !== 'canceled') {
      showToast(`エラー: ${result.reason}`, true);
    }
  } else {
    const link = document.createElement('a');
    link.download = 'layout.png';
    link.href = dataURL;
    link.click();
  }
});

// ── アウトライン化: ボタンバインド ────────────────────────────────────────
// 実装本体は actions/outline.ts (action) / outline-conversion.ts (純粋寄り変換)。

(document.getElementById('btn-outline') as HTMLButtonElement).addEventListener('click', () => {
  void outlineSelection(canvas, state);
});

// ── アンカー編集オーバーレイ (Phase 2a) ──────────────────────────────────
//
// select-char (白矢印) モードで outline 化済み fabric.Path が選択されているとき、
// パスのアンカーポイント (セグメント端点) を正方形マーカーで表示し、
// ドラッグで個別アンカー + 付属ベジェハンドルを剛体移動する。

// ヒット半径はツール側に閉じている (tools/overlay-layout.ts)。
// ここはマーカー描画の見た目関連のみ。
const ANCHOR_MARKER_PX     = 7;
const ANCHOR_FILL          = '#ffffff';
const ANCHOR_STROKE        = '#0066ff';
// 選択中アンカーは塗り潰しを反転 (Illustrator 流: hollow → filled)。
const ANCHOR_SELECTED_FILL = '#0066ff';

const HANDLE_LINE_COLOR = '#0066ff';
const HANDLE_LINE_WIDTH = 1;
const HANDLE_CIRCLE_R   = 4;
const HANDLE_FILL       = '#ffffff';
const HANDLE_STROKE     = '#0066ff';

// 全ツールがそれぞれ自前で computeOverlayLayout / hitTest を呼ぶようになったため、
// app.ts レベルでのスクリーン座標キャッシュは不要になった (drawAnchorOverlay は
// 描画ごとに layout を計算しても十分軽い)。ヒットテスト関数も tools/
// overlay-layout.ts の hitTestAnchorAt / hitTestHandleAt を直接ツールが利用する。

function drawAnchorOverlay(): void {
  // 編集モードでなければ overlay 描画は不要。fabric は contextTop に範囲選択
  // (marquee) や free-drawing を描画するので、我々が無条件に clearContext すると
  // それらが消えてしまう (回帰防止)。
  if (currentMode !== 'select-char' && currentMode !== 'pen-add' && currentMode !== 'pen-remove') return;
  const path = state.getActivePath();
  if (!path) return;
  const ctx = (canvas as any).contextTop as CanvasRenderingContext2D;
  if (!ctx) return;
  canvas.clearContext(ctx);

  const snapshot = path.snapshot();

  const half = ANCHOR_MARKER_PX / 2;
  const layout = computeOverlayLayout(snapshot, state.getViewportMatrix());
  const aCache = layout.anchors;
  const hCache = layout.handles;

  ctx.save();
  const retina = (canvas as any).getRetinaScaling?.() ?? window.devicePixelRatio ?? 1;
  ctx.setTransform(retina, 0, 0, retina, 0, 0);

  // Pass 1: ハンドル線 (最背面)
  ctx.strokeStyle = HANDLE_LINE_COLOR;
  ctx.lineWidth = HANDLE_LINE_WIDTH;
  for (const h of hCache) {
    const anchor = aCache[h.anchorIndex];
    ctx.beginPath();
    ctx.moveTo(anchor.sx, anchor.sy);
    ctx.lineTo(h.sx, h.sy);
    ctx.stroke();
  }

  // Pass 2: ハンドル円
  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.lineWidth = 1;
  for (const h of hCache) {
    ctx.beginPath();
    ctx.arc(h.sx, h.sy, HANDLE_CIRCLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Pass 3: アンカー四角 (最前面)。select-char モードでは選択中アンカーを
  // 塗り潰し色違いで描画 (= Illustrator 流の "filled = selected")。
  const selectedSet = currentMode === 'select-char'
    ? selectCharTool.getSelectedAnchorIndices()
    : null;
  ctx.strokeStyle = ANCHOR_STROKE;
  ctx.lineWidth = 1;
  for (const a of aCache) {
    ctx.fillStyle = (selectedSet && selectedSet.has(a.anchorIndex))
      ? ANCHOR_SELECTED_FILL
      : ANCHOR_FILL;
    ctx.fillRect(a.sx - half, a.sy - half, ANCHOR_MARKER_PX, ANCHOR_MARKER_PX);
    ctx.strokeRect(a.sx - half, a.sy - half, ANCHOR_MARKER_PX, ANCHOR_MARKER_PX);
  }

  ctx.restore();
}

canvas.on('after:render', drawAnchorOverlay);

function clearAnchorState(): void {
  // contextTop に描かれたアンカー/ハンドルマーカーをクリアする。
  // 各ツール内のドラッグ状態は onDeactivate で個別にリセットされる。
  const ctx = (canvas as any).contextTop as CanvasRenderingContext2D;
  if (ctx) canvas.clearContext(ctx);
}

// ── SelectCharTool 配線 ────────────────────────────────────────────
//
// 白矢印モードのアンカー/ハンドルドラッグとホバー判定は tools/select-char-tool.ts に
// 抽出済み。fabric.Path → PathHandle の橋渡しと finalizeDrag は
// renderer/fabric-path-handle.ts に抽出済み (history adapter からも参照される)。
// ここでは DOM/fabric イベントを現在ツールへ転送する dispatcher を担当する。

const upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;

// ObjectHandle のキャッシュ + makeFabricObjectHandle / makeFabricPathHandle は
// renderer/state.ts に移動済 (state が canonical 化を内包)。

function currentTextProps(): TextCreateProps {
  const { fontWeight, fontStyle } = currentFontStyle();
  return {
    fontFamily: fontFamilySel.value,
    fontSize:   parseInt(fontSizeInput.value, 10) || 72,
    fontWeight,
    fontStyle,
    fill:       fontColorInput.value,
  };
}

// FabricToolHost / makeFabricObjectHandle / fabric event hook / handleUndo /
// handleRedo / historyStack / makeFabricPathHandle / snapshot / history-adapter は
// 全て renderer/state.ts の createState に集約済。app.ts は state を経由して
// fabric を操作する (CLAUDE.md「Tool との関係」参照)。

function handleUndo(): void { state.undo(); }
function handleRedo(): void { state.redo(); }

// Cmd/Ctrl+Z = undo、Cmd/Ctrl+Shift+Z = redo。
// IText 編集中は browser 任せ (= bypass) — fabric.IText は内蔵 undo を持たないので
// 文字編集の細かい undo は無いが、global undo で commit 前の text が消えるのを避ける。
document.addEventListener('keydown', (e: KeyboardEvent) => {
  const active = canvas.getActiveObject() as fabric.IText | null;
  if ((active as any)?.isEditing) return;
  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    handleUndo();
  } else if ((e.key === 'Z') || (e.key === 'z' && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    handleRedo();
  }
}, true);

// ツールインスタンス。SelectCharTool だけは snap 設定の動的注入があるので
// 個別変数で保持し、map にも入れる。
const selectGroupTool = new SelectGroupTool();
const selectCharTool  = new SelectCharTool();
const textTool        = new TextTool(currentTextProps);
const penAddTool      = new PenAddTool();
const penRemoveTool   = new PenRemoveTool();

selectCharTool.setSnapConfig({ enabled: snapEnabled, pitch: snapPitch, threshold: snapThreshold });

const tools: Record<Mode, Tool> = {
  'select-group': selectGroupTool,
  'select-char':  selectCharTool,
  'text':         textTool,
  'pen-add':      penAddTool,
  'pen-remove':   penRemoveTool,
};

// ツールバーボタン群を tools 配列から動的生成する。Object.values は挿入順を
// 保つので、上の Record 定義の並びがそのまま toolbar の左→右順になる。
// 生成された button 群は modeButtons (上段で宣言) に格納され、setMode の
// is-active class 切替に使われる。
{
  const container = document.getElementById('tool-buttons');
  if (!container) throw new Error('#tool-buttons container not found in index.html');
  modeButtons = buildToolbar(
    Object.values(tools),
    container,
    (id) => setMode(id as Mode),
  );
  // 起動直後の active class を初期モードに合わせる。
  setMode(currentMode);
}

function buildPointerInput(e: MouseEvent): PointerInput {
  const rect = upperCanvas.getBoundingClientRect();
  const w = canvas.getPointer(e);
  return {
    screenX:  e.clientX - rect.left,
    screenY:  e.clientY - rect.top,
    worldX:   w.x,
    worldY:   w.y,
    altKey:   e.altKey,
    shiftKey: e.shiftKey,
  };
}

// DOM capture mousedown: 現ツールの onPointerDown を呼び、'consumed' なら
// document-level mousemove/up でドラッグ追跡し、fabric 伝播を抑止する。
upperCanvas.addEventListener('mousedown', (e: MouseEvent) => {
  const tool = tools[currentMode];
  const result = tool.onPointerDown(buildPointerInput(e), state);
  if (result !== 'consumed') return;

  e.stopImmediatePropagation();
  e.preventDefault();

  const onMove = (me: MouseEvent) => {
    tool.onPointerMove(buildPointerInput(me), state);
  };
  const onUp = (me: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    tool.onPointerUp(buildPointerInput(me), state);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}, true);

// hover カーソル更新: ドラッグ中はドキュメント level handler が動いているので
// upperCanvas mousemove は idle のときだけツールに通知する。
upperCanvas.addEventListener('mousemove', (e: MouseEvent) => {
  const tool = tools[currentMode];
  if (tool.isDragging()) return;
  tool.onPointerMove(buildPointerInput(e), state);
}, true);

// fabric の mouse:down (fabric の hit-test 後)。TextTool が空き領域クリックで
// IText を生成するのに使う。他ツールは no-op 実装になっている。
canvas.on('mouse:down', (opt) => {
  const w = canvas.getPointer(opt.e as MouseEvent);
  tools[currentMode].onCanvasMouseDown({
    worldX: w.x, worldY: w.y, hasTarget: !!opt.target,
  }, state);
});

// ペンツール (PenAddTool / PenRemoveTool) と関連ヘルパは tools/* に抽出済み。
// 上記の DOM mousedown/move dispatcher が現在ツールを呼ぶので、ここに専用 handler は無い。

// 選択イベント: contextTop の overlay クリア → 現ツールの onSelectionChanged
// (黒矢印は groupId 自動展開) → toolbar 同期。
canvas.on('selection:cleared', () => {
  clearAnchorState();
  // 選択 path が外れたらアンカー選択もリセット
  selectCharTool.clearSelectedAnchors();
});
canvas.on('selection:created', () => {
  clearAnchorState();
  // 別 path に切り替わったらアンカー選択をリセット
  selectCharTool.clearSelectedAnchors();
  tools[currentMode].onSelectionChanged(state);
  syncToolbarToSelection();
});
canvas.on('selection:updated', () => {
  clearAnchorState();
  selectCharTool.clearSelectedAnchors();
  tools[currentMode].onSelectionChanged(state);
  syncToolbarToSelection();
});
canvas.on('object:removed', () => {
  // 各ツール内のドラッグ状態は onPointerUp / onDeactivate で解除される。
  // selection:cleared が同時発火する場合 clearAnchorState は上で処理済み。
});

// ── Edit > Copy IPC (main プロセスのカスタムメニューから IPC で通知される) ─
// 実装本体は actions/copy-png.ts。IText 編集中は fabric 自身のテキストコピーに任せる。

if (window.electronAPI) {
  window.electronAPI.onMenuCopy(() => {
    logger.debug('[copy] menu-copy IPC received');
    const active = canvas.getActiveObject() as any;
    if (active && !active.isEditing) {
      doCopy(canvas);
    }
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function isToolbarInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // IText 編集中は Fabric に任せる
  const active = canvas.getActiveObject() as any;
  if (active && active.isEditing) return;

  // Ctrl+C / Cmd+C: 選択オブジェクトを透過 PNG でクリップボードにコピー
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
      (e.key === 'c' || e.key === 'C')) {
    if (!isToolbarInput() && canvas.getActiveObject()) {
      e.preventDefault();
      doCopy(canvas);
    }
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') &&
      !isToolbarInput()) {
    deleteSelection(canvas, state);
  }

  // Cmd/Ctrl+D: 選択オブジェクトを複製 (Affinity / Sketch 慣例。Illustrator 自体は
  // Ctrl+D が "Transform Again" だが、mojiplay では duplicate にした方が直感的)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
      (e.key === 'd' || e.key === 'D')) {
    if (!isToolbarInput() && canvas.getActiveObject()) {
      e.preventDefault();
      duplicateSelection(canvas, state);
    }
    return;
  }

  // Cmd/Ctrl+Shift+O: 選択中テキストをアウトライン化 (Illustrator 慣例)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
    e.preventDefault();
    void outlineSelection(canvas, state);
  }

  // 矢印キー: select-char モードで選択中アンカーを world delta で平行移動。
  // Photoshop 慣例で 1 unit / Shift+矢印で 10 unit。Modifier 無し前提なので
  // Ctrl/Cmd/Alt が押されている場合はブラウザ標準動作に任せる。
  if (currentMode === 'select-char' &&
      !e.ctrlKey && !e.metaKey && !e.altKey && !isToolbarInput()) {
    let dx = 0, dy = 0;
    if      (e.key === 'ArrowLeft')  dx = -1;
    else if (e.key === 'ArrowRight') dx =  1;
    else if (e.key === 'ArrowUp')    dy = -1;
    else if (e.key === 'ArrowDown')  dy =  1;
    if (dx !== 0 || dy !== 0) {
      const step = e.shiftKey ? 10 : 1;
      if (selectCharTool.getSelectedAnchorIndices().size > 0) {
        e.preventDefault();
        selectCharTool.moveSelectedAnchorsBy(state, dx * step, dy * step);
      }
    }
  }

  // F12 / Ctrl+Shift+I: DevTools を開閉 (HTML メニューの「開発者ツール」と同等)
  if (e.key === 'F12' ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
    e.preventDefault();
    void window.electronAPI?.toggleDevTools();
  }
});
