// 縦書き (vertical writing) の純粋計算。fabric / DOM 非依存。
//
// fabric は縦書きをサポートしないので、mojiplay では:
//   - 編集中: fabric.Textbox を「1 grapheme = 1 行」に強制折り返しして 1 列に並べる
//     (presenter/fabric-internals.ts の forceOneGraphemePerLine)
//   - 確定後: 1 文字 = 1 fabric.Text (横書きと同じ文字モデル) を列上に配置する
// という形で実現している。本ファイルはその両方が共有する「縦書きでの字形の置き方」
// (回転 / 約物の寄せ) と、確定時の 1 文字の配置座標を持つ。
//
// Canvas 2D には OpenType `vert` feature が無いので、縦書き用字形は近似:
//   - 長音・ダッシュ・括弧・波ダッシュ等は 90° 回転
//   - 句読点 (、。，．) は右上へ寄せる
//   - 小書き仮名は少し右上へ寄せる
// 欧文 (半角英数) は回転せず正立のまま 1em 送り。

import { FABRIC_FONT_SIZE_FRACTION, FABRIC_FONT_SIZE_MULT } from './outline-position';

/** 組み方向。新規テキスト生成時にだけ効く (確定後の文字は通常の fabric.Text)。 */
export type WritingMode = 'horizontal' | 'vertical';

/** 縦書き時の字形変形。dx / dy は em (= fontSize) 単位、angle は度 (時計回り)。 */
export interface VerticalGlyphTransform {
  readonly angle: number;
  readonly dx: number;
  readonly dy: number;
}

const ROTATED_CHARS = new Set(
  Array.from(
    'ー―—–‐-－～〜~…‥＝=' + '（）()「」『』【】〈〉《》［］[]｛｝{}〔〕＜＞<>' + '：:；;→←',
  ),
);

const PUNCTUATION_CHARS = new Set(Array.from('、。，．'));

const SMALL_KANA_CHARS = new Set(
  Array.from('ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ'),
);

const IDENTITY: VerticalGlyphTransform = { angle: 0, dx: 0, dy: 0 };

/** 縦書きで ch をどう置くか。変形不要なら angle=0, dx=dy=0。 */
export function verticalGlyphTransform(ch: string): VerticalGlyphTransform {
  if (ROTATED_CHARS.has(ch)) return { angle: 90, dx: 0, dy: 0 };
  // 横組みで em box の左下にある句読点を右上へ
  if (PUNCTUATION_CHARS.has(ch)) return { angle: 0, dx: 0.5, dy: -0.6 };
  if (SMALL_KANA_CHARS.has(ch)) return { angle: 0, dx: 0.1, dy: -0.1 };
  return IDENTITY;
}

/** 縦書きの 1 文字を置く cell。列は x 方向に columnWidth、行は rowTop から下へ。 */
export interface VerticalCell {
  readonly char: string;
  /** 列の左端 (world)。 */
  readonly columnLeft: number;
  /** 列幅。文字は列の中央に揃える。 */
  readonly columnWidth: number;
  /** この行の上端 (world)。 */
  readonly rowTop: number;
  /** 文字の advance width (= fabric.Text 単体にしたときの width)。 */
  readonly charWidth: number;
  readonly fontSize: number;
}

/** fabric.Text (origin = left/top) として置くための left / top / angle。 */
export interface VerticalPlacement {
  readonly left: number;
  readonly top: number;
  readonly angle: number;
}

/**
 * 回転中心 (= 字面の em box 中心) が baseline からどれだけ上にあるか。
 *
 * fabric.Text の baseline は box 上端から fontSize * 1.13 * (1 - 0.222) ≈ 0.879em。
 * 和文フォントの em box は baseline 上 0.88em / 下 0.12em なので、その中心は
 * ほぼ box 上端 + 0.5em。fabric box (高さ 1.13em) の中心で回すと括弧等が約 0.07em
 * 横にずれるため、em box 中心 (= 上端 + 0.5em) を回転中心にする。
 * 編集中プレビュー (fabric-internals.installGlyphTransform) と確定配置で共有。
 */
export function pivotAboveBaseline(fontSize: number): number {
  return fontSize * (FABRIC_FONT_SIZE_MULT * (1 - FABRIC_FONT_SIZE_FRACTION) - 0.5);
}

/**
 * 縦書き 1 文字の配置を計算する。
 *
 * 字面中心 (box 上端 + 0.5em、pivotAboveBaseline 参照) を「列の中央 × 行の上端 +
 * 0.5em + 寄せ (dx, dy)」に合わせ、回転はその点周りに掛ける。fabric の回転原点は
 * left/top なので、中心 c から left/top = c - R(angle)·(w/2, 0.5em) で逆算する。
 */
export function placeVerticalChar(cell: VerticalCell): VerticalPlacement {
  const { char, columnLeft, columnWidth, rowTop, charWidth, fontSize } = cell;
  const t = verticalGlyphTransform(char);
  const cx = columnLeft + columnWidth / 2 + t.dx * fontSize;
  const cy = rowTop + fontSize / 2 + t.dy * fontSize;
  const rad = (t.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = charWidth / 2;
  const py = fontSize / 2;
  return {
    left: cx - (px * cos - py * sin),
    top: cy - (px * sin + py * cos),
    angle: t.angle,
  };
}
