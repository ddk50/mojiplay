// core/group-selection.ts の computeGroupExpansion の単体テスト。

import { computeGroupExpansion } from '../src/core/group-selection';

interface Obj { id: string; gid?: string }
const getGid = (o: Obj) => o.gid;

describe('computeGroupExpansion', () => {
  test('1 文字選択を同じ groupId の全文字に展開できる', () => {
    const a = { id: 'A', gid: 'g1' };
    const b = { id: 'B', gid: 'g1' };
    const c = { id: 'C', gid: 'g1' };
    const x = { id: 'X', gid: 'g2' };
    const all = [a, b, c, x];
    const r = computeGroupExpansion([a], all, getGid);
    expect(r.expanded).toEqual([a, b, c]);
    expect(r.alreadyExpanded).toBe(false);
  });

  test('複数 group を跨ぐ marquee 選択を両方の group 全体に展開できる', () => {
    const a1 = { id: 'a1', gid: 'g1' };
    const a2 = { id: 'a2', gid: 'g1' };
    const b1 = { id: 'b1', gid: 'g2' };
    const b2 = { id: 'b2', gid: 'g2' };
    const c1 = { id: 'c1', gid: 'g3' };
    const all = [a1, a2, b1, b2, c1];
    const r = computeGroupExpansion([a1, b1], all, getGid);
    expect(r.expanded).toEqual([a1, a2, b1, b2]);
    expect(r.alreadyExpanded).toBe(false);
  });

  test('既に完全展開済みなら alreadyExpanded=true を返す (no-op 判定)', () => {
    const a = { id: 'A', gid: 'g1' };
    const b = { id: 'B', gid: 'g1' };
    const all = [a, b];
    const r = computeGroupExpansion([a, b], all, getGid);
    expect(r.alreadyExpanded).toBe(true);
  });

  test('順序が逆でも alreadyExpanded=true を返す (集合比較)', () => {
    const a = { id: 'A', gid: 'g1' };
    const b = { id: 'B', gid: 'g1' };
    const all = [a, b];
    const r = computeGroupExpansion([b, a], all, getGid);
    expect(r.alreadyExpanded).toBe(true);
  });

  test('groupId を持たない object のみの選択は展開対象が無く no-op になる', () => {
    const lone = { id: 'L' };
    const a = { id: 'A', gid: 'g1' };
    const r = computeGroupExpansion([lone], [lone, a], getGid);
    expect(r.alreadyExpanded).toBe(true);
    expect(r.expanded).toEqual([lone]);  // 入力をそのまま返す
  });

  test('groupId 付きと無しの混合選択は groupId 付きの group のみ展開する', () => {
    const lone = { id: 'L' };
    const a = { id: 'A', gid: 'g1' };
    const b = { id: 'B', gid: 'g1' };
    const all = [lone, a, b];
    const r = computeGroupExpansion([lone, a], all, getGid);
    expect(r.expanded).toEqual([a, b]);  // lone は groupId 付きの group に含まれないので外れる
    expect(r.alreadyExpanded).toBe(false);
  });

  test('空入力は alreadyExpanded=true を返す', () => {
    const r = computeGroupExpansion<Obj>([], [], getGid);
    expect(r.alreadyExpanded).toBe(true);
  });
});
