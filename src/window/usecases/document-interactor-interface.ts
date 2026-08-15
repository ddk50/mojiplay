// DocumentInteractor の public 契約。
//
// mojiplay ドキュメントの「抽象的内部表現」(不透明 ObjectSnapshot + Command ADT +
// History、state-jump 設計) を所有する stateful Use Case。canvas への反映は
// CanvasPort 経由で行い、fabric を一切知らない。
//
// Impl は ./document-interactor.ts の DocumentInteractorImpl。
// 現在の呼び手は presenter/state.ts (canvas Gateway) の facade メソッド群。

import type { Command } from '../core/history/types';
import type { DocumentSnapshot } from '../core/document/snapshot';

export interface DocumentInteractor {
  /** Command を履歴に積み、dirty token を進める。 */
  pushCommand(cmd: Command): void;

  /** 1 手戻す。実行した Command を返す (何も無ければ null、token も進めない)。
   *  ログ等の副次処理は呼び手が戻り値で行う。 */
  undo(): Command | null;

  /** 1 手進める。戻り値の規約は undo と同じ。 */
  redo(): Command | null;

  canUndo(): boolean;
  canRedo(): boolean;

  /** 履歴を全消去し、dirty token を進める。 */
  clearHistory(): void;

  /** debug 用: 履歴の線形化ビュー。 */
  linearizeHistory(): ReadonlyArray<Command>;

  // ----- dirty tracking (opaque token) -----

  getHistoryToken(): number;

  /** document が変わりうる操作のたびに呼ばれる listener を登録。戻り値は解除関数。 */
  onMutate(cb: () => void): () => void;

  // ----- 永続化 -----

  toSnapshot(): DocumentSnapshot;

  /** document をロードして履歴をリセットする (ロード完了まで await)。 */
  applySnapshot(s: DocumentSnapshot): Promise<void>;
}
