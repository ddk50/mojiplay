// mojiplay ドキュメントの永続化スナップショットと、永続化操作の結果型 (ADT)。
//
// 設計判断:
//   - canvas は `unknown` で opaque に持つ。fabric の internal 形式に依存させない。
//     検証は読み込み側 (FileSystemDocumentRepository) で行い、State.applySnapshot は
//     型保証された Snapshot を信頼する
//   - LoadError は kind タグ付き union (= TS の判別共用体)。formatter で switch
//     完全網羅
//   - core/ なので fabric / Electron 不知

export interface DocumentSnapshot {
  readonly format: 'mojiplay';
  readonly version: 1;
  /** canvas.toJSON(['data']) の出力。fabric の内部形式に依存するので opaque で扱う。 */
  readonly canvas: unknown;
}

export type LoadError =
  | { kind: 'invalid-json'; message: string }
  | { kind: 'format-mismatch'; got: unknown }
  | { kind: 'unsupported-version'; version: unknown }
  | { kind: 'io'; message: string };

export type LoadResult =
  | { ok: true; snapshot: DocumentSnapshot; filePath: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: LoadError };

export type SaveResult =
  | { ok: true; filePath: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: { message: string } };
