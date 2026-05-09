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

/**
 * canvas 上の object 1 個の種別タグ。fabric.Text か fabric.Path か。
 *
 * 注意: ここの 'path' は **canvas object の種別** (= fabric.Path クラス相当) を表す。
 * パスを構成する **形 (= PathCommand 列 / class Path)** とは別レイヤの概念。
 *
 *   ObjectType = 'path'   ← 「これは fabric.Path 種別の canvas object」
 *   PathCommand           ← その内部の M/L/C/Q/Z 命令 1 個
 *   class Path            ← PathCommand 列を持つ値オブジェクト (= 形全体)
 *
 * 1 個の Object (ObjectType='path') が 1 本の Path (= PathCommand[]) を持つ、という
 * 入れ子関係。同じ語が違う階層に流用されている点は今後も注意。
 *
 * 由来 (アウトライン化由来 vs freehand) は ObjectType では区別しない (= path は path)。
 * 既存の `data.outlined: boolean` 別フラグは現状残置 (legacy)。機能的には冗長で、
 * outlineActiveTexts / getActiveOutlinedPath の判定は obj.type === 'path' (= fabric の
 * 種別) で代替できる。整理は将来。
 */
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
