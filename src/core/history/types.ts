// Undo/Redo の Command ADT と HistoryStack interface。
//
// 設計の詳細は CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」参照。
//
// 採用方針:
//   - state-jump semantic (snapshot を丸ごと書き戻す、差分計算なし)
//   - Command は self-contained (before / after を Command が持つ)
//   - ObjectSnapshot は fabric.Object.toObject(['data']) 出力の薄いラッパー

import type { ObjectId, ObjectType } from '../object-id';

// fabric.Object.toObject(['data']) の出力をそのまま使う。
// 型 / data / left / top / scaleX / scaleY / angle / fill / path / text 等を含むが、
// TS 的には Record<string, unknown> として扱い、data フィールドだけ shape を保証する。
export type ObjectSnapshot = Record<string, unknown> & {
  data: { objectId: ObjectId; type: ObjectType };
};

export type Command =
  | { kind: 'objectChanged'; objectId: ObjectId; before: ObjectSnapshot; after: ObjectSnapshot }
  | { kind: 'objectCreated'; objectId: ObjectId; after:  ObjectSnapshot }
  | { kind: 'objectDeleted'; objectId: ObjectId; before: ObjectSnapshot }
  | { kind: 'compound';      commands: ReadonlyArray<Command> };

export interface HistoryStack {
  push(cmd: Command): void;
  undo(): Command | null;          // cursor を 1 戻して revert 対象を返す
  redo(): Command | null;          // cursor を 1 進めて apply 対象を返す
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  // debug / 永続化のための論理順 Command 列
  linearize(): ReadonlyArray<Command>;
}
