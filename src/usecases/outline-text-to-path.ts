// アウトライン化 use case: テキスト 1 文字 → outlined path spec。
//
// このアプリの中核 use case (CLAUDE.md「最終目標」: テキストをアウトライン化して
// パスにしてから形をいじる)。framework (fontkit / fabric.Path) には FontProvider
// port + 戻り値の OutlinedPathSpec data type を介して触らない。
//
// caller (renderer/state.ts) が:
//   1. fabric.Text から OutlineTextProps を抽出
//   2. この use case を呼んで OutlinedPathSpec を得る
//   3. spec から fabric.Path を構築して canvas に add
// という分担。

import type { FontProvider } from './font-provider-interface';
import { computeOutlinePathPosition } from '../core/outline-position';

/** 入力: 元 fabric.Text から抽出した outline 化に必要なプロパティ群。 */
export interface OutlineTextProps {
  /** 単文字想定 (commitIText が分割済み)。複数文字なら先頭 codePoint で処理する。 */
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly fontFamily: string;
  /** number または 'bold' / 'normal' 等の文字列 (use case 内で正規化)。 */
  readonly fontWeight: number | string | undefined;
  readonly fontStyle: string | undefined;
  readonly fontSize: number;
  readonly fill: string | undefined;
  readonly angle: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly selectable: boolean | undefined;
  readonly evented: boolean | undefined;
  /** 元 Text の data (groupId / charIndex / sourceText 等)。outlined: true 付与の元。 */
  readonly data: Record<string, unknown> | undefined;
}

/** 出力: caller が fabric.Path を構築するための仕様。 */
export interface OutlinedPathSpec {
  /** SVG path data 文字列 (fabric.Path constructor に渡す)。 */
  readonly pathData: string;
  readonly left: number;
  readonly top: number;
  readonly fill: string | undefined;
  readonly angle: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly selectable: boolean | undefined;
  readonly evented: boolean | undefined;
  /** 元 Text の data から objectId / type を除外して `outlined: true` を付与済み。
   *  caller は ensureObjectId(p, 'path') で新 ID を発行する。 */
  readonly data: Record<string, unknown>;
}

/** OutlineTextProps.fontWeight (number | 'bold' | 'normal' 等) を 100-900 整数に。 */
function normalizeWeight(raw: number | string | undefined): number {
  if (typeof raw === 'number') return raw;
  return String(raw ?? '').toLowerCase() === 'bold' ? 700 : 400;
}

export async function outlineTextToPath(
  text: OutlineTextProps,
  fontProvider: FontProvider,
): Promise<OutlinedPathSpec | null> {
  if (!text.text.trim()) return null;
  const cp = text.text.codePointAt(0);
  if (cp === undefined) return null;

  const weight = normalizeWeight(text.fontWeight);
  const italic = text.fontStyle === 'italic';

  const glyph = await fontProvider.getGlyphPath({
    family: text.fontFamily,
    weight,
    italic,
    codePoint: cp,
    fontSize: text.fontSize,
  });
  if (!glyph) return null;

  const { left: pathLeft, top: pathTop } = computeOutlinePathPosition(
    { left: text.left, top: text.top, fontSize: text.fontSize },
    { minX: glyph.bbox.minX, minY: glyph.bbox.minY },
  );

  // 元 Text の data から objectId / type を除外して outlined: true を付与
  // (型変更 Text → Path は新 ID 発行する規約。CLAUDE.md「ID と type の分離」参照)
  const sourceData = text.data ?? {};
  const { objectId: _oid, type: _t, ...restData } = sourceData;
  const data: Record<string, unknown> = { ...restData, outlined: true };

  return {
    pathData: glyph.pathData,
    left: pathLeft,
    top: pathTop,
    fill: text.fill,
    angle: text.angle,
    scaleX: text.scaleX,
    scaleY: text.scaleY,
    selectable: text.selectable,
    evented: text.evented,
    data,
  };
}
