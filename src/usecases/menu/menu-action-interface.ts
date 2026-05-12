// MenuAction: ユーザがメニューバー / shortcut / IPC のいずれの経路で発火しても
// 同じ contract で呼べる「メニューアクション」の interface。
//
// 既存の menu free function (selectAll / deleteSelection / outlineSelection 等) は
// signature がバラバラ ((state)、(state, ui)、async (state, ui)…) で、Controller
// 側の dispatcher で個別に書く必要があった。MenuAction で thin wrapper として
// 包むと、Controller は `actions[id].execute()` の単一経路で dispatch できる。
//
// 設計判断:
//   - DI は wrapper の constructor / factory で済ませる。execute() は引数を取らない
//     (= 内部で state / ui / fileIO を closure 保持)。app.ts dispatcher のテーブル化を
//     最小コストで実現するための形
//   - canExecute? は将来の menu disabled UI 用。当面は実装側 optional

export interface MenuAction {
  /** 'copy' / 'undo' / 'select-all' / 'file-save' 等の安定 ID。 */
  readonly id: string;

  /** アクション実行。同期 / 非同期混在を許容する。 */
  execute(): void | Promise<void>;

  /** 現在のドキュメント / 選択状態で実行可能か (= UI disabled state)。
   *  実装は optional。未指定なら常に可能扱い。 */
  canExecute?(): boolean;
}
