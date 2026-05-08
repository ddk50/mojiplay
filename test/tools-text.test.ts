// TextTool の単体テスト。

import type {
  TextCreateProps, CanvasMouseDownInput, ToolHost, ObjectHandle,
} from '../src/core/tools/tool-interface';
import { TextTool } from '../src/core/tools/text-tool';

class FakeHost implements ToolHost {
  public createCalls: Array<[number, number, TextCreateProps]> = [];
  createTextAt(x: number, y: number, props: TextCreateProps): void {
    this.createCalls.push([x, y, props]);
  }
  getActivePath()     { return null; }
  getViewportMatrix() { return [1, 0, 0, 1, 0, 0] as const; }
  requestRerender()   {}
  setCursor()         {}
  getActiveObjects()  { return []; }
  getAllObjects()     { return []; }
  setActiveSelection(){}
  pushCommand()       {}
}

const PROPS: TextCreateProps = {
  fontFamily: 'Arial', fontSize: 72, fontWeight: 400, fontStyle: 'normal', fill: '#000000',
};

describe('TextTool', () => {
  test('空き領域クリックで host.createTextAt が呼ばれる', () => {
    const tool = new TextTool(() => PROPS);
    const host = new FakeHost();
    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: false }, host);
    expect(host.createCalls).toEqual([[50, 100, PROPS]]);
  });

  test('既存オブジェクト上クリック (hasTarget=true) は no-op', () => {
    const tool = new TextTool(() => PROPS);
    const host = new FakeHost();
    tool.onCanvasMouseDown({ worldX: 50, worldY: 100, hasTarget: true }, host);
    expect(host.createCalls).toEqual([]);
  });

  test('getFontProps が毎回呼ばれる (toolbar の最新値を反映)', () => {
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

