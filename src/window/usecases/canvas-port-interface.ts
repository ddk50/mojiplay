// CanvasPort: 「canvas という device への不透明 snapshot の読み書き口」を提供する
// output port。undo/redo の Command 適用と永続化 (document JSON の load/dump) が、
// fabric の内部形式を知らずに canvas を操作できるよう抽象化する。
//
// mojiplay の「抽象的内部表現」は自前オブジェクトモデルではなく
// 「不透明 ObjectSnapshot + Command ADT + History」(state-jump 設計、CLAUDE.md 参照)。
// この port は snapshot の中身を解釈しない — 解釈するのは impl 側
// (presenter/fabric-canvas-port.ts) だけ。
//
// concrete 実装は presenter/fabric-canvas-port.ts (fabric.Canvas 癒着)。
// test 時は object literal の fake を inject して呼び出しを記録できる。

import type { ObjectId } from '../core/object-id';
import type { ObjectSnapshot } from '../core/history/types';

export interface CanvasPort {
  /** snapshot を既存 object (snapshot.data.objectId で解決) へ丸ごと書き戻す。
   *  対象が見つからなければ no-op。state-jump: 差分計算はしない。 */
  writeSnapshot(snapshot: ObjectSnapshot): void;

  /** snapshot から object を新規構築して canvas に追加する (objectDeleted の undo /
   *  objectCreated の redo)。 */
  createFromSnapshot(snapshot: ObjectSnapshot): void;

  /** id の object を canvas から取り除く。見つからなければ no-op。 */
  removeObject(id: ObjectId): void;

  /** 再描画要求 (Command 適用後などに呼ぶ)。 */
  requestRender(): void;

  /** canvas 全消去 → document JSON をロード (enliven 完了まで await) → viewport reset。
   *  引数は DocumentSnapshot.canvas (opaque)。 */
  loadDocument(canvasJson: unknown): Promise<void>;

  /** 現 canvas の document JSON (= DocumentSnapshot.canvas に入る opaque data)。 */
  dumpDocument(): unknown;
}
