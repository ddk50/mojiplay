// アウトライン化のコア変換: fabric.Text → fabric.Path
//
// fontkit でフォントファイルを解析し、グリフパスを取得して fabric.Path に
// 差し替える。Illustrator の「アウトライン作成」(Cmd+Shift+O) 相当。
// fontkit は TTC (TrueType Collection) もネイティブ対応しているため Windows の
// 日本語フォント (Meiryo / Yu Gothic / MS Gothic 等) でも動作する。
//
// canvas 操作 (選択・追加削除) を含む outlineSelection / isOutlineable / ボタン
// バインドは app.ts 側に残す。ここは「Text 1 個 → Path 1 個」の純粋寄り変換だけ。
//
// 依存 (cross-file globals):
//   - parseStyle (font-enumeration.ts)
//   - logger (logger.ts)
//   - computeOutlinePathPosition (core/outline-position.ts)

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
  // フォントが該当コードポイントを持っていない場合、fontkit は .notdef
  // (豆腐) glyph を返すので、先に hasGlyphForCodePoint で検出して
  // 失敗扱いにする。例: fontFamily="Arial" で日本語を入力したケース。
  // (ブラウザは描画時にフォールバックフォントで描くが、ft.fontFamily は
  //  Arial のままなので、アウトライン化はそのフォントで実行される)
  if (!font.hasGlyphForCodePoint(cp)) {
    logger.warn(`[outline] ${family}: no glyph for U+${cp.toString(16).padStart(4, '0')} ("${text}")`);
    return null;
  }
  const glyph = font.glyphForCodePoint(cp);
  if (!glyph) {
    logger.warn(`[outline] ${family}: glyphForCodePoint returned null for U+${cp.toString(16).padStart(4, '0')}`);
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
  // (src/core/outline-position.ts, ユニットテストあり)。
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
