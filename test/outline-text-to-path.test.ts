// outline-text-to-path use case の test。
//
// FontProvider port を fake で差し替えることで、framework (fontkit / browser font query)
// 抜きに use case 単体で test できる。これまで「outline 化のロジック」は
// renderer/outline-conversion.ts に閉じ込められ、test 不可だった (fontkit + DOM の壁)。
// port 分離により orchestration を pure にして単体 test 可能に。

import type { FontProvider, GlyphPathResult } from '../src/usecases/font-provider-interface';
import { outlineTextToPath, type OutlineTextProps } from '../src/usecases/outline-text-to-path';

// 任意の glyph data を返す fake (= 「フォント取得できた」シナリオ)
class FakeFontProvider implements FontProvider {
  callLog: Array<{
    family: string;
    weight: number;
    italic: boolean;
    codePoint: number;
    fontSize: number;
  }> = [];
  result: GlyphPathResult | null = {
    pathData: 'M0 0 L10 10 Z',
    bbox: { minX: 0, minY: -10, maxX: 10, maxY: 0 },
  };

  async getGlyphPath(q: {
    family: string;
    weight: number;
    italic: boolean;
    codePoint: number;
    fontSize: number;
  }): Promise<GlyphPathResult | null> {
    this.callLog.push({ ...q });
    return this.result;
  }
}

function defaultProps(): OutlineTextProps {
  return {
    text: 'A',
    left: 100,
    top: 200,
    fontFamily: 'Arial',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSize: 72,
    fill: '#000000',
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    selectable: true,
    evented: true,
    data: { objectId: 'old-id', type: 'text', groupId: 'g1', charIndex: 0 },
  };
}

describe('outlineTextToPath', () => {
  test('text の codePoint を fontProvider に渡す', async () => {
    const fp = new FakeFontProvider();
    await outlineTextToPath({ ...defaultProps(), text: 'A' }, fp);
    expect(fp.callLog[0].codePoint).toBe('A'.codePointAt(0));
  });

  test("fontWeight 'bold' を 700 に正規化", async () => {
    const fp = new FakeFontProvider();
    await outlineTextToPath({ ...defaultProps(), fontWeight: 'bold' }, fp);
    expect(fp.callLog[0].weight).toBe(700);
  });

  test("fontWeight 'normal' / undefined を 400 に正規化", async () => {
    const fp = new FakeFontProvider();
    await outlineTextToPath({ ...defaultProps(), fontWeight: 'normal' }, fp);
    expect(fp.callLog[0].weight).toBe(400);
    fp.callLog = [];
    await outlineTextToPath({ ...defaultProps(), fontWeight: undefined }, fp);
    expect(fp.callLog[0].weight).toBe(400);
  });

  test('italic は fontStyle === "italic" 時のみ true', async () => {
    const fp = new FakeFontProvider();
    await outlineTextToPath({ ...defaultProps(), fontStyle: 'italic' }, fp);
    expect(fp.callLog[0].italic).toBe(true);
    fp.callLog = [];
    await outlineTextToPath({ ...defaultProps(), fontStyle: 'normal' }, fp);
    expect(fp.callLog[0].italic).toBe(false);
  });

  test('空文字 / 空白のみの text は null を返す (fontProvider も呼ばない)', async () => {
    const fp = new FakeFontProvider();
    expect(await outlineTextToPath({ ...defaultProps(), text: '' }, fp)).toBeNull();
    expect(await outlineTextToPath({ ...defaultProps(), text: '   ' }, fp)).toBeNull();
    expect(fp.callLog).toHaveLength(0);
  });

  test('fontProvider が null を返したら null (= グリフ取得失敗)', async () => {
    const fp = new FakeFontProvider();
    fp.result = null;
    expect(await outlineTextToPath(defaultProps(), fp)).toBeNull();
  });

  test('成功時、glyph pathData / fill / scale / angle を spec に伝搬', async () => {
    const fp = new FakeFontProvider();
    const spec = await outlineTextToPath(
      { ...defaultProps(), fill: '#ff0000', scaleX: 2, scaleY: 3, angle: 45 },
      fp,
    );
    expect(spec).not.toBeNull();
    expect(spec!.pathData).toBe('M0 0 L10 10 Z');
    expect(spec!.fill).toBe('#ff0000');
    expect(spec!.scaleX).toBe(2);
    expect(spec!.scaleY).toBe(3);
    expect(spec!.angle).toBe(45);
  });

  test('data: 元の objectId / type を捨て、outlined: true を付与、groupId は引き継ぎ', async () => {
    const fp = new FakeFontProvider();
    const spec = await outlineTextToPath(defaultProps(), fp);
    expect(spec).not.toBeNull();
    expect(spec!.data.objectId).toBeUndefined();
    expect(spec!.data.type).toBeUndefined();
    expect(spec!.data.outlined).toBe(true);
    expect(spec!.data.groupId).toBe('g1');
    expect(spec!.data.charIndex).toBe(0);
  });

  test('left / top に bbox.minX + baseline 補正を加えて返す', async () => {
    const fp = new FakeFontProvider();
    fp.result = {
      pathData: 'M0 0',
      bbox: { minX: 5, minY: -50, maxX: 10, maxY: 0 },
    };
    const spec = await outlineTextToPath(
      { ...defaultProps(), left: 100, top: 200, fontSize: 72 },
      fp,
    );
    expect(spec).not.toBeNull();
    expect(spec!.left).toBe(105); // 100 + bbox.minX
    // top は computeOutlinePathPosition (baseline 計算) 経由なので fix 値検証より範囲チェック
    expect(spec!.top).toBeGreaterThan(200);
    expect(spec!.top).toBeLessThan(220);
  });
});
