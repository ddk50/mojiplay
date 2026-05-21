// History (ring buffer + cursor) のテスト。

import type { Command, ObjectSnapshot } from '../src/window/core/history/types';
import { History } from '../src/window/core/history/history';
import type { ObjectId } from '../src/window/core/object-id';

// テスト用の最小 Command を作るヘルパ。
// snapshot の中身は識別用に kind / id / tag だけ持たせて、apply/revert 自体はテストしない。
function mkSnap(id: string, tag = 'a'): ObjectSnapshot {
  return {
    type: 'path',
    tag,
    data: { objectId: id as ObjectId, type: 'path' as const },
  };
}

function mkChanged(id: string, fromTag: string, toTag: string): Command {
  return {
    kind: 'objectChanged',
    objectId: id as ObjectId,
    before: mkSnap(id, fromTag),
    after: mkSnap(id, toTag),
  };
}

describe('History', () => {
  test('初期状態は空 (canUndo / canRedo が false)', () => {
    const s = new History({ max: 10 });
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBeNull();
    expect(s.linearize()).toEqual([]);
  });

  test('push 1 個で undo 可 / redo 不可になる', () => {
    const s = new History({ max: 10 });
    const c = mkChanged('o1', 'a', 'b');
    s.push(c);
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
    expect(s.linearize()).toEqual([c]);
  });

  test('push → undo → redo の round-trip ができる', () => {
    const s = new History({ max: 10 });
    const c1 = mkChanged('o1', 'a', 'b');
    s.push(c1);
    const popped = s.undo();
    expect(popped).toBe(c1);
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);
    const reapplied = s.redo();
    expect(reapplied).toBe(c1);
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  test('複数 push 後に undo/redo cursor を順に移動できる', () => {
    const s = new History({ max: 10 });
    const c1 = mkChanged('o1', 'a', 'b');
    const c2 = mkChanged('o1', 'b', 'c');
    const c3 = mkChanged('o1', 'c', 'd');
    s.push(c1);
    s.push(c2);
    s.push(c3);
    expect(s.undo()).toBe(c3);
    expect(s.undo()).toBe(c2);
    expect(s.canRedo()).toBe(true);
    expect(s.redo()).toBe(c2);
    expect(s.redo()).toBe(c3);
    expect(s.canRedo()).toBe(false);
  });

  test('undo 中に新規 push すると redo 列をクリアする', () => {
    const s = new History({ max: 10 });
    const c1 = mkChanged('o1', 'a', 'b');
    const c2 = mkChanged('o1', 'b', 'c');
    const c3 = mkChanged('o1', 'b', 'X');
    s.push(c1);
    s.push(c2);
    s.undo(); // c2 を pop、cursor は 0
    s.push(c3); // 新 push → c2 (redo 候補) は無効化
    expect(s.canRedo()).toBe(false);
    expect(s.linearize()).toEqual([c1, c3]);
  });

  test('clear 後は空の初期状態に戻る', () => {
    const s = new History({ max: 10 });
    s.push(mkChanged('o1', 'a', 'b'));
    s.push(mkChanged('o1', 'b', 'c'));
    s.clear();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    expect(s.linearize()).toEqual([]);
  });

  describe('上限超過 (ring buffer の overwrite)', () => {
    test('max=3 で 4 回 push すると最古の 1 個が落ちる', () => {
      const s = new History({ max: 3 });
      const c1 = mkChanged('o1', 'a', 'b');
      const c2 = mkChanged('o1', 'b', 'c');
      const c3 = mkChanged('o1', 'c', 'd');
      const c4 = mkChanged('o1', 'd', 'e');
      s.push(c1);
      s.push(c2);
      s.push(c3);
      s.push(c4);
      expect(s.linearize()).toEqual([c2, c3, c4]);
      // c1 は失われている (= undo で c4, c3, c2 までしか戻れない)
      expect(s.undo()).toBe(c4);
      expect(s.undo()).toBe(c3);
      expect(s.undo()).toBe(c2);
      expect(s.canUndo()).toBe(false);
    });

    test('上限超過後も undo → redo の round-trip ができる', () => {
      const s = new History({ max: 3 });
      const c1 = mkChanged('o1', 'a', 'b');
      const c2 = mkChanged('o1', 'b', 'c');
      const c3 = mkChanged('o1', 'c', 'd');
      const c4 = mkChanged('o1', 'd', 'e');
      s.push(c1);
      s.push(c2);
      s.push(c3);
      s.push(c4);
      s.undo(); // c4 pop
      s.undo(); // c3 pop
      expect(s.redo()).toBe(c3);
      expect(s.redo()).toBe(c4);
    });

    test('wrap-around を跨いでも linearize は論理順を保つ', () => {
      const s = new History({ max: 3 });
      // 5 回 push: 物理的には buf[0..2] が複数回上書きされて、
      // logical 順序は最後の 3 個 (c3, c4, c5)
      const cs = [
        mkChanged('o1', '1', '2'),
        mkChanged('o1', '2', '3'),
        mkChanged('o1', '3', '4'),
        mkChanged('o1', '4', '5'),
        mkChanged('o1', '5', '6'),
      ];
      cs.forEach((c) => s.push(c));
      expect(s.linearize()).toEqual([cs[2], cs[3], cs[4]]);
    });
  });

  test('上限超過 + 途中 undo + 新規 push の合わせ技でも整合する', () => {
    const s = new History({ max: 3 });
    const c1 = mkChanged('o1', 'a', 'b');
    const c2 = mkChanged('o1', 'b', 'c');
    const c3 = mkChanged('o1', 'c', 'd');
    const c4 = mkChanged('o1', 'd', 'e');
    const c5 = mkChanged('o1', 'd', 'X');
    s.push(c1);
    s.push(c2);
    s.push(c3);
    s.push(c4);
    // 状態: linearize = [c2, c3, c4], cursor = 2
    s.undo();
    s.undo();
    // 状態: linearize = [c2, c3, c4], cursor = 0 (= c2 が apply 済み)
    s.push(c5);
    // redo 列 (c3, c4) はクリアされる、c5 が cursor=1 で新エントリに
    expect(s.linearize()).toEqual([c2, c5]);
    expect(s.canRedo()).toBe(false);
    expect(s.undo()).toBe(c5);
    expect(s.undo()).toBe(c2);
  });

  test('max=1 でも push と undo ができる', () => {
    const s = new History({ max: 1 });
    const c1 = mkChanged('o1', 'a', 'b');
    const c2 = mkChanged('o1', 'b', 'c');
    s.push(c1);
    s.push(c2);
    // c1 は捨てられて c2 だけが残る
    expect(s.linearize()).toEqual([c2]);
    expect(s.undo()).toBe(c2);
    expect(s.canUndo()).toBe(false);
  });

  test('max < 1 で例外を投げる', () => {
    expect(() => new History({ max: 0 })).toThrow();
    expect(() => new History({ max: -1 })).toThrow();
  });
});
