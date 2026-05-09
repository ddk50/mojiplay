// ObjectId / ObjectType / ensureObjectId のテスト

import { ensureObjectId, type IdentifiableData } from '../src/core/object-id';

describe('ensureObjectId', () => {
  test('ULID 形式 (26 文字 Crockford base32) の ID を発行する', () => {
    const obj: { data?: IdentifiableData } = {};
    const id = ensureObjectId(obj, 'text');
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('初回呼び出しで data.objectId と data.type を確定できる', () => {
    const obj: { data?: IdentifiableData } = {};
    const id = ensureObjectId(obj, 'path');
    expect(obj.data?.objectId).toBe(id);
    expect(obj.data?.type).toBe('path');
  });

  test('既存 data の他フィールドを保持したまま ID を発行できる', () => {
    const obj: { data?: any } = { data: { groupId: 'g1', charIndex: 0 } };
    const id = ensureObjectId(obj, 'text');
    expect(obj.data.objectId).toBe(id);
    expect(obj.data.type).toBe('text');
    // 既存フィールドは保持される
    expect(obj.data.groupId).toBe('g1');
    expect(obj.data.charIndex).toBe(0);
  });

  test('同じ obj に 2 回呼んでも同じ ID を返す (idempotent になる)', () => {
    const obj: { data?: IdentifiableData } = {};
    const id1 = ensureObjectId(obj, 'text');
    const id2 = ensureObjectId(obj, 'text');
    expect(id2).toBe(id1);
  });

  test('type 引数が違っても最初の type を保持する (immutable になる)', () => {
    const obj: { data?: IdentifiableData } = {};
    const id1 = ensureObjectId(obj, 'text');
    const id2 = ensureObjectId(obj, 'path');  // 違う type で再呼び出し
    expect(id2).toBe(id1);
    expect(obj.data?.type).toBe('text');  // 最初の text が保持されている
  });

  test('別 obj には別 ID を振る', () => {
    const obj1: { data?: IdentifiableData } = {};
    const obj2: { data?: IdentifiableData } = {};
    const id1 = ensureObjectId(obj1, 'text');
    const id2 = ensureObjectId(obj2, 'text');
    expect(id1).not.toBe(id2);
  });
});
