// TextTool の単体テスト。
//
// 検証方針: real `class State` (renderer/state.ts) に fabric stub を渡し、
// State の public API (state.getAllObjects() / state.toSnapshot()) で結果を観測する。
// 「createTextAt が呼ばれたか」を peek するのではなく、「呼ばれた結果として canvas に
// IText が生成されているか」「位置とフォントが反映されているか」を見る。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { State } from '../src/window/presenter/state';
import { NullFontProvider } from './fakes';
import { TextTool } from '../src/window/usecases/tools/text-tool';
import type { TextCreateProps } from '../src/window/core/state-interface';

const PROPS: TextCreateProps = {
  fontFamily: 'Arial',
  fontSize: 72,
  fontWeight: 400,
  fontStyle: 'normal',
  fill: '#000000',
};

function setup() {
  const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
  return { state };
}

function snapshotObjects(state: State): ReadonlyArray<Record<string, unknown>> {
  const snap = state.toSnapshot() as { canvas: { objects: Record<string, unknown>[] } };
  return snap.canvas.objects;
}

describe('TextTool', () => {
  test('空き領域クリックで IText が生成される', () => {
    const { state } = setup();
    const tool = new TextTool(() => PROPS);

    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: false }, state);

    expect(state.getAllObjects()).toHaveLength(1);
    expect(snapshotObjects(state)[0]).toMatchObject({
      type: 'i-text',
      left: 50,
      top: 100,
      fontFamily: 'Arial',
      fontSize: 72,
      fontWeight: 400,
      fontStyle: 'normal',
      fill: '#000000',
    });
  });

  test('既存オブジェクト上のクリック (hasTarget=true) では IText を生成しない', () => {
    const { state } = setup();
    const tool = new TextTool(() => PROPS);

    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: true }, state);

    expect(state.getAllObjects()).toHaveLength(0);
  });

  test('クリックのたびに getFontProps を呼んで最新値を反映する', () => {
    const { state } = setup();
    let counter = 0;
    const tool = new TextTool((): TextCreateProps => {
      counter++;
      return { ...PROPS, fontSize: counter * 10 };
    });

    tool.onCanvasMouseDown({ worldX: 0, worldY: 0, hasTarget: false }, state);
    tool.onCanvasMouseDown({ worldX: 0, worldY: 0, hasTarget: false }, state);

    const objs = snapshotObjects(state);
    expect(objs).toHaveLength(2);
    expect(objs[0]).toMatchObject({ fontSize: 10 });
    expect(objs[1]).toMatchObject({ fontSize: 20 });
  });
});
