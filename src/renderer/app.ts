// renderer エントリーポイント。esbuild が IIFE format でバンドル出力するので
// 本ファイルを真の ES モジュールとして書く (top-level コードはバンドルの IIFE 内で実行)。

import type { PathCommand } from '../core/path/types';
import type { Mat2x3, PathTransform } from '../core/path/coords';
import { pathLocalToScreen } from '../core/path/coords';
import { fromFabricPath, toFabricPath } from '../core/path/fabric-adapter';
import { computeOverlayLayout } from '../core/tools/overlay-layout';
import type {
  Tool, ToolHost, ObjectHandle, PathHandle, PathSnapshot,
  PointerInput, TextCreateProps,
} from '../core/tools/tool-interface';
import { SelectCharTool } from '../core/tools/select-char-tool';
import { SelectGroupTool } from '../core/tools/select-group-tool';
import { TextTool } from '../core/tools/text-tool';
import { PenAddTool } from '../core/tools/pen-add-tool';
import { PenRemoveTool } from '../core/tools/pen-remove-tool';
import { exportObjectToPngDataUrl } from '../core/copy-export';

import { logger } from './logger';
import { showToast } from './toast';
import { initMenuBar } from './menu-bar';
import {
  fontFamilySel, fontStyleSel, populateStyleList, styleValue,
} from './font-enumeration';
import { outlineTextToPath } from './outline-conversion';

// メニューアクション → 後で canvas 初期化後に使う関数を参照するため
// handleMenuAction は関数宣言 (hoisted) で定義し、canvas 依存部分は
// そこから呼ぶ。initMenuBar() はここで即実行。
function handleMenuAction(action: string): void {
  switch (action) {
    case 'copy':
      // doCopy は後段で定義 (hoisted function)
      if (typeof doCopy === 'function') doCopy();
      break;
    case 'undo':
      void window.electronAPI?.undo();
      break;
    case 'redo':
      void window.electronAPI?.redo();
      break;
    case 'paste':
      void window.electronAPI?.paste();
      break;
    case 'delete':
      menuDeleteSelection();
      break;
    case 'select-all':
      menuSelectAll();
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

// ── Toolbar references ────────────────────────────────────────────────────
// fontFamilySel / fontStyleSel は renderer/font-enumeration.ts で定義済み (cross-file global)。

const fontSizeInput      = document.getElementById('font-size')             as HTMLInputElement;
const fontColorInput     = document.getElementById('font-color')            as HTMLInputElement;
const rotationInput      = document.getElementById('rotation')              as HTMLInputElement;
const btnModeSelectGroup = document.getElementById('btn-mode-select-group') as HTMLButtonElement;
const btnModeSelectChar  = document.getElementById('btn-mode-select-char')  as HTMLButtonElement;
const btnModeText        = document.getElementById('btn-mode-text')         as HTMLButtonElement;
const btnModePenAdd      = document.getElementById('btn-mode-pen-add')      as HTMLButtonElement;
const btnModePenRemove   = document.getElementById('btn-mode-pen-remove')   as HTMLButtonElement;
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

const modeButtons: Record<Mode, HTMLButtonElement> = {
  'select-group': btnModeSelectGroup,
  'select-char':  btnModeSelectChar,
  'text':         btnModeText,
  'pen-add':      btnModePenAdd,
  'pen-remove':   btnModePenRemove,
};

function setMode(m: Mode): void {
  const prev = currentMode;
  currentMode = m;
  (Object.keys(modeButtons) as Mode[]).forEach(k => {
    modeButtons[k].classList.toggle('is-active', k === m);
  });

  if (prev !== m) {
    tools[prev].onDeactivate(toolHost);
    tools[m].onActivate(toolHost);
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

btnModeSelectGroup.addEventListener('click', () => setMode('select-group'));
btnModeSelectChar.addEventListener('click',  () => setMode('select-char'));
btnModeText.addEventListener('click',        () => setMode('text'));
btnModePenAdd.addEventListener('click',      () => setMode('pen-add'));
btnModePenRemove.addEventListener('click',   () => setMode('pen-remove'));

// ── IText 確定: 1文字ずつ fabric.Text に分割 ──────────────────────────────

function generateGroupId(): string {
  return `g-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

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
        hasControls: false,
        hasBorders:  true,
        data: { groupId, charIndex, sourceText: text }
      });

      canvas.add(obj);
      charIndex++;
    }
  }

  canvas.remove(it);
  canvas.requestRenderAll();

  const vt = canvas.viewportTransform;
  logger.debug(
    `[commitIText] created ${charIndex} chars for groupId=${groupId}` +
    ` startX=${startX} startY=${startY}` +
    ` vt=[${vt?.map(n => n.toFixed(3)).join(',')}] zoom=${canvas.getZoom()}`
  );
}

// オブジェクトが移動／スケール／回転された時の最終位置をログ
canvas.on('object:modified', (e: fabric.IEvent) => {
  const o = e.target as any;
  if (!o) return;
  const vt = canvas.viewportTransform;
  logger.debug(
    `[object:modified] type=${o.type} left=${o.left} top=${o.top}` +
    ` data.groupId=${o.data?.groupId ?? '-'}` +
    ` vt=[${vt?.map((n: number) => n.toFixed(3)).join(',')}]`
  );
});

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
// (core/tools/select-group-tool.ts + core/tools/group-selection.ts)。
// 配線は後段の selection:created / selection:updated ディスパッチャから
// onSelectionChanged 経由で呼ばれる。

// ── Apply property to selected objects ───────────────────────────────────

function applyToSelection(props: Partial<fabric.ITextOptions>): void {
  const active = canvas.getActiveObjects();
  if (!active.length) return;
  active.forEach(obj => obj.set(props as Partial<fabric.Object>));
  canvas.requestRenderAll();
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
    toolHost,
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

// ── Select all / Delete (メニューとツールバーの両方から呼ばれる) ─────────

function menuSelectAll(): void {
  canvas.discardActiveObject();
  const all = canvas.getObjects();
  if (!all.length) return;
  const sel = new fabric.ActiveSelection(all, { canvas });
  canvas.setActiveObject(sel);
  canvas.requestRenderAll();
}

function menuDeleteSelection(): void {
  const selected = canvas.getActiveObjects();
  if (!selected.length) return;
  selected.forEach(obj => canvas.remove(obj));
  canvas.discardActiveObject();
  canvas.renderAll();
}

(document.getElementById('btn-select-all') as HTMLButtonElement).addEventListener('click', menuSelectAll);

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

// showToast は renderer/toast.ts に移動済み。

// ── アウトライン化: 選択処理とボタンバインド ─────────────────────────────
// 純粋寄りの変換 (outlineTextToPath, getFontkitFont, loadFontData,
// fontkitFontCache) は renderer/outline-conversion.ts に移動済み。
// canvas 操作を含む outlineSelection / isOutlineable とボタンバインドはここに残す。

function isOutlineable(obj: fabric.Object): boolean {
  const anyObj = obj as any;
  if (anyObj.data?.outlined) return false;
  return typeof anyObj.text === 'string' && typeof anyObj.fontFamily === 'string';
}

async function outlineSelection(): Promise<void> {
  const targets = canvas.getActiveObjects().filter(isOutlineable) as fabric.Text[];
  if (targets.length === 0) {
    showToast('アウトライン化する文字を選択してください', true);
    return;
  }

  // 複数選択中 (fabric.ActiveSelection) では、子オブジェクトの .left/.top は
  // group 中心からの相対座標で保持されている (fabric.ActiveSelection の
  // _updateObjectsCoords が書き換えるため)。選択を解除すると destroy() →
  // _restoreObjectsState が走って子の座標が世界座標に戻る。
  // outlineTextToPath は .left/.top を世界座標前提で読むので、ここで先に選択を
  // 解除して座標を確定させる必要がある。
  // targets は配列参照で canvas 上の同じオブジェクトを指しているので、
  // 選択解除後にも同じ fabric.Text を操作できる。
  canvas.discardActiveObject();

  const conversions = await Promise.all(
    targets.map(async (ft) => ({ ft, path: await outlineTextToPath(ft) }))
  );

  const succeeded = conversions.filter(x => x.path) as Array<{ ft: fabric.Text; path: fabric.Path }>;
  const failed = conversions.filter(x => !x.path);
  const failedChars = failed.map(x => x.ft.text || '').join('');
  const failedFamilies = Array.from(new Set(failed.map(x => x.ft.fontFamily || '?')));

  if (succeeded.length === 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    showToast(`アウトライン化失敗: ${detail}`, true);
    return;
  }

  const vt = canvas.viewportTransform;
  logger.debug(
    `[outline] outlineSelection: succeeded=${succeeded.length}` +
    ` viewportTransform=[${vt?.map(n => n.toFixed(3)).join(',')}]` +
    ` zoom=${canvas.getZoom()}`
  );

  // discardActiveObject は最上部で既に実行済み (ActiveSelection の子の座標を
  // 世界座標に戻すため)。ここでは不要。
  for (const { ft, path } of succeeded) {
    canvas.remove(ft);
    canvas.add(path);
  }

  // NOTE: ここで setActiveObject(path) を呼ぶと 'selection:created' が発火し、
  // select-group モードでは expandSelectionToGroup が同じ groupId のオブジェク
  // ト全てを ActiveSelection にまとめてしまう。ActiveSelection は children の
  // left/top を group 中心相対に書き換えるため、fabric.Path 相手だと視覚的に
  // 飛んで見えるバグの温床になる (fabric.Text では同じロジックで問題無いが、
  // Path では pathOffset との組み合わせが複雑で再現する)。
  // 当面は自動選択を諦め、ユーザが手動で 1 クリックしたときに select-group の
  // 通常動作で展開される経路に委ねる (data.groupId は保持している)。
  canvas.requestRenderAll();

  if (failed.length > 0) {
    const detail = failedChars
      ? `${failedFamilies.join(', ')} には「${failedChars}」のグリフがありません`
      : failedFamilies.join(', ');
    showToast(`一部失敗: ${detail}`, true);
  }
}

(document.getElementById('btn-outline') as HTMLButtonElement).addEventListener('click', () => {
  void outlineSelection();
});

// ── アンカー編集オーバーレイ (Phase 2a) ──────────────────────────────────
//
// select-char (白矢印) モードで outline 化済み fabric.Path が選択されているとき、
// パスのアンカーポイント (セグメント端点) を正方形マーカーで表示し、
// ドラッグで個別アンカー + 付属ベジェハンドルを剛体移動する。

// ヒット半径はツール側に閉じている (core/tools/overlay-layout.ts)。
// ここはマーカー描画の見た目関連のみ。
const ANCHOR_MARKER_PX  = 7;
const ANCHOR_FILL       = '#ffffff';
const ANCHOR_STROKE     = '#0066ff';

const HANDLE_LINE_COLOR = '#0066ff';
const HANDLE_LINE_WIDTH = 1;
const HANDLE_CIRCLE_R   = 4;
const HANDLE_FILL       = '#ffffff';
const HANDLE_STROKE     = '#0066ff';

// 全ツールがそれぞれ自前で computeOverlayLayout / hitTest を呼ぶようになったため、
// app.ts レベルでのスクリーン座標キャッシュは不要になった (drawAnchorOverlay は
// 描画ごとに layout を計算しても十分軽い)。ヒットテスト関数も core/tools/
// overlay-layout.ts の hitTestAnchorAt / hitTestHandleAt を直接ツールが利用する。

function getEditablePath(): fabric.Path | null {
  if (currentMode !== 'select-char' && currentMode !== 'pen-add' && currentMode !== 'pen-remove') return null;
  const obj = canvas.getActiveObject();
  if (!obj || obj.type !== 'path') return null;
  if (!(obj as any).data?.outlined) return null;
  return obj as fabric.Path;
}

function drawAnchorOverlay(): void {
  const ctx = (canvas as any).contextTop as CanvasRenderingContext2D;
  const path = getEditablePath();
  if (!path || !ctx) {
    // 編集対象パスが無い場合は contextTop に手を出さない。
    // fabric は contextTop に範囲選択 (marquee) や free-drawing を描画するので、
    // 我々が無条件に clearContext すると marquee が消えてしまう (回帰防止)。
    return;
  }
  canvas.clearContext(ctx);

  const rawCmds = (path as any).path as ReadonlyArray<ReadonlyArray<unknown>> | undefined;
  if (!rawCmds) return;
  const cmds = fromFabricPath(rawCmds);

  const half = ANCHOR_MARKER_PX / 2;
  const layout = computeOverlayLayout(
    { commands: cmds, pathMatrix: path.calcTransformMatrix() as unknown as Mat2x3,
      pathOffset: { x: (path as any).pathOffset.x, y: (path as any).pathOffset.y } },
    canvas.viewportTransform as unknown as Mat2x3,
  );
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

  // Pass 3: アンカー四角 (最前面)
  ctx.fillStyle = ANCHOR_FILL;
  ctx.strokeStyle = ANCHOR_STROKE;
  ctx.lineWidth = 1;
  for (const a of aCache) {
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

// ── 共通ヘルパー ────────────────────────────────────────────────────

/** ドラッグ終了時の bbox 再計算 + pathOffset 補正 */
function finalizeDrag(p: fabric.Path): void {
  const oldPO = { x: (p as any).pathOffset.x, y: (p as any).pathOffset.y };
  (fabric.Polyline.prototype as any)._setPositionDimensions.call(p, {
    left: p.left,
    top: p.top,
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

// ── SelectCharTool 配線 ────────────────────────────────────────────
//
// 白矢印モードのアンカー/ハンドルドラッグとホバー判定は core/tools/select-char-tool.ts に
// 抽出済み。ここでは fabric.Path をツール抽象 (PathHandle) に橋渡しする adapter と、
// DOM/fabric イベントを現在ツールへ転送する dispatcher。
// 各ツールは core/tools/* に抽象化されており、本ブロックは fabric.Path /
// fabric.IText / fabric.ActiveSelection との橋渡しのみを行う。

const upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;

function makeFabricPathHandle(p: fabric.Path): PathHandle {
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
  };
}

// ObjectHandle は SelectGroupTool 用。fabric.Object との対応関係を内部に保つので
// setActiveSelection では _obj を取り出して fabric API を呼ぶ。
//
// 重要: 同じ fabric.Object に対しては常に同じ handle instance を返す
// (canonical 化)。SelectGroupTool は alreadyExpanded 判定で identity (===) を
// 使うため、毎回別 instance を返すと「展開済み」を検出できず無限再帰し、
// fabric の drag state を破壊する (オブジェクトが画面外に飛ぶ・mouseup で
// 選択解除されない等の症状)。WeakMap で fabric.Object が GC されると自動で
// 抜けるのでメモリリークも無い。
const objectHandleCache = new WeakMap<fabric.Object, ObjectHandle & { _obj: fabric.Object }>();
function makeFabricObjectHandle(o: fabric.Object): ObjectHandle & { _obj: fabric.Object } {
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

const toolHost: ToolHost = {
  getActivePath(): PathHandle | null {
    const p = getEditablePath();
    return p ? makeFabricPathHandle(p) : null;
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
    return objs.map(makeFabricObjectHandle);
  },
  getAllObjects(): ReadonlyArray<ObjectHandle> {
    return canvas.getObjects().map(makeFabricObjectHandle);
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
};

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
  const result = tool.onPointerDown(buildPointerInput(e), toolHost);
  if (result !== 'consumed') return;

  e.stopImmediatePropagation();
  e.preventDefault();

  const onMove = (me: MouseEvent) => {
    tool.onPointerMove(buildPointerInput(me), toolHost);
  };
  const onUp = (me: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    tool.onPointerUp(buildPointerInput(me), toolHost);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}, true);

// hover カーソル更新: ドラッグ中はドキュメント level handler が動いているので
// upperCanvas mousemove は idle のときだけツールに通知する。
upperCanvas.addEventListener('mousemove', (e: MouseEvent) => {
  const tool = tools[currentMode];
  if (tool.isDragging()) return;
  tool.onPointerMove(buildPointerInput(e), toolHost);
}, true);

// fabric の mouse:down (fabric の hit-test 後)。TextTool が空き領域クリックで
// IText を生成するのに使う。他ツールは no-op 実装になっている。
canvas.on('mouse:down', (opt) => {
  const w = canvas.getPointer(opt.e as MouseEvent);
  tools[currentMode].onCanvasMouseDown({
    worldX: w.x, worldY: w.y, hasTarget: !!opt.target,
  }, toolHost);
});

// ペンツール (PenAddTool / PenRemoveTool) と関連ヘルパは core/tools/* に抽出済み。
// 上記の DOM mousedown/move dispatcher が現在ツールを呼ぶので、ここに専用 handler は無い。

// 選択イベント: contextTop の overlay クリア → 現ツールの onSelectionChanged
// (黒矢印は groupId 自動展開) → toolbar 同期。
canvas.on('selection:cleared', clearAnchorState);
canvas.on('selection:created', () => {
  clearAnchorState();
  tools[currentMode].onSelectionChanged(toolHost);
  syncToolbarToSelection();
});
canvas.on('selection:updated', () => {
  clearAnchorState();
  tools[currentMode].onSelectionChanged(toolHost);
  syncToolbarToSelection();
});
canvas.on('object:removed', () => {
  // 各ツール内のドラッグ状態は onPointerUp / onDeactivate で解除される。
  // selection:cleared が同時発火する場合 clearAnchorState は上で処理済み。
});

// ── 選択オブジェクトを透過 PNG としてクリップボードにコピー ────────────
//
// Electron のデフォルトメニュー Edit > Copy (role:'copy') は Ctrl+C を
// ネイティブ側で捕捉し document.execCommand('copy') を呼ぶ。
// この結果 DOM に copy イベントが dispatch される（keydown は届かない）。
// そのため copy イベントで捕捉するのが正しいルート。
//
// IText 編集中は fabric 自身のテキストコピーに任せる。

async function copySelectionAsPng(): Promise<void> {
  logger.debug('[copy] copySelectionAsPng called');
  const active = canvas.getActiveObject();
  if (!active) {
    logger.debug('[copy] no active object, skipping');
    return;
  }
  logger.debug(`[copy] active type=${active.type}`);

  try {
    // exportObjectToPngDataUrl は typed wrapper で、toCanvasElement に
    // options オブジェクト ({ multiplier }) を正しく渡すことを型で保証する。
    // 詳細は src/renderer/copy-export.ts の経緯コメント参照。
    const result = exportObjectToPngDataUrl(active as any, 10);
    const dataUrl = result.dataUrl;
    logger.debug(`[copy] dataUrl length=${dataUrl.length} canvas=${result.width}x${result.height}`);

    if (window.electronAPI) {
      await window.electronAPI.copyImageToClipboard(dataUrl);
      showToast('クリップボードにコピーしました');
      logger.info('[copy] image copied to clipboard');
    } else {
      logger.warn('[copy] electronAPI not available');
    }
  } catch (err) {
    logger.error('[copy] failed', err);
    showToast('コピーに失敗しました', true);
  }
}

// メインプロセスのカスタムメニュー Edit > Copy から IPC で通知される
let lastCopyTime = 0;

function doCopy(): void {
  const now = Date.now();
  if (now - lastCopyTime < 200) return;
  lastCopyTime = now;
  void copySelectionAsPng();
}

if (window.electronAPI) {
  window.electronAPI.onMenuCopy(() => {
    logger.debug('[copy] menu-copy IPC received');
    const active = canvas.getActiveObject() as any;
    if (active && !active.isEditing) {
      doCopy();
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
      doCopy();
    }
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') &&
      !isToolbarInput()) {
    menuDeleteSelection();
  }

  // Cmd/Ctrl+Shift+O: 選択中テキストをアウトライン化 (Illustrator 慣例)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
    e.preventDefault();
    void outlineSelection();
  }

  // F12 / Ctrl+Shift+I: DevTools を開閉 (HTML メニューの「開発者ツール」と同等)
  if (e.key === 'F12' ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
    e.preventDefault();
    void window.electronAPI?.toggleDevTools();
  }
});
