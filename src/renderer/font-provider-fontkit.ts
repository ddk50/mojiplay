// FontProvider port の fontkit + window.queryLocalFonts 実装。
//
// system font を browser API (queryLocalFonts) で取得し、blob を fontkit で parse
// してグリフパスを抽出する。fontkit は TTC (TrueType Collection) もネイティブ対応
// しているため Windows の日本語フォント (Meiryo / Yu Gothic / MS Gothic 等) でも動作。
//
// font は (family, weight, italic) 単位でキャッシュ。失敗時も null をキャッシュして
// 再試行コストを避ける。

import type {
  FontProvider,
  GlyphQuery,
  GlyphPathResult,
} from '../usecases/font-provider-interface';
import { parseStyle } from './font-enumeration';
import { logger } from './logger';

export class FontkitFontProvider implements FontProvider {
  private readonly fontCache = new Map<string, Promise<fontkit.Font | null>>();

  async getGlyphPath(q: GlyphQuery): Promise<GlyphPathResult | null> {
    const font = await this.getFont(q.family, q.weight, q.italic);
    if (!font) return null;

    // フォントが該当コードポイントを持っていない場合、fontkit は .notdef (豆腐) glyph
    // を返すので、先に hasGlyphForCodePoint で検出して失敗扱いにする。
    // 例: fontFamily="Arial" で日本語を入力したケース。
    if (!font.hasGlyphForCodePoint(q.codePoint)) {
      logger.warn(
        `[outline] ${q.family}: no glyph for U+${q.codePoint.toString(16).padStart(4, '0')}`,
      );
      return null;
    }
    const glyph = font.glyphForCodePoint(q.codePoint);
    if (!glyph) return null;

    // fontkit のグリフパスは design units (Y-up、baseline=0)。
    // fabric / canvas は pixel + Y-down なので scale(fs/UPM, -fs/UPM) で
    // スケール + Y 反転を同時に行う。
    const scale = q.fontSize / font.unitsPerEm;
    const scaledPath = glyph.path.scale(scale, -scale);
    return {
      pathData: scaledPath.toSVG(),
      bbox: scaledPath.bbox,
    };
  }

  // ── 内部 helper (font 取得 + キャッシュ) ─────────────────────────────────

  private getFont(family: string, weight: number, italic: boolean): Promise<fontkit.Font | null> {
    const key = `${family}|${weight}|${italic}`;
    const cached = this.fontCache.get(key);
    if (cached) return cached;
    const fresh = this.loadFont(family, weight, italic);
    this.fontCache.set(key, fresh);
    return fresh;
  }

  private async loadFont(
    family: string,
    weight: number,
    italic: boolean,
  ): Promise<fontkit.Font | null> {
    const result = await loadFontData(family, weight, italic);
    if (!result) return null;
    try {
      const ab = await result.blob.arrayBuffer();
      const buf = new Uint8Array(ab);

      // fontkit.create(buf, postscriptName) は、
      //   - TTC (先頭 'ttcf')          → サブフォント選択
      //   - 単体フォント (TTF/OTF/...)  → Variable Font のバリエーション選択
      // という 2 つの意味を持つ。単体フォントで postscriptName を渡すと
      // fvar/gvar/CFF2 テーブルが必要になり、通常の Arial 等では throw する。
      // したがって TTC のときだけ postscriptName を渡す。
      const isTTC = buf[0] === 0x74 && buf[1] === 0x74 && buf[2] === 0x63 && buf[3] === 0x66;
      return isTTC ? fontkit.create(buf, result.postscriptName) : fontkit.create(buf);
    } catch (err) {
      logger.error(`[outline] fontkit.create failed for ${family}|${weight}|${italic}`, err);
      return null;
    }
  }
}

// TTC の場合 fontkit.create の第2引数で postscriptName を渡してサブフォントを
// 選択する必要があるため、{blob, postscriptName} の組で返す。
async function loadFontData(
  family: string,
  weight: number,
  italic: boolean,
): Promise<{ blob: Blob; postscriptName: string } | null> {
  if (typeof window.queryLocalFonts !== 'function') return null;
  try {
    const all = await window.queryLocalFonts();
    const sameFamily = all.filter((f) => f.family === family);
    if (sameFamily.length === 0) return null;

    // 1) weight と italic が完全一致するものを優先
    const exact = sameFamily.find((f) => {
      const info = parseStyle(f.style);
      return info.weight === weight && info.italic === italic;
    });
    let pick: FontData | undefined = exact;

    // 2) なければ italic を合わせつつ最も近い weight
    if (!pick) {
      const byDistance = sameFamily
        .map((f) => ({ f, info: parseStyle(f.style) }))
        .filter((x) => x.info.italic === italic)
        .sort((a, b) => Math.abs(a.info.weight - weight) - Math.abs(b.info.weight - weight));
      pick = byDistance[0]?.f ?? sameFamily[0];
    }

    const blob = await pick.blob();
    return { blob, postscriptName: pick.postscriptName };
  } catch (err) {
    logger.error('[outline] loadFontData failed', err);
    return null;
  }
}
