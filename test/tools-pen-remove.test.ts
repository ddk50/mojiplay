// PenRemoveTool の単体テスト。

import type { PathHandle } from '../src/core/state';
import { PenRemoveTool } from '../src/usecases/tools/pen-remove-tool';
import { FakePathHandle, FakeState, pointer } from './fakes';

class FakeHost extends FakeState {
  public path: PathHandle | null;
  public cursor = '';
  public rerenderCount = 0;
  constructor(p: PathHandle | null) { super(); this.path = p; }
  override getActivePath() { return this.path; }
  override setCursor(c: string) { this.cursor = c; }
  override requestRerender() { this.rerenderCount++; }
}

describe('PenRemoveTool', () => {
  test('アンカー上のクリックで removeAnchor + finalizeEdit が走る', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
      { type: 'L', to: { x: 0, y: 100 } },
      { type: 'Z' },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    // index=1 のアンカー (100, 0) を狙う
    const r = tool.onPointerDown(pointer(100, 0), host);
    expect(r).toBe('consumed');
    expect(path.commands.length).toBe(4);  // 元 5 → アンカー 1 個分の L が消えて 4
    expect(path.finalizeCount).toBe(1);
  });

  test('アンカー以外のクリックは pass を返して副作用を起こさない', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
      { type: 'L', to: { x: 100, y: 100 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    const r = tool.onPointerDown(pointer(500, 500), host);
    expect(r).toBe('pass');
    expect(path.finalizeCount).toBe(0);
    expect(path.commands.length).toBe(3);
  });

  test('アンカー数下限では consumed を返すが path 変更も finalize も起こさない', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },  // この L を削除すると M 単独になり拒否される
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    // (100, 0) をクリック
    const before = path.commands.slice();
    const r = tool.onPointerDown(pointer(100, 0), host);
    // hit はあるので consumed (fabric への伝播抑止)。ただし removeAnchor が拒否するので副作用無し。
    expect(r).toBe('consumed');
    expect(path.commands).toEqual(before);
    expect(path.finalizeCount).toBe(0);
  });

  test('アンカー上の hover で pointer カーソルになる', () => {
    const path = new FakePathHandle([
      { type: 'M', to: { x: 0, y: 0 } },
      { type: 'L', to: { x: 100, y: 0 } },
    ]);
    const host = new FakeHost(path);
    const tool = new PenRemoveTool();

    tool.onPointerMove(pointer(0, 0), host);
    expect(host.cursor).toBe('pointer');

    tool.onPointerMove(pointer(500, 500), host);
    expect(host.cursor).toBe('');
  });

  test('path 無しなら hover してもカーソルが空文字になる', () => {
    const host = new FakeHost(null);
    const tool = new PenRemoveTool();
    tool.onPointerMove(pointer(0, 0), host);
    expect(host.cursor).toBe('');
  });
});
