// ObjectId / ObjectType と ensureObjectId() — minimal infra。
//
// ObjectId は pure ULID (branded string)、type は別フィールド (data.type) に置く。
// 両者を ID 文字列に混在させない。
//
// 詳細は CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」の
// 「ID と type の分離」節を参照。
//
// type は ID 確定時に同時に書き込み、以降 immutable として扱う (object lifecycle 中に
// 書き換えない)。type が変わる操作 (例: outline 化 = Text → Path) は「古い object を
// destroy + 新しい object を create」として扱い、新規 ID を発行する。
//
// monotonic ULID は drag finalize や複製操作で同一 ms に複数発行が起きても random 部
// を +1 で単調増加させるため必須。ulid パッケージの monotonicFactory に任せる。

import { monotonicFactory } from 'ulid';

const newUlid = monotonicFactory();

export type ObjectId = string & { readonly __brand: 'ObjectId' };
export type ObjectType = 'text' | 'path';

export interface IdentifiableData {
  objectId?: ObjectId;
  type?:     ObjectType;
}

export function ensureObjectId(
  obj: { data?: IdentifiableData },
  type: ObjectType,
): ObjectId {
  const data = obj.data ?? (obj.data = {} as IdentifiableData);
  if (!data.objectId) {
    data.objectId = newUlid() as ObjectId;
    data.type = type;
  }
  return data.objectId;
}
