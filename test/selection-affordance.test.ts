// 選択枠 affordance (hasControls / hasBorders / borderColor / lockScalingFlip) の
// 回帰テスト。
//
// 背景: 「文字列が拡大縮小できるかどうか」が過去コミットで揺れてきた
// (first commit: true → 9a6a90c: 一律 false → 894562b: Text のみ true に修正)。
// outlined path 側も含め、変形可否と選択枠スタイルを real `class State` +
// fabric stub で固定する。
//
// assert 対象の hasControls 等は fabric が描画・操作可否に使う observable surface
// (State API には露出しない) なので、fabric-stub 冒頭コメントの例外 2 に基づき
// canvas.getObjects() で取ったオブジェクトのプロパティを直接検証する。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { State } from '../src/window/presenter/state';
import type { FontProvider, GlyphPathResult } from '../src/window/usecases/font-provider-interface';

const OUTLINED_BORDER_COLOR = '#f59e0b';

/** 固定の正方形グリフを返す FontProvider (outlineActiveTexts を stub で通すため)。 */
class SquareGlyphFontProvider implements FontProvider {
  async getGlyphPath(): Promise<GlyphPathResult | null> {
    return {
      pathData: 'M 0 -50 L 50 -50 L 50 0 L 0 0 Z',
      bbox: { minX: 0, minY: -50, maxX: 50, maxY: 0 },
    };
  }
}

function setup(): { state: State; canvas: FakeFabricCanvas } {
  const canvas = new FakeFabricCanvas();
  const state = new State(canvas as never, new SquareGlyphFontProvider());
  return { state, canvas };
}

async function loadFixture(state: State, objects: Record<string, unknown>[]): Promise<void> {
  await state.applySnapshot({
    format: 'mojiplay',
    version: 1,
    canvas: { objects } as unknown,
  });
}

const textFixture = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'text',
  text: 'A',
  left: 0,
  top: 0,
  fontFamily: 'Arial',
  fontSize: 72,
  fill: '#000',
  data: { objectId: id, type: 'text' },
  ...extra,
});

const outlinedPathFixture = (id: string): Record<string, unknown> => ({
  type: 'path',
  path: [
    ['M', 0, 0],
    ['L', 10, 10],
  ],
  data: { objectId: id, type: 'path', outlined: true },
});

/** text 選択 → outlineActiveTexts で outlined path を 1 個作るヘルパ。 */
async function outlineSingleText(state: State, canvas: FakeFabricCanvas): Promise<void> {
  await loadFixture(state, [textFixture('text1')]);
  canvas.setActiveObject(canvas.getObjects()[0]);
  const result = await state.outlineActiveTexts();
  expect(result.succeeded).toBe(1);
}

function getPaths(canvas: FakeFabricCanvas): Array<fabric.Path & { lockScalingFlip?: boolean }> {
  return (canvas.getObjects() as never as fabric.Object[]).filter(
    (o) => o.type === 'path',
  ) as Array<fabric.Path & { lockScalingFlip?: boolean }>;
}

function getTexts(canvas: FakeFabricCanvas): fabric.Text[] {
  return (canvas.getObjects() as never as fabric.Object[]).filter(
    (o) => o.type === 'text',
  ) as fabric.Text[];
}

describe('文字列 (fabric.Text) の変形可否 [回帰: hasControls の揺れ防止]', () => {
  test('IText commit で分割された各文字は拡縮・回転できる (hasControls/hasBorders = true)', () => {
    const { state, canvas } = setup();
    const fabricNS = (globalThis as { fabric?: never }).fabric as never as {
      IText: new (text: string, opts: Record<string, unknown>) => fabric.IText;
    };

    const it = new fabricNS.IText('AB', {
      left: 0,
      top: 0,
      fontFamily: 'Arial',
      fontSize: 72,
    }) as fabric.IText & {
      _textLines: string[][];
      __charBounds: Array<Array<{ left: number; width: number }>>;
    };
    it._textLines = [['A', 'B']];
    it.__charBounds = [
      [
        { left: 0, width: 50 },
        { left: 50, width: 50 },
      ],
    ];
    canvas.add(it as never);
    canvas.fire('text:editing:exited', { target: it });

    const texts = getTexts(canvas);
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      expect(t.hasControls).toBe(true);
      expect(t.hasBorders).toBe(true);
    }
    void state;
  });

  test('.mply ロード相当 (applySnapshot) 後の text も拡縮・回転できる', async () => {
    const { state, canvas } = setup();
    await loadFixture(state, [textFixture('text1')]);
    const [t] = getTexts(canvas);
    expect(t.hasControls).not.toBe(false);
  });
});

describe('outlined path の選択枠スタイル (data.outlined から導出)', () => {
  test('outlineActiveTexts 直後の path: ハンドルあり + オレンジ枠 + 反転禁止', async () => {
    const { state, canvas } = setup();
    await outlineSingleText(state, canvas);

    const [p] = getPaths(canvas);
    expect(p.hasControls).toBe(true); // select-group モード
    expect(p.hasBorders).toBe(true);
    expect(p.borderColor).toBe(OUTLINED_BORDER_COLOR);
    expect(p.lockScalingFlip).toBe(true);
  });

  test('setMode でハンドル表示が追従する (select-char で消え select-group で復活)。text は影響なし', async () => {
    const { state, canvas } = setup();
    await loadFixture(state, [textFixture('text1'), outlinedPathFixture('path1')]);
    const [p] = getPaths(canvas);
    const [t] = getTexts(canvas);

    expect(p.hasControls).toBe(true); // 初期 select-group

    state.setMode('select-char');
    expect(p.hasControls).toBe(false);
    expect(t.hasControls).toBe(true);

    state.setMode('select-group');
    expect(p.hasControls).toBe(true);
    expect(t.hasControls).toBe(true);
  });

  test('アウトライン化 undo → redo で再生成された path もスタイルが乗る', async () => {
    const { state, canvas } = setup();
    await outlineSingleText(state, canvas);

    state.undo();
    expect(getPaths(canvas)).toHaveLength(0);

    state.redo();
    const [p] = getPaths(canvas);
    expect(p.hasControls).toBe(true);
    expect(p.borderColor).toBe(OUTLINED_BORDER_COLOR);
    expect(p.lockScalingFlip).toBe(true);
  });

  test('duplicateActiveObjects の複製側にもスタイルが乗る', async () => {
    const { state, canvas } = setup();
    await loadFixture(state, [outlinedPathFixture('path1')]);
    canvas.setActiveObject(canvas.getObjects()[0]);

    state.duplicateActiveObjects({ x: 10, y: 10 });

    const paths = getPaths(canvas);
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p.hasControls).toBe(true);
      expect(p.borderColor).toBe(OUTLINED_BORDER_COLOR);
      expect(p.lockScalingFlip).toBe(true);
    }
  });

  test('保存 → 再ロード相当 (toSnapshot → 別 State に applySnapshot) でもスタイルが乗る', async () => {
    const { state, canvas } = setup();
    await outlineSingleText(state, canvas);
    const saved = state.toSnapshot();

    const canvas2 = new FakeFabricCanvas();
    const state2 = new State(canvas2 as never, new SquareGlyphFontProvider());
    await state2.applySnapshot(saved);

    const [p] = getPaths(canvas2);
    expect(p.hasControls).toBe(true);
    expect(p.borderColor).toBe(OUTLINED_BORDER_COLOR);
    expect(p.lockScalingFlip).toBe(true);
  });

  test('text + outlined path 混在ロードでも text の枠はデフォルトのまま', async () => {
    const { state, canvas } = setup();
    await loadFixture(state, [textFixture('text1'), outlinedPathFixture('path1')]);

    const [t] = getTexts(canvas);
    expect((t as fabric.Text & { borderColor?: string }).borderColor).toBeUndefined();
    expect(t.hasControls).toBe(true);
    void state;
  });
});
