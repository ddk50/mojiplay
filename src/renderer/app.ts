(function () {
  'use strict';

  // ── Logger (IPC → electron-log + DevTools console) ───────────────────────
  const logger = {
    debug: (msg: string) => {
      console.debug(msg);
      void window.electronAPI?.log?.debug(msg);
    },
    info: (msg: string) => {
      console.info(msg);
      void window.electronAPI?.log?.info(msg);
    },
    warn: (msg: string) => {
      console.warn(msg);
      void window.electronAPI?.log?.warn(msg);
    },
    error: (msg: string, err?: unknown) => {
      const stack = err instanceof Error
        ? `\n${err.stack ?? err.message}`
        : (err != null ? `\n${String(err)}` : '');
      const full = msg + stack;
      console.error(full);
      void window.electronAPI?.log?.error(full);
    },
  };

  // ── Custom menu bar (Claude Desktop 風 HTML メニュー) ──────────────────

  function initMenuBar(): void {
    const menuItems = document.querySelectorAll('#menu-bar .menu-item');

    function closeAll(): void {
      menuItems.forEach(mi => mi.classList.remove('is-open'));
    }

    menuItems.forEach(item => {
      const label = item.querySelector('.menu-label');
      if (!label) return;

      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = item.classList.contains('is-open');
        closeAll();
        if (!wasOpen) item.classList.add('is-open');
      });

      // ホバーで切り替え (他メニューが開いている時)
      label.addEventListener('mouseenter', () => {
        const anyOpen = document.querySelector('#menu-bar .menu-item.is-open');
        if (anyOpen && anyOpen !== item) {
          closeAll();
          item.classList.add('is-open');
        }
      });
    });

    // 外クリックで閉じる
    document.addEventListener('click', closeAll);

    // アクション実行
    document.querySelectorAll('#menu-bar .menu-dropdown button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        closeAll();
        handleMenuAction(action || '');
      });
    });
  }

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
        document.execCommand('undo');
        break;
      case 'redo':
        document.execCommand('redo');
        break;
      case 'paste':
        document.execCommand('paste');
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

  initMenuBar();

  // ── Canvas setup ──────────────────────────────────────────────────────────

  const container = document.getElementById('canvas-container') as HTMLDivElement;

  const canvas = new fabric.Canvas('main-canvas', {
    backgroundColor: undefined,
    preserveObjectStacking: true,
    selection: true
  });

  function resizeCanvas(): void {
    canvas.setWidth(container.clientWidth);
    canvas.setHeight(container.clientHeight);
    canvas.renderAll();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ── Toolbar references ────────────────────────────────────────────────────

  const fontFamilySel      = document.getElementById('font-family')          as HTMLSelectElement;
  const fontStyleSel       = document.getElementById('font-style')            as HTMLSelectElement;
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

  // ── システムフォント列挙 (Local Font Access API) ──────────────────────────
  // Electron 29 / Chromium 122+ に標準搭載。main 側で local-fonts 権限を許可済み。
  // 取得失敗時は index.html のフォールバック Arial / Regular がそのまま残る。

  type StyleInfo = { label: string; weight: number; italic: boolean };

  const WEIGHT_MAP: Record<string, number> = {
    thin: 100, hairline: 100,
    extralight: 200, ultralight: 200,
    light: 300,
    '': 400, normal: 400, regular: 400, book: 400,
    medium: 500,
    semibold: 600, demibold: 600,
    bold: 700,
    extrabold: 800, ultrabold: 800,
    black: 900, heavy: 900,
  };

  function parseStyle(s: string): StyleInfo {
    const lower = s.toLowerCase();
    const italic = /italic|oblique/.test(lower);
    const key = lower.replace(/italic|oblique/g, '').replace(/\s+/g, '');
    const weight = WEIGHT_MAP[key] ?? 400;
    return { label: s || 'Regular', weight, italic };
  }

  const fontsByFamily = new Map<string, StyleInfo[]>();

  function styleValue(weight: number, italic: boolean): string {
    return `${weight}|${italic ? 'italic' : 'normal'}`;
  }

  function populateStyleList(family: string): void {
    const styles = fontsByFamily.get(family);
    const previous = fontStyleSel.value;
    fontStyleSel.innerHTML = '';

    const list: StyleInfo[] = (styles && styles.length > 0)
      ? styles
      : [{ label: 'Regular', weight: 400, italic: false }];

    for (const s of list) {
      const opt = document.createElement('option');
      opt.value = styleValue(s.weight, s.italic);
      opt.textContent = s.label;
      fontStyleSel.appendChild(opt);
    }

    const values = list.map(s => styleValue(s.weight, s.italic));
    if (values.includes(previous)) {
      fontStyleSel.value = previous;
    } else {
      const regular = styleValue(400, false);
      fontStyleSel.value = values.includes(regular) ? regular : values[0];
    }
  }

  async function populateFontList(): Promise<void> {
    if (typeof window.queryLocalFonts !== 'function') return;
    try {
      const fonts = await window.queryLocalFonts();
      if (!fonts.length) return;

      fontsByFamily.clear();
      for (const f of fonts) {
        const info = parseStyle(f.style);
        let arr = fontsByFamily.get(f.family);
        if (!arr) { arr = []; fontsByFamily.set(f.family, arr); }
        if (!arr.some(x => x.weight === info.weight && x.italic === info.italic)) {
          arr.push(info);
        }
      }
      for (const arr of fontsByFamily.values()) {
        arr.sort((a, b) => (a.weight - b.weight) || (Number(a.italic) - Number(b.italic)));
      }

      const families = Array.from(fontsByFamily.keys())
        .sort((a, b) => a.localeCompare(b, 'ja'));

      const previous = fontFamilySel.value;
      fontFamilySel.innerHTML = '';
      for (const family of families) {
        const opt = document.createElement('option');
        opt.value = family;
        opt.textContent = family;
        fontFamilySel.appendChild(opt);
      }
      fontFamilySel.value = families.includes(previous) ? previous : families[0];
      populateStyleList(fontFamilySel.value);
    } catch (err) {
      logger.error('[fonts] queryLocalFonts failed', err);
    }
  }
  populateFontList();

  // ── Snap state (select-char モード専用) ──────────────────────────────────

  let snapEnabled   = snapEnabledInput.checked;
  let snapPitch     = Math.max(1, parseInt(snapPitchInput.value, 10)     || 8);
  let snapThreshold = Math.max(1, parseInt(snapThresholdInput.value, 10) || 5);

  snapEnabledInput.addEventListener('change', () => {
    snapEnabled = snapEnabledInput.checked;
  });
  snapPitchInput.addEventListener('input', () => {
    snapPitch = Math.max(1, parseInt(snapPitchInput.value, 10) || 8);
  });
  snapThresholdInput.addEventListener('input', () => {
    snapThreshold = Math.max(1, parseInt(snapThresholdInput.value, 10) || 5);
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
    currentMode = m;
    (Object.keys(modeButtons) as Mode[]).forEach(k => {
      modeButtons[k].classList.toggle('is-active', k === m);
    });

    const isSelectMode = m === 'select-group' || m === 'select-char';
    const isPenMode    = m === 'pen-add' || m === 'pen-remove';
    canvas.selection     = isSelectMode;
    canvas.defaultCursor = m === 'text' ? 'text' : 'default';
    canvas.hoverCursor   = m === 'text' ? 'text' : 'move';

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

  // ── Text placement (mouse:down on canvas) ─────────────────────────────────

  canvas.on('mouse:down', (opt) => {
    if (currentMode !== 'text') return;
    if (opt.target) return;

    const p = canvas.getPointer(opt.e as MouseEvent);

    const { fontWeight, fontStyle } = currentFontStyle();
    const it = new fabric.IText('', {
      left:       p.x,
      top:        p.y,
      fontFamily: fontFamilySel.value,
      fontSize:   parseInt(fontSizeInput.value, 10) || 72,
      fontWeight,
      fontStyle,
      fill:       fontColorInput.value,
      selectable: true,
      evented:    true,
    });

    canvas.add(it);
    canvas.setActiveObject(it);
    it.enterEditing();
    (it as any).hiddenTextarea?.focus();
  });

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

  // ── グループ選択の自動展開（黒矢印モード）────────────────────────────────

  function expandSelectionToGroup(): void {
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection') return;

    const gid = (active as any).data?.groupId;
    if (!gid) return;

    const groupObjs = canvas.getObjects().filter(o => (o as any).data?.groupId === gid);
    if (groupObjs.length <= 1) return;

    canvas.discardActiveObject();
    const sel = new fabric.ActiveSelection(groupObjs, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
  }

  // selection:created / selection:updated は後段のアンカー編集セクションで
  // clearAnchorState + expandSelectionToGroup + syncToolbarToSelection を
  // まとめて登録している。

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

  // ── Snap on move (白矢印モード専用) ──────────────────────────────────────

  canvas.on('object:moving', (e: fabric.IEvent) => {
    if (currentMode !== 'select-char') return;
    if (!snapEnabled) return;

    const mouseEvt = e.e as MouseEvent | undefined;
    if (mouseEvt?.altKey) return; // Alt 押下中は一時バイパス

    const target = e.target;
    if (!target) return;

    // X 軸: 等間隔グリッドに sticky snap
    const freeX    = target.left ?? 0;
    const nearestX = Math.round(freeX / snapPitch) * snapPitch;
    if (Math.abs(freeX - nearestX) < snapThreshold) {
      target.set({ left: nearestX });
    }

    // Y 軸: 等間隔グリッドに sticky snap (X と同ロジック)
    const freeY    = target.top ?? 0;
    const nearestY = Math.round(freeY / snapPitch) * snapPitch;
    if (Math.abs(freeY - nearestY) < snapThreshold) {
      target.set({ top: nearestY });
    }

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

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(message: string, isError = false): void {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── アウトライン化: fabric.Text → fabric.Path ──────────────────────────────
  // fontkit でフォントファイルを解析し、グリフパスを取得して fabric.Path に
  // 差し替える。Illustrator の「アウトライン作成」(Cmd+Shift+O) 相当。
  // fontkit は TTC (TrueType Collection) もネイティブ対応しているため Windows の
  // 日本語フォント (Meiryo / Yu Gothic / MS Gothic 等) でも動作する。
  // Phase 1 は変換のみ。アンカー編集は Phase 2 で実装予定のため、今は generic な
  // fabric.Path として扱う (移動・回転・選択は既存ロジックで動く)。

  // family|weight|italic をキーに fontkit.Font をキャッシュ。失敗時も null を
  // キャッシュして再試行のコストを避ける。
  const fontkitFontCache = new Map<string, Promise<fontkit.Font | null>>();

  // TTC の場合 fontkit.create の第2引数で postscriptName を渡してサブフォントを
  // 選択する必要があるため、{blob, postscriptName} の組で返す。
  async function loadFontData(
    family: string, weight: number, italic: boolean
  ): Promise<{ blob: Blob; postscriptName: string } | null> {
    if (typeof window.queryLocalFonts !== 'function') return null;
    try {
      const all = await window.queryLocalFonts();
      const sameFamily = all.filter(f => f.family === family);
      if (sameFamily.length === 0) return null;

      // 1) weight と italic が完全一致するものを優先
      const exact = sameFamily.find(f => {
        const info = parseStyle(f.style);
        return info.weight === weight && info.italic === italic;
      });
      let pick: FontData | undefined = exact;

      // 2) なければ italic を合わせつつ最も近い weight
      if (!pick) {
        const byDistance = sameFamily
          .map(f => ({ f, info: parseStyle(f.style) }))
          .filter(x => x.info.italic === italic)
          .sort((a, b) =>
            Math.abs(a.info.weight - weight) - Math.abs(b.info.weight - weight));
        pick = byDistance[0]?.f ?? sameFamily[0];
      }

      const blob = await pick.blob();
      return { blob, postscriptName: pick.postscriptName };
    } catch (err) {
      logger.error('[outline] loadFontData failed', err);
      return null;
    }
  }

  function getFontkitFont(
    family: string, weight: number, italic: boolean
  ): Promise<fontkit.Font | null> {
    const key = `${family}|${weight}|${italic}`;
    const cached = fontkitFontCache.get(key);
    if (cached) return cached;
    const fresh = (async () => {
      const result = await loadFontData(family, weight, italic);
      if (!result) return null;
      try {
        const ab = await result.blob.arrayBuffer();
        const buf = new Uint8Array(ab);

        // fontkit.create(buf, postscriptName) は、
        //   - TTC (先頭 'ttcf')          → サブフォント選択
        //   - 単体フォント (TTF/OTF/...)  → Variable Font のバリエーション選択
        // という 2 つの意味を持つ。単体フォントで postscriptName を渡すと
        // fvar/gvar/CFF2 テーブルが必要になり、通常の Arial 等では throw
        // する。したがって TTC のときだけ postscriptName を渡す。
        const isTTC = buf[0] === 0x74 && buf[1] === 0x74 &&
                      buf[2] === 0x63 && buf[3] === 0x66;
        return isTTC
          ? fontkit.create(buf, result.postscriptName)
          : fontkit.create(buf);
      } catch (err) {
        logger.error(`[outline] fontkit.create failed for ${key}`, err);
        return null;
      }
    })();
    fontkitFontCache.set(key, fresh);
    return fresh;
  }

  async function outlineTextToPath(ft: fabric.Text): Promise<fabric.Path | null> {
    const text = ft.text || '';
    if (!text.trim()) return null;

    const family     = ft.fontFamily || 'Arial';
    const rawWeight  = ft.fontWeight;
    const weight     = typeof rawWeight === 'number'
      ? rawWeight
      : (String(rawWeight).toLowerCase() === 'bold' ? 700 : 400);
    const italic     = ft.fontStyle === 'italic';
    const fontSize   = (ft.fontSize as number) || 72;

    const font = await getFontkitFont(family, weight, italic);
    if (!font) return null;

    // 単文字前提 (commitIText で 1 文字ごとに分割済み)
    const cp = text.codePointAt(0);
    if (cp === undefined) return null;
    const glyph = font.glyphForCodePoint(cp);
    if (!glyph) {
      logger.warn(`[outline] ${family}: no glyph for U+${cp.toString(16).padStart(4, '0')}`);
      return null;
    }

    // fontkit のグリフパスは design units (Y-up、baseline=0)。
    // fabric / canvas は pixel + Y-down なので scale(fs/UPM, -fs/UPM) で
    // スケール + Y 反転を同時に行う。結果のパスは opentype.js と同じ座標系
    // (baseline=0、ascender=負値、descender=正値) になる。
    const scale = fontSize / font.unitsPerEm;
    const scaledPath = glyph.path.scale(scale, -scale);
    const pathData = scaledPath.toSVG();
    const bb = scaledPath.bbox; // { minX, minY, maxX, maxY }

    // 位置計算は純粋関数 computeOutlinePathPosition に切り出し済み
    // (src/renderer/outline-position.ts, ユニットテストあり)。
    const { left: pathLeft, top: pathTop } = computeOutlinePathPosition(
      {
        left:             ft.left ?? 0,
        top:              ft.top  ?? 0,
        fontSize,
        fontSizeMult:     (ft as any)._fontSizeMult,
        fontSizeFraction: (ft as any)._fontSizeFraction,
      },
      { minX: bb.minX, minY: bb.minY },
    );

    const ftRect = ft.getBoundingRect(true, true);
    logger.debug(
      `[outline] char="${text}" cp=U+${cp.toString(16).padStart(4, '0')}` +
      ` ft=(${ft.left},${ft.top}) fontSize=${fontSize}` +
      ` ft.width=${ft.width} ft.height=${ft.height}` +
      ` ft.boundingRect=(${ftRect.left.toFixed(2)},${ftRect.top.toFixed(2)},${ftRect.width.toFixed(2)},${ftRect.height.toFixed(2)})` +
      ` bb=(${bb.minX.toFixed(2)},${bb.minY.toFixed(2)},${bb.maxX.toFixed(2)},${bb.maxY.toFixed(2)})` +
      ` → path=(${pathLeft.toFixed(2)},${pathTop.toFixed(2)})`
    );

    const sx = (ft.scaleX as number) ?? 1;
    const sy = (ft.scaleY as number) ?? 1;
    const origData = (ft as any).data || {};

    // NOTE: angle != 0 の場合、fabric.Path は ink bbox 中心を pivot に回転するため
    // 元の fabric.Text (text bbox 中心 pivot) とズレが生じる。Phase 2 で修正予定。
    const p = new fabric.Path(pathData, {
      left:        pathLeft,
      top:         pathTop,
      fill:        ft.fill,
      angle:       ft.angle,
      scaleX:      sx,
      scaleY:      sy,
      selectable:  ft.selectable,
      evented:     ft.evented,
      hasControls: false,
      hasBorders:  true,
    } as fabric.IPathOptions);
    (p as any).data = { ...origData, outlined: true };

    // デバッグ: fabric が実際に保持している値をダンプ。
    const po = (p as any).pathOffset;
    const rect = p.getBoundingRect(true, true);
    logger.debug(
      `[outline] fabric.Path post-init: p.left=${p.left} p.top=${p.top}` +
      ` p.width=${p.width} p.height=${p.height}` +
      ` pathOffset=(${po?.x},${po?.y})` +
      ` originX=${p.originX} originY=${p.originY}` +
      ` boundingRect=(${rect.left.toFixed(2)},${rect.top.toFixed(2)},${rect.width.toFixed(2)},${rect.height.toFixed(2)})`
    );

    return p;
  }

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
    const failedFamilies = new Set(
      conversions.filter(x => !x.path).map(x => x.ft.fontFamily || '?')
    );

    if (succeeded.length === 0) {
      showToast(`アウトライン化失敗: ${Array.from(failedFamilies).join(', ')}`, true);
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

    if (failedFamilies.size > 0) {
      showToast(`一部失敗: ${Array.from(failedFamilies).join(', ')}`, true);
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

  const ANCHOR_MARKER_PX  = 7;
  const ANCHOR_HIT_RADIUS = 6;
  const ANCHOR_FILL       = '#ffffff';
  const ANCHOR_STROKE     = '#0066ff';

  const HANDLE_LINE_COLOR = '#0066ff';
  const HANDLE_LINE_WIDTH = 1;
  const HANDLE_CIRCLE_R   = 4;
  const HANDLE_FILL       = '#ffffff';
  const HANDLE_STROKE     = '#0066ff';
  const HANDLE_HIT_RADIUS = 5;

  interface AnchorScreenPos { anchorIndex: number; sx: number; sy: number }
  let anchorScreenCache: AnchorScreenPos[] = [];

  interface HandleScreenPos {
    anchorIndex: number;
    which: 'in' | 'out';
    handle: HandleRef;
    sx: number;
    sy: number;
  }
  let handleScreenCache: HandleScreenPos[] = [];

  interface AnchorDragState {
    pathObj: fabric.Path;
    anchorIndex: number;
    startPath: PathCommand[];
    lastPointer: { x: number; y: number };
  }
  let anchorDrag: AnchorDragState | null = null;

  interface HandleDragState {
    pathObj: fabric.Path;
    handle: HandleRef;
    startPath: PathCommand[];
    lastPointer: { x: number; y: number };
  }
  let handleDrag: HandleDragState | null = null;

  function getEditablePath(): fabric.Path | null {
    if (currentMode !== 'select-char' && currentMode !== 'pen-add' && currentMode !== 'pen-remove') return null;
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'path') return null;
    if (!(obj as any).data?.outlined) return null;
    return obj as fabric.Path;
  }

  function anchorLocalToScreen(
    ax: number, ay: number, path: fabric.Path,
  ): { sx: number; sy: number } {
    const po = (path as any).pathOffset as { x: number; y: number };
    const mat = path.calcTransformMatrix();
    const vt = canvas.viewportTransform!;
    const world = fabric.util.transformPoint(
      { x: ax - po.x, y: ay - po.y } as fabric.Point,
      mat,
    );
    const screen = fabric.util.transformPoint(world, vt);
    return { sx: screen.x, sy: screen.y };
  }

  function drawAnchorOverlay(): void {
    const ctx = (canvas as any).contextTop as CanvasRenderingContext2D;
    if (ctx) canvas.clearContext(ctx);

    const path = getEditablePath();
    if (!path || !ctx) {
      anchorScreenCache = [];
      handleScreenCache = [];
      return;
    }

    const rawCmds = (path as any).path as ReadonlyArray<ReadonlyArray<unknown>> | undefined;
    if (!rawCmds) { anchorScreenCache = []; handleScreenCache = []; return; }
    const cmds = fromFabricPath(rawCmds);

    const anchors = extractAnchors(cmds);
    const half = ANCHOR_MARKER_PX / 2;
    const aCache: AnchorScreenPos[] = [];
    const hCache: HandleScreenPos[] = [];

    // アンカーのスクリーン座標を先に全計算
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const { sx, sy } = anchorLocalToScreen(a.point.x, a.point.y, path);
      aCache.push({ anchorIndex: i, sx, sy });
    }

    // ハンドルのスクリーン座標を計算
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.incomingHandle) {
        const h = a.incomingHandle;
        const hp = getHandlePoint(cmds[h.cmdIndex], h);
        if (hp) {
          const { sx, sy } = anchorLocalToScreen(hp.x, hp.y, path);
          hCache.push({ anchorIndex: i, which: 'in', handle: h, sx, sy });
        }
      }
      if (a.outgoingHandle) {
        const h = a.outgoingHandle;
        const hp = getHandlePoint(cmds[h.cmdIndex], h);
        if (hp) {
          const { sx, sy } = anchorLocalToScreen(hp.x, hp.y, path);
          hCache.push({ anchorIndex: i, which: 'out', handle: h, sx, sy });
        }
      }
    }

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

    anchorScreenCache = aCache;
    handleScreenCache = hCache;
  }

  canvas.on('after:render', drawAnchorOverlay);

  function hitTestAnchor(screenX: number, screenY: number): number {
    let bestIdx = -1;
    let bestDist = ANCHOR_HIT_RADIUS + 1;
    for (const a of anchorScreenCache) {
      const dx = screenX - a.sx;
      const dy = screenY - a.sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = a.anchorIndex;
      }
    }
    return bestIdx;
  }

  function hitTestHandle(screenX: number, screenY: number): HandleScreenPos | null {
    let best: HandleScreenPos | null = null;
    let bestDist = HANDLE_HIT_RADIUS + 1;
    for (const h of handleScreenCache) {
      const dx = screenX - h.sx;
      const dy = screenY - h.sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = h;
      }
    }
    return best;
  }

  function clearAnchorState(): void {
    anchorDrag = null;
    handleDrag = null;
    anchorScreenCache = [];
    handleScreenCache = [];
    const ctx = (canvas as any).contextTop as CanvasRenderingContext2D;
    if (ctx) canvas.clearContext(ctx);
  }

  // ── 共通ヘルパー ────────────────────────────────────────────────────

  /** ワールド座標デルタ → パスローカル座標デルタ変換 */
  function worldToLocalDelta(
    pathObj: fabric.Path, worldDx: number, worldDy: number,
  ): { dx: number; dy: number } {
    const mat = pathObj.calcTransformMatrix();
    const inv = fabric.util.invertTransform(mat);
    return {
      dx: inv[0] * worldDx + inv[2] * worldDy,
      dy: inv[1] * worldDx + inv[3] * worldDy,
    };
  }

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

  // DOM capture で fabric の mousedown より先にヒットテストを行う。
  // ヒットした場合は stopImmediatePropagation で fabric に渡さない。
  const upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;

  upperCanvas.addEventListener('mousedown', (e: MouseEvent) => {
    // ペンモードではドラッグではなくペンツール側で処理する
    if (currentMode === 'pen-add' || currentMode === 'pen-remove') return;

    const path = getEditablePath();
    if (!path) return;

    const rect = upperCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // ヒットテスト: ハンドル優先 → アンカー
    const hitHandle = hitTestHandle(screenX, screenY);
    const hitAnchor = hitHandle ? -1 : hitTestAnchor(screenX, screenY);
    if (!hitHandle && hitAnchor < 0) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    const startPath = fromFabricPath((path as any).path as ReadonlyArray<ReadonlyArray<unknown>>);
    const lastPointer = canvas.getPointer(e);

    if (hitHandle) {
      // ── ハンドル (制御点) ドラッグ ──────────────────────────────
      handleDrag = {
        pathObj: path,
        handle: hitHandle.handle,
        startPath,
        lastPointer,
      };

      const onMove = (me: MouseEvent) => {
        if (!handleDrag) return;
        const pointer = canvas.getPointer(me);
        const worldDx = pointer.x - handleDrag.lastPointer.x;
        const worldDy = pointer.y - handleDrag.lastPointer.y;
        const local = worldToLocalDelta(handleDrag.pathObj, worldDx, worldDy);

        const curPath = fromFabricPath((handleDrag.pathObj as any).path);
        const newPath = moveHandle(curPath, handleDrag.handle, local.dx, local.dy);
        (handleDrag.pathObj as any).path = toFabricPath(newPath);
        (handleDrag.pathObj as any).dirty = true;
        handleDrag.lastPointer = pointer;
        canvas.requestRenderAll();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (handleDrag) {
          finalizeDrag(handleDrag.pathObj);
          handleDrag = null;
        }
        canvas.requestRenderAll();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    } else {
      // ── アンカードラッグ (既存) ────────────────────────────────
      anchorDrag = {
        pathObj: path,
        anchorIndex: hitAnchor,
        startPath,
        lastPointer,
      };

      const onMove = (me: MouseEvent) => {
        if (!anchorDrag) return;
        const pointer = canvas.getPointer(me);
        const worldDx = pointer.x - anchorDrag.lastPointer.x;
        const worldDy = pointer.y - anchorDrag.lastPointer.y;
        const local = worldToLocalDelta(anchorDrag.pathObj, worldDx, worldDy);

        const curPath = fromFabricPath((anchorDrag.pathObj as any).path);
        const newPath = moveAnchorRigid(curPath, anchorDrag.anchorIndex, local.dx, local.dy);
        (anchorDrag.pathObj as any).path = toFabricPath(newPath);
        (anchorDrag.pathObj as any).dirty = true;
        anchorDrag.lastPointer = pointer;
        canvas.requestRenderAll();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (anchorDrag) {
          finalizeDrag(anchorDrag.pathObj);
          anchorDrag = null;
        }
        canvas.requestRenderAll();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  }, true);

  // ホバー時のカーソル変更
  upperCanvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (anchorDrag || handleDrag) return;
    const path = getEditablePath();
    if (!path) {
      upperCanvas.style.cursor = '';
      return;
    }
    const rect = upperCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const hHit = hitTestHandle(screenX, screenY);
    if (hHit) { upperCanvas.style.cursor = 'pointer'; return; }
    const aidx = hitTestAnchor(screenX, screenY);
    upperCanvas.style.cursor = aidx >= 0 ? 'move' : '';
  }, true);

  // ── +/- ペンツール ──────────────────────────────────────────────────────

  const PEN_HIT_THRESHOLD = 8; // セグメントヒットの画面ピクセル閾値
  const PEN_SAMPLES       = 50; // セグメントあたりのサンプル数

  /** スクリーン座標 → パスローカル座標 */
  function screenToPathLocal(
    screenX: number, screenY: number, path: fabric.Path,
  ): { x: number; y: number } {
    const vt = canvas.viewportTransform!;
    const invVt = fabric.util.invertTransform(vt);
    const world = fabric.util.transformPoint(
      { x: screenX, y: screenY } as fabric.Point, invVt,
    );
    const mat = path.calcTransformMatrix();
    const invMat = fabric.util.invertTransform(mat);
    const local = fabric.util.transformPoint(world, invMat);
    const po = (path as any).pathOffset as { x: number; y: number };
    return { x: local.x + po.x, y: local.y + po.y };
  }

  interface SegmentHit {
    cmdIndex: number;
    t: number;
    dist: number;
  }

  /** パス上の最近傍セグメントを探索 (スクリーン座標ベースの距離比較) */
  function findClosestSegment(
    path: fabric.Path, screenX: number, screenY: number,
  ): SegmentHit | null {
    const rawCmds = (path as any).path as ReadonlyArray<ReadonlyArray<unknown>> | undefined;
    if (!rawCmds) return null;
    const cmds = fromFabricPath(rawCmds);

    let best: SegmentHit | null = null;
    let cur: Point = { x: 0, y: 0 };

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];

      if (cmd.type === 'M') { cur = cmd.to; continue; }
      if (cmd.type === 'Z') { continue; }

      for (let s = 0; s <= PEN_SAMPLES; s++) {
        const t = s / PEN_SAMPLES;
        let p: Point;

        if (cmd.type === 'C') {
          p = evalCubicAt(cur, cmd.c1, cmd.c2, cmd.to, t);
        } else if (cmd.type === 'Q') {
          p = evalQuadAt(cur, cmd.c, cmd.to, t);
        } else {
          // L
          p = { x: cur.x + t * (cmd.to.x - cur.x), y: cur.y + t * (cmd.to.y - cur.y) };
        }

        const scr = anchorLocalToScreen(p.x, p.y, path);
        const d = Math.hypot(scr.sx - screenX, scr.sy - screenY);
        if (d < PEN_HIT_THRESHOLD && (!best || d < best.dist)) {
          best = { cmdIndex: i, t, dist: d };
        }
      }

      // 現在点を更新 (C/Q/L はすべて .to を持つ)
      cur = cmd.to;
    }

    return best;
  }

  // +ペンツール: セグメント上クリックでアンカー追加
  // -ペンツール: アンカー上クリックでアンカー削除
  upperCanvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (currentMode !== 'pen-add' && currentMode !== 'pen-remove') return;

    const path = getEditablePath();
    if (!path) return;

    const rect = upperCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (currentMode === 'pen-add') {
      const hit = findClosestSegment(path, screenX, screenY);
      if (!hit) return;

      e.stopImmediatePropagation();
      e.preventDefault();

      const cmds = fromFabricPath((path as any).path as ReadonlyArray<ReadonlyArray<unknown>>);
      const origCmd = cmds[hit.cmdIndex];
      const origCmdType = origCmd.type;
      const newPath = splitSegment(cmds, hit.cmdIndex, hit.t);
      (path as any).path = toFabricPath(newPath);
      (path as any).dirty = true;

      logger.debug(`[pen-add] origCmdType=${origCmdType} cmdIndex=${hit.cmdIndex} t=${hit.t}`);

      // 新アンカーの位置 (分割で生成された first half の終点)。
      // splitSegment は M/Z に対しては分割せず元配列を返すので、ここでの type は C/Q/L のいずれか。
      const firstCmd = newPath[hit.cmdIndex];
      if (firstCmd.type !== 'C' && firstCmd.type !== 'Q' && firstCmd.type !== 'L') return;
      const anchorPt = firstCmd.to;
      const anchorX = anchorPt.x, anchorY = anchorPt.y;
      const secondIdx = hit.cmdIndex + 1;

      // L→C 変換用: 前後のアンカー位置を記録
      const prevPt = getSegmentStart(newPath, hit.cmdIndex);
      const nextCmd = newPath[secondIdx];
      if (nextCmd.type !== 'C' && nextCmd.type !== 'Q' && nextCmd.type !== 'L') return;
      const prevX = prevPt ? prevPt.x : anchorX;
      const prevY = prevPt ? prevPt.y : anchorY;
      const nextX = nextCmd.to.x;
      const nextY = nextCmd.to.y;

      logger.debug(`[pen-add] drag mode. anchor=(${anchorX.toFixed(1)},${anchorY.toFixed(1)}) prev=(${prevX.toFixed(1)},${prevY.toFixed(1)}) next=(${nextX.toFixed(1)},${nextY.toFixed(1)})`);

      const onMove = (me: MouseEvent) => {
        const r = upperCanvas.getBoundingClientRect();
        const mx = me.clientX - r.left;
        const my = me.clientY - r.top;
        const local = screenToPathLocal(mx, my, path);
        const dx = local.x - anchorX;
        const dy = local.y - anchorY;
        logger.debug(`[pen-add:onMove] delta=(${dx.toFixed(1)},${dy.toFixed(1)})`);

        const curPath = fromFabricPath((path as any).path);
        const updated: PathCommand[] = curPath.slice();

        const curFirst = curPath[hit.cmdIndex];
        const curSecond = curPath[secondIdx];

        // 全セグメントタイプ共通: C コマンドでハンドルを設定。
        // L/Q を分割した場合は C に変換してからハンドルを付与。
        // 元が C ならその c1/c2 を保ち、それ以外は3等分点でデフォルトハンドルを生成。
        const firstC1: Point = origCmdType === 'C' && curFirst.type === 'C'
          ? curFirst.c1
          : { x: prevX + (anchorX - prevX) / 3, y: prevY + (anchorY - prevY) / 3 };
        updated[hit.cmdIndex] = {
          type: 'C',
          c1: firstC1,
          c2: { x: anchorX - dx, y: anchorY - dy },
          to: { x: anchorX, y: anchorY },
        };

        const secondC2: Point = origCmdType === 'C' && curSecond.type === 'C'
          ? curSecond.c2
          : { x: anchorX + 2 * (nextX - anchorX) / 3, y: anchorY + 2 * (nextY - anchorY) / 3 };
        updated[secondIdx] = {
          type: 'C',
          c1: { x: anchorX + dx, y: anchorY + dy },
          c2: secondC2,
          to: { x: nextX, y: nextY },
        };

        (path as any).path = toFabricPath(updated);
        (path as any).dirty = true;
        canvas.requestRenderAll();
      };

      const onUp = () => {
        logger.debug('[pen-add:onUp] mouseup fired');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        finalizeDrag(path);
        canvas.requestRenderAll();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      canvas.requestRenderAll();

    } else {
      // pen-remove: アンカーのヒットテスト
      const aidx = hitTestAnchor(screenX, screenY);
      if (aidx < 0) return;

      e.stopImmediatePropagation();
      e.preventDefault();

      const cmds = fromFabricPath((path as any).path as ReadonlyArray<ReadonlyArray<unknown>>);
      const newPath = removeAnchor(cmds, aidx);

      // removeAnchor が操作を拒否した場合 (アンカー数不足) は長さが同じ
      if (newPath.length === cmds.length) return;

      (path as any).path = toFabricPath(newPath);
      (path as any).dirty = true;
      finalizeDrag(path);
      canvas.requestRenderAll();
    }
  }, true);

  // ペンモードのホバーカーソル
  upperCanvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (currentMode !== 'pen-add' && currentMode !== 'pen-remove') return;

    const path = getEditablePath();
    if (!path) {
      upperCanvas.style.cursor = '';
      return;
    }

    const rect = upperCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (currentMode === 'pen-add') {
      const hit = findClosestSegment(path, screenX, screenY);
      upperCanvas.style.cursor = hit ? 'copy' : '';
    } else {
      const aidx = hitTestAnchor(screenX, screenY);
      upperCanvas.style.cursor = aidx >= 0 ? 'pointer' : '';
    }
  }, true);

  // モード・選択変更時のクリーンアップ
  canvas.on('selection:cleared', clearAnchorState);
  canvas.on('selection:created', () => {
    clearAnchorState();
    if (currentMode === 'select-group') expandSelectionToGroup();
    syncToolbarToSelection();
  });
  canvas.on('selection:updated', () => {
    clearAnchorState();
    if (currentMode === 'select-group') expandSelectionToGroup();
    syncToolbarToSelection();
  });
  canvas.on('object:removed', (e: fabric.IEvent) => {
    if ((anchorDrag && e.target === anchorDrag.pathObj) ||
        (handleDrag && e.target === handleDrag.pathObj)) {
      clearAnchorState();
    }
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
  });

})();
