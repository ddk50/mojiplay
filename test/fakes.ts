// Tool 系 unit test 用の入力ヘルパ。
//
// FakeState / FakePathHandle はかつてここに居たが、State の振る舞いを別実装する
// tautology になっていたため削除済 (= real `class State` (renderer/state.ts) +
// fabric stub に置き換え)。fabric の最小 stub は test/fabric-stub.ts 参照。

import type { PointerInput } from '../src/window/usecases/tools/tool-interface';
import type { FontProvider, GlyphPathResult } from '../src/window/usecases/font-provider-interface';

/** 何もできない FakeFontProvider。常に null を返す (= グリフ無しと同じ)。
 *  outlineActiveTexts を実行しない / 結果を観測しない test で State 構築に使う。 */
export class NullFontProvider implements FontProvider {
  async getGlyphPath(): Promise<GlyphPathResult | null> {
    return null;
  }
}

/** どの query にも同じ pathData を返す FakeFontProvider。
 *  outlineActiveTexts の通しテスト (Q→C 正規化等) で「fontkit が返す形」を固定する。
 *  bbox は pathData の座標系と同じ (Y-down)。 */
export class FixedFontProvider implements FontProvider {
  constructor(
    private readonly pathData: string,
    private readonly bbox: GlyphPathResult['bbox'] = { minX: 0, minY: -100, maxX: 100, maxY: 0 },
  ) {}
  async getGlyphPath(): Promise<GlyphPathResult | null> {
    return { pathData: this.pathData, bbox: this.bbox };
  }
}

/** screen / world 座標を同値で構築する PointerInput ヘルパ (= viewport 識別変換前提)。 */
export function pointer(
  x: number,
  y: number,
  opts?: { altKey?: boolean; shiftKey?: boolean },
): PointerInput {
  return {
    screenX: x,
    screenY: y,
    worldX: x,
    worldY: y,
    altKey: opts?.altKey ?? false,
    shiftKey: opts?.shiftKey ?? false,
  };
}
