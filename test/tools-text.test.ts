// TextTool の単体テスト。

import type { TextCreateProps } from '../src/core/state';
import { TextTool } from '../src/usecases/tools/text-tool';
import { FakeState } from './fakes';

class FakeHost extends FakeState {
  public createCalls: Array<[number, number, TextCreateProps]> = [];
  override createTextAt(x: number, y: number, props: TextCreateProps): void {
    this.createCalls.push([x, y, props]);
  }
}

const PROPS: TextCreateProps = {
  fontFamily: 'Arial', fontSize: 72, fontWeight: 400, fontStyle: 'normal', fill: '#000000',
};

describe('TextTool', () => {
  test('空き領域クリックで host.createTextAt を呼ぶ', () => {
    const tool = new TextTool(() => PROPS);
    const host = new FakeHost();
    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: false }, host);
    expect(host.createCalls).toEqual([[50, 100, PROPS]]);
  });

  test('既存オブジェクト上のクリック (hasTarget=true) では createTextAt を呼ばない', () => {
    const tool = new TextTool(() => PROPS);
    const host = new FakeHost();
    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: true }, host);
    expect(host.createCalls).toEqual([]);
  });

  test('createTextAt のたびに getFontProps を呼んで最新値を反映する', () => {
    let counter = 0;
    const tool = new TextTool((): TextCreateProps => {
      counter++;
      return { ...PROPS, fontSize: counter * 10 };
    });
    const host = new FakeHost();
    tool.onCanvasMouseDown({ worldX: 0, worldY: 0, hasTarget: false }, host);
    tool.onCanvasMouseDown({ worldX: 0, worldY: 0, hasTarget: false }, host);
    expect(host.createCalls[0][2].fontSize).toBe(10);
    expect(host.createCalls[1][2].fontSize).toBe(20);
  });
});
