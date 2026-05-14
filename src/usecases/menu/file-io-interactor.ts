// FileIOInteractor: Save / Open の Use Case orchestration。
//
// CA レイヤ的には Use Case 層 (= src/usecases/)。state / repository / UI 副作用を
// constructor DI で受け取り、currentPath / savedToken / saving を field に格納。
// fabric / DOM / Electron 不知なので test 時は Fake を inject するだけで動作確認可能。
//
// 設計判断:
//   - module-level state ではなく class にすることで test 時の reset が要らず、
//     複数インスタンス化も可能 (= 将来 multi-document を入れるとき直接拡張できる)
//   - basename も path 不知 (use case で fs.path import 不可) のため inject
//   - stateless な変換 (formatLoadError) は free function (= AnemicHelper anti-pattern を避ける)
//   - savedToken は IPC await の **前** に capture (snapshot と同じ sync block で固定)。
//     await 後に getHistoryToken() を再取得すると await 中の編集を見逃して dirty=false
//     になる silent bug。詳細は CLAUDE.md / 計画書「排他制御 / 一貫性」セクション参照

import type { State } from '../../core/state-interface';
import type { LoadError } from '../../core/document/snapshot';
import type { DocumentRepository } from '../../repository/document-repository-interface';
import type { UIPort } from '../ui-port-interface';

export interface DocStatus {
  /** 現在のファイル名 (= basename)。未保存なら null。 */
  fileName: string | null;
  /** 最後の save / load 以降に state に変更が入っていれば true。 */
  dirty: boolean;
}

export class FileIOInteractor {
  private currentPath: string | null = null;
  private savedToken: number;
  private saving = false;
  private statusListeners: Array<(s: DocStatus) => void> = [];

  constructor(
    private readonly state: State,
    private readonly repo: DocumentRepository,
    private readonly ui: UIPort,
    private readonly basename: (path: string) => string,
  ) {
    // 初期状態は clean (= 保存済みファイルが無くても、まだ何も編集していないので dirty=false)。
    this.savedToken = state.getHistoryToken();
    state.onMutate(() => this.notifyStatus());
  }

  // ===== status =====

  getDocStatus(): DocStatus {
    const fileName = this.currentPath ? this.basename(this.currentPath) : null;
    const dirty = this.state.getHistoryToken() !== this.savedToken;
    return { fileName, dirty };
  }

  /** 状態変化通知の購読。登録直後に現状で 1 回 cb を呼ぶ。 */
  subscribeDocStatus(cb: (s: DocStatus) => void): () => void {
    this.statusListeners.push(cb);
    cb(this.getDocStatus());
    return () => {
      this.statusListeners = this.statusListeners.filter((c) => c !== cb);
    };
  }

  private notifyStatus(): void {
    const s = this.getDocStatus();
    this.statusListeners.forEach((cb) => cb(s));
    this.ui.setNativeDirty(s.dirty);
  }

  // ===== save =====

  /**
   * 現在のドキュメントを保存。
   * currentPath が null なら repository が dialog を出して新規パスを取得。
   * @returns 保存成功で true、キャンセル / エラー / 再入で false
   */
  async saveCurrent(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    try {
      // IText 編集中なら commit を完了させる (= 中途半端な editing state を保存しない)
      this.state.commitActiveText();

      // [block A 同期] snapshot と token を atomically capture。
      // JS は single-thread なので block A 中はユーザ入力が割り込めない。
      const tokenAtSnapshot = this.state.getHistoryToken();
      const snapshot = this.state.toSnapshot();

      // [await] IPC + atomic write。await 中にユーザは編集可能、token は進む可能性あり。
      const result = await this.repo.save(snapshot, this.currentPath);

      // [block B 同期]
      if (!result.ok) {
        if (!result.canceled) this.ui.showToast('保存失敗: ' + result.error.message, true);
        return false;
      }
      this.currentPath = result.filePath;
      // ← state.getHistoryToken() を再取得しない。tokenAtSnapshot を採用することで
      //   「await 中の編集」は dirty として残る。
      this.savedToken = tokenAtSnapshot;
      this.notifyStatus();
      this.ui.showToast('保存しました');
      return true;
    } finally {
      this.saving = false;
    }
  }

  /** 別名で保存。currentPath を null にして dialog を強制起動、失敗時は前のパスを復元。 */
  async saveAs(): Promise<boolean> {
    const prev = this.currentPath;
    this.currentPath = null;
    const ok = await this.saveCurrent();
    if (!ok) this.currentPath = prev;
    return ok;
  }

  // ===== open =====

  async openFile(): Promise<void> {
    if (!(await this.confirmDiscardIfDirty())) return;
    const result = await this.repo.load();
    if (!result.ok) {
      if (!result.canceled) this.ui.showToast(formatLoadError(result.error), true);
      return;
    }
    await this.state.applySnapshot(result.snapshot);
    this.currentPath = result.filePath;
    // applySnapshot 内で clearHistory が呼ばれて token が進んでいるので、
    // ここで baseline 化 (= 直後の load 状態を「保存済み」と扱う)。
    this.savedToken = this.state.getHistoryToken();
    this.notifyStatus();
  }

  /**
   * 「保存していない変更がある」状態を確認して継続可否を返す。
   * dirty でなければ即 true (= 続行 OK)、dirty なら 3 択 dialog を出す。
   * @returns 続行 OK なら true、キャンセルされたら false
   */
  async confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.getDocStatus().dirty) return true;
    const choice = await this.ui.confirmDiscard('変更が保存されていません。保存しますか？');
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    // 'save': 保存して、成功時のみ続行
    return await this.saveCurrent();
  }
}

// stateless な error → message 変換は free function。
// switch 完全網羅で kind が増えたらコンパイルエラーになる (= assertNever 的効果)。
function formatLoadError(e: LoadError): string {
  switch (e.kind) {
    case 'invalid-json':
      return '不正なファイル形式: ' + e.message;
    case 'format-mismatch':
      return 'mojiplay ファイルではありません';
    case 'unsupported-version':
      return 'サポートされていないバージョン: ' + String(e.version);
    case 'io':
      return '読み込みエラー: ' + e.message;
    default: {
      const _: never = e;
      return _;
    }
  }
}
