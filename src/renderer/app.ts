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

  type Mode = 'select-group' | 'select-char' | 'text';
  let currentMode: Mode = 'select-group';

  const modeButtons: Record<Mode, HTMLButtonElement> = {
    'select-group': btnModeSelectGroup,
    'select-char':  btnModeSelectChar,
    'text':         btnModeText,
  };

  function setMode(m: Mode): void {
    currentMode = m;
    (Object.keys(modeButtons) as Mode[]).forEach(k => {
      modeButtons[k].classList.toggle('is-active', k === m);
    });

    const isSelectMode = m === 'select-group' || m === 'select-char';
    canvas.selection     = isSelectMode;
    canvas.defaultCursor = m === 'text' ? 'text' : 'default';
    canvas.hoverCursor   = m === 'text' ? 'text' : 'move';

    canvas.forEachObject(o => {
      o.selectable = isSelectMode;
      o.evented    = isSelectMode;
    });

    if (!isSelectMode) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  btnModeSelectGroup.addEventListener('click', () => setMode('select-group'));
  btnModeSelectChar.addEventListener('click',  () => setMode('select-char'));
  btnModeText.addEventListener('click',        () => setMode('text'));

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

  canvas.on('selection:created', () => {
    if (currentMode === 'select-group') expandSelectionToGroup();
    syncToolbarToSelection();
  });

  canvas.on('selection:updated', () => {
    if (currentMode === 'select-group') expandSelectionToGroup();
    syncToolbarToSelection();
  });

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

  // ── Select all ────────────────────────────────────────────────────────────

  (document.getElementById('btn-select-all') as HTMLButtonElement).addEventListener('click', () => {
    canvas.discardActiveObject();
    const all = canvas.getObjects();
    if (!all.length) return;
    const sel = new fabric.ActiveSelection(all, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
  });

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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // IText 編集中は Fabric に任せる
    const active = canvas.getActiveObject() as any;
    if (active && active.isEditing) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        document.activeElement === document.body) {
      const selected = canvas.getActiveObjects();
      selected.forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }

    // Cmd/Ctrl+Shift+O: 選択中テキストをアウトライン化 (Illustrator 慣例)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      void outlineSelection();
    }
  });

})();
