// FileIOInteractor の挙動テスト。
//
// State / Repository / UIPort を Fake で DI することで、fabric / DOM / Electron 不知で
// pure な単体テストとして成立する (= 設計目的)。
//
// 主な検証ポイント:
//   - savedToken の capture timing が IPC await の前 (race regression 防止)
//   - 連打抑止 (saving フラグで saveCurrent の再入禁止)
//   - openFile の dirty チェック分岐 (save / discard / cancel)
//   - 初期状態は clean
//   - applySnapshot 後に dirty にならない (load 後 baseline 化)

import { FileIOInteractor } from '../src/usecases/menu/file-io-interactor';
import type { DocumentRepository } from '../src/repository/document-repository';
import type { DocumentSnapshot, LoadResult, SaveResult } from '../src/core/document/snapshot';
import type { UIPort, DiscardChoice } from '../src/usecases/ui-port';
import type { Command } from '../src/core/history/types';
import { FakeState as BaseFakeState } from './fakes';

// ── Fake 実装 ────────────────────────────────────────────────────────────

class FakeState extends BaseFakeState {
  private token = 0;
  private listeners: Array<() => void> = [];
  toSnapshotCalled = 0;
  applySnapshotCalled = 0;
  commitActiveTextCalled = 0;

  // 「キャンバス上のオブジェクト群」相当のテストデータ。
  // toSnapshot で snapshot.canvas に詰め、applySnapshot で書き戻すことで
  // save → load の round-trip を検証可能にする。
  private content: unknown = null;

  /** content を入れ替える (= ユーザの編集相当)。token も bump して dirty 化する。 */
  setContent(c: unknown): void {
    this.content = c;
    this.bump();
  }
  getContent(): unknown { return this.content; }

  override pushCommand(_c: Command): void { this.bump(); }

  override toSnapshot(): DocumentSnapshot {
    this.toSnapshotCalled++;
    return { format: 'mojiplay', version: 1, canvas: this.content };
  }
  override async applySnapshot(s: DocumentSnapshot): Promise<void> {
    this.applySnapshotCalled++;
    this.content = s.canvas;
    this.clearHistory();
  }
  override commitActiveText(): void { this.commitActiveTextCalled++; }

  override getHistoryToken(): number { return this.token; }
  override onMutate(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(c => c !== cb); };
  }
  override clearHistory(): void { this.bump(); }

  // ── test helper ──
  /** content を変えずに token だけ bump (= 細かい編集相当、内容比較が要らない時用)。 */
  simulateMutation(): void { this.bump(); }
  private bump(): void {
    this.token++;
    this.listeners.forEach(c => c());
  }
}

class FakeRepo implements DocumentRepository {
  // save / load の戻り値を test ごとに差し替える hook。
  // saveResult を ok=false にすると「保存失敗」、loadResult を差し替えると
  // 「未保存ファイルを開く」「外部 mply を import」を simulate できる。
  saveResult: SaveResult = { ok: true, filePath: '/tmp/foo.mply' };
  loadResult: LoadResult = {
    ok: true,
    snapshot: { format: 'mojiplay', version: 1, canvas: {} },
    filePath: '/tmp/bar.mply',
  };

  // 「ディスク」相当の永続ストレージ。save が成功すると ここに書き、load は
  // ここに値があればそれを返す (= 同じ FakeRepo 経由なら保存内容を読み戻せる)。
  // save→load の round-trip テスト用。
  private storedSnapshot: DocumentSnapshot | null = null;
  private storedPath: string | null = null;

  saveCalled = 0;
  loadCalled = 0;
  lastSavedSnapshot: DocumentSnapshot | null = null;
  lastSavedPath: string | null = null;

  /** save の resolve タイミングを test 側で制御するためのフック (= race test 用)。 */
  onSave?: () => Promise<SaveResult>;

  async save(s: DocumentSnapshot, p: string | null): Promise<SaveResult> {
    this.saveCalled++;
    this.lastSavedSnapshot = s;
    this.lastSavedPath = p;
    const result = this.onSave ? await this.onSave() : this.saveResult;
    if (result.ok) {
      this.storedSnapshot = s;
      this.storedPath = result.filePath;
    }
    return result;
  }
  async load(): Promise<LoadResult> {
    this.loadCalled++;
    // 保存済みがあればそれを「ディスクから読む」(優先)。
    // 無ければ test 側で設定した loadResult (= 「外部ファイルを開く」相当)。
    if (this.storedSnapshot && this.storedPath) {
      return { ok: true, snapshot: this.storedSnapshot, filePath: this.storedPath };
    }
    return this.loadResult;
  }
}

class FakeUI implements UIPort {
  toasts: Array<{ message: string; isError: boolean }> = [];
  discardAnswer: DiscardChoice = 'cancel';
  dirtyValues: boolean[] = [];

  showToast(message: string, isError = false): void {
    this.toasts.push({ message, isError });
  }
  async confirmDiscard(_message: string): Promise<DiscardChoice> {
    return this.discardAnswer;
  }
  setNativeDirty(dirty: boolean): void {
    this.dirtyValues.push(dirty);
  }
  async copyImageToClipboard(_dataUrl: string): Promise<void> { /* no-op */ }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function makeController(): {
  ctrl: FileIOInteractor; state: FakeState; repo: FakeRepo; ui: FakeUI;
} {
  const state = new FakeState();
  const repo  = new FakeRepo();
  const ui    = new FakeUI();
  const ctrl  = new FileIOInteractor(state, repo, ui, basename);
  return { ctrl, state, repo, ui };
}

// ── テスト ──────────────────────────────────────────────────────────────

describe('FileIOInteractor', () => {
  describe('初期状態', () => {
    test('clean (dirty=false, fileName=null) になる', () => {
      const { ctrl } = makeController();
      expect(ctrl.getDocStatus()).toEqual({ fileName: null, dirty: false });
    });

    test('state mutation で dirty=true になる', () => {
      const { ctrl, state } = makeController();
      state.simulateMutation();
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });
  });

  describe('saveCurrent', () => {
    test('成功で dirty=false になり fileName を反映する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      expect(ctrl.getDocStatus().dirty).toBe(true);
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(true);
      expect(repo.saveCalled).toBe(1);
      expect(ctrl.getDocStatus()).toEqual({ fileName: 'foo.mply', dirty: false });
      // toast: 「保存しました」が出る
      expect(ui.toasts.some(t => !t.isError && t.message.includes('保存しました'))).toBe(true);
    });

    test('commit を先に呼ぶ (IText 編集中 commit 規約)', async () => {
      const { ctrl, state } = makeController();
      state.simulateMutation();
      await ctrl.saveCurrent();
      expect(state.commitActiveTextCalled).toBe(1);
    });

    test('token を await 前に capture する (race regression 防止)', async () => {
      // fabric.js / IPC roundtrip の async 中にユーザが編集すると token が進む。
      // savedToken を await 前に capture することで、await 中の編集を dirty に残せる。
      const { ctrl, state, repo } = makeController();
      state.simulateMutation();           // initial: token=1, savedToken=0 → dirty=true

      // repo.save を hold して、その間に simulateMutation を呼ぶ
      let resolveSave: (v: SaveResult) => void = () => {};
      repo.onSave = () => new Promise(res => { resolveSave = res; });

      const savePromise = ctrl.saveCurrent();
      state.simulateMutation();           // await 中の編集 (= token が 2 に進む)
      resolveSave({ ok: true, filePath: '/tmp/foo.mply' });
      await savePromise;

      // savedToken は capture 時点 (=1) を採用しているので、現在の token (=2) と不一致 → dirty
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });

    test('saving 中は再入を block する (連打抑止)', async () => {
      const { ctrl, state, repo } = makeController();
      state.simulateMutation();

      let resolveSave: (v: SaveResult) => void = () => {};
      repo.onSave = () => new Promise(res => { resolveSave = res; });

      const p1 = ctrl.saveCurrent();
      const p2 = ctrl.saveCurrent();      // 1 回目が in-flight 中の再入
      const p3 = ctrl.saveCurrent();
      resolveSave({ ok: true, filePath: '/tmp/foo.mply' });

      expect(await p1).toBe(true);
      expect(await p2).toBe(false);       // 連打は false で skip
      expect(await p3).toBe(false);
      expect(repo.saveCalled).toBe(1);     // repo は 1 回だけ呼ばれる
    });

    test('cancel では toast を出さず dirty も維持する (silent)', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      repo.saveResult = { ok: false, canceled: true };
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(false);
      expect(ui.toasts.length).toBe(0);
      expect(ctrl.getDocStatus().dirty).toBe(true);   // dirty のまま
    });

    test('error は toast に出す', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      repo.saveResult = { ok: false, canceled: false, error: { message: 'disk full' } };
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(false);
      expect(ui.toasts.some(t => t.isError && t.message.includes('disk full'))).toBe(true);
    });
  });

  describe('saveAs', () => {
    test('currentPath を null にして保存 dialog を強制起動できる', async () => {
      const { ctrl, repo } = makeController();
      // 1 回目の保存で currentPath 確定
      await ctrl.saveCurrent();
      expect(ctrl.getDocStatus().fileName).toBe('foo.mply');
      expect(repo.lastSavedPath).toBe(null);          // 初回は null

      // 2 回目: 通常の saveCurrent は currentPath 渡る (= 上書き保存)
      repo.saveResult = { ok: true, filePath: '/tmp/foo.mply' };
      await ctrl.saveCurrent();
      expect(repo.lastSavedPath).toBe('/tmp/foo.mply');

      // 3 回目: saveAs は currentPath を null にする (= dialog 起動)
      repo.saveResult = { ok: true, filePath: '/tmp/baz.mply' };
      await ctrl.saveAs();
      expect(repo.lastSavedPath).toBe(null);
      expect(ctrl.getDocStatus().fileName).toBe('baz.mply');
    });

    test('cancel すると前の currentPath を復元する', async () => {
      const { ctrl, repo } = makeController();
      await ctrl.saveCurrent();
      expect(ctrl.getDocStatus().fileName).toBe('foo.mply');

      repo.saveResult = { ok: false, canceled: true };
      const ok = await ctrl.saveAs();
      expect(ok).toBe(false);
      expect(ctrl.getDocStatus().fileName).toBe('foo.mply');  // 元のまま
    });
  });

  describe('openFile', () => {
    test('dirty 時に discard を選ぶと save をスキップして load する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      ui.discardAnswer = 'discard';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(0);
      expect(repo.loadCalled).toBe(1);
      expect(state.applySnapshotCalled).toBe(1);
      expect(ctrl.getDocStatus()).toEqual({ fileName: 'bar.mply', dirty: false });
    });

    test('dirty 時に cancel を選ぶと何もしない', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      ui.discardAnswer = 'cancel';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(0);
      expect(repo.loadCalled).toBe(0);
      expect(state.applySnapshotCalled).toBe(0);
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });

    test('dirty 時に save 成功なら save 後 load する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      ui.discardAnswer = 'save';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(1);
      expect(repo.loadCalled).toBe(1);
      expect(state.applySnapshotCalled).toBe(1);
    });

    test('dirty 時に save 失敗なら load しない', async () => {
      const { ctrl, state, repo, ui } = makeController();
      state.simulateMutation();
      ui.discardAnswer = 'save';
      repo.saveResult = { ok: false, canceled: true };
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(1);
      expect(repo.loadCalled).toBe(0);
      expect(state.applySnapshotCalled).toBe(0);
    });

    test('load 後は dirty=false になる (savedToken を post-load に baseline 化)', async () => {
      const { ctrl, state, ui } = makeController();
      state.simulateMutation();           // dirty=true にする
      ui.discardAnswer = 'discard';        // 確認 dialog で「保存しない」を選んで進む
      await ctrl.openFile();
      expect(ctrl.getDocStatus().dirty).toBe(false);
      // 念のため: applySnapshot 内で token は進んだはずだが savedToken も同じ値
      expect(ctrl.getDocStatus().fileName).toBe('bar.mply');
    });

    test('cancel された load は何も変えない', async () => {
      const { ctrl, repo } = makeController();
      repo.loadResult = { ok: false, canceled: true };
      await ctrl.openFile();
      expect(ctrl.getDocStatus()).toEqual({ fileName: null, dirty: false });
    });

    test('load エラーは toast に出す', async () => {
      const { ctrl, repo, ui } = makeController();
      repo.loadResult = { ok: false, canceled: false, error: { kind: 'invalid-json', message: 'unexpected token' } };
      await ctrl.openFile();
      expect(ui.toasts.some(t => t.isError && t.message.includes('不正なファイル形式'))).toBe(true);
    });
  });

  describe('confirmDiscardIfDirty', () => {
    test('clean なら true を返して確認 dialog を出さない', async () => {
      const { ctrl, ui } = makeController();
      const ok = await ctrl.confirmDiscardIfDirty();
      expect(ok).toBe(true);
      expect(ui.dirtyValues.length).toBe(0);   // 何も起きない
    });
  });

  describe('subscribeDocStatus', () => {
    test('登録直後と mutation 時に通知し、unsub 後は通知しない', () => {
      const { ctrl, state } = makeController();
      const log: Array<{ fileName: string | null; dirty: boolean }> = [];
      const unsub = ctrl.subscribeDocStatus(s => log.push({ ...s }));
      expect(log.length).toBe(1);                          // 登録直後 1 回
      expect(log[0]).toEqual({ fileName: null, dirty: false });
      state.simulateMutation();
      expect(log.length).toBe(2);                          // mutation で 2 回目
      expect(log[1].dirty).toBe(true);
      unsub();
      state.simulateMutation();
      expect(log.length).toBe(2);                          // unsub 後は通知されない
    });
  });

  describe('setNativeDirty', () => {
    test('UIPort に dirty 値を push する (main の close guard 連動)', async () => {
      const { ctrl, state, ui } = makeController();
      state.simulateMutation();
      // initial subscribe で 1 回 + mutation で 1 回 = 計 2 回
      expect(ui.dirtyValues).toEqual([true]);
      await ctrl.saveCurrent();
      // 保存後は false が push される
      expect(ui.dirtyValues[ui.dirtyValues.length - 1]).toBe(false);
    });
  });

  // 一番ユーザー目線で意味のある契約: 「保存した State を開けば同一の State に戻る」。
  // FileIOInteractor + State.toSnapshot/applySnapshot + Repository の round-trip
  // を統合的に検証する。
  describe('save → load の round-trip', () => {
    test('別 instance で openFile しても保存時点と同一 snapshot に戻る (アプリ再起動相当)', async () => {
      const repo = new FakeRepo();

      // インスタンス A: 内容を入れて保存
      const stateA = new FakeState();
      const ctrlA  = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
      stateA.setContent({ objects: ['hello', 'world'], meta: { fontFamily: 'Arial' } });
      const savedSnapshot = stateA.toSnapshot();
      const ok = await ctrlA.saveCurrent();
      expect(ok).toBe(true);

      // インスタンス B (= 別 process / 再起動相当): 同じ repo から開く
      const stateB = new FakeState();
      const ctrlB  = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
      await ctrlB.openFile();

      // ロード後の State の snapshot が保存時点と完全一致
      expect(stateB.toSnapshot()).toEqual(savedSnapshot);
      expect(stateB.getContent()).toEqual({ objects: ['hello', 'world'], meta: { fontFamily: 'Arial' } });
    });

    test('save → 編集 → openFile (discard) で保存時点の content に戻る', async () => {
      const { ctrl, state, ui } = makeController();

      state.setContent({ objects: ['original'] });
      await ctrl.saveCurrent();
      expect(ctrl.getDocStatus().dirty).toBe(false);

      // 保存後にさらに編集 (= dirty)
      state.setContent({ objects: ['modified'] });
      expect(ctrl.getDocStatus().dirty).toBe(true);
      expect(state.getContent()).toEqual({ objects: ['modified'] });

      // 開き直す: 編集を破棄して保存版をロード
      ui.discardAnswer = 'discard';
      await ctrl.openFile();

      expect(state.getContent()).toEqual({ objects: ['original'] });
      expect(ctrl.getDocStatus().dirty).toBe(false);
    });

    test('複数回 save しても最新版が load される', async () => {
      const { ctrl, state, ui } = makeController();

      state.setContent({ version: 1 });
      await ctrl.saveCurrent();

      state.setContent({ version: 2 });
      await ctrl.saveCurrent();

      state.setContent({ version: 3 });
      await ctrl.saveCurrent();

      // 適当に編集して discard で開き直す
      state.setContent({ version: 'unsaved' });
      ui.discardAnswer = 'discard';
      await ctrl.openFile();

      expect(state.getContent()).toEqual({ version: 3 });
    });
  });
});
