// FileIOInteractor の public 契約。
//
// concrete impl は ./file-io-interactor.ts の FileIOInteractorImpl。
// test 側は本 interface を object literal (or jest.fn() の集合) で満たせばよく、
// 各 consumer (renderer.ts / view controller / menu actions) は interface に依存
// (consumer ごとに `Pick<FileIOInteractor, '...'>` で必要分だけ narrow するのが推奨)。

export interface DocStatus {
  /** 現在のファイル名 (= basename)。未保存なら null。 */
  readonly fileName: string | null;
  /** 最後の save / load 以降に state に変更が入っていれば true。 */
  readonly dirty: boolean;
}

export interface FileIOInteractor {
  // ── status ──
  getDocStatus(): DocStatus;
  /** 状態変化通知の購読。登録直後に現状で 1 回 cb を呼ぶ。 */
  subscribeDocStatus(cb: (s: DocStatus) => void): () => void;

  // ── save ──
  /**
   * 現在のドキュメントを保存。currentPath が null なら repository が dialog を
   * 出して新規パスを取得。
   * @returns 保存成功で true、キャンセル / エラー / 再入で false
   */
  saveCurrent(): Promise<boolean>;

  /** 現在のパスを無視して dialog 起動 (Save As)。 */
  saveAs(): Promise<boolean>;

  // ── open ──
  /**
   * dialog でファイル選択 → 読み込み → state に適用。dirty 時は確認 dialog 経由。
   */
  openFile(): Promise<void>;

  // ── close guard ──
  /**
   * dirty なら 3 択 dialog (save/discard/cancel) を出して結果を bool で返す。
   * close 時の guard / openFile 前 などで呼ぶ。
   */
  confirmDiscardIfDirty(): Promise<boolean>;
}
