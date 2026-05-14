// FileIOInteractor の挙動テスト。
//
// 検証方針: real `class State` (renderer/state.ts) + fabric stub を State として
// 注入。Repository / UIPort は外部 boundary (file system / OS dialog) の test
// double を使う (FakeRepo は in-memory disk、FakeUI は in-memory toast/dialog log)。
// State だけ Fake にするのは tautology なのでしない。
//
// 主な検証ポイント:
//   - savedToken の capture timing が IPC await の前 (race regression 防止)
//   - 連打抑止 (saving フラグで saveCurrent の再入禁止)
//   - openFile の dirty チェック分岐 (save / discard / cancel)
//   - 初期状態は clean
//   - applySnapshot 後に dirty にならない (load 後 baseline 化)
//   - save → load の round-trip (real State.toSnapshot/applySnapshot 経由)

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import { FileIOInteractor } from '../src/usecases/menu/file-io-interactor';
import type { DocumentRepository } from '../src/repository/document-interface';
import type { DocumentSnapshot, LoadResult, SaveResult } from '../src/core/document/snapshot';
import type { UIPort, DiscardChoice } from '../src/usecases/ui-port-interface';
import type { Command, ObjectSnapshot } from '../src/core/history/types';
import type { ObjectId } from '../src/core/object-id';
import { State } from '../src/renderer/state';
import { NullFontProvider } from './fakes';

// ── 外部 boundary の test double ─────────────────────────────────────────
//
// Repository / UIPort は file system / OS dialog という外部世界を抽象化した port。
// production は FileSystemDocumentRepository / ElectronUIPort で実装するが、
// test ではディスクに書きたくない / OS dialog は modal で blocking なので、in-memory
// 実装で代用する。これは「test の対象 (= FileIOInteractor) の周辺を fake する」
// という normal な test double 用法であって、対象自身を fake にしているわけではない。

class FakeRepo implements DocumentRepository {
  // save / load の戻り値を test ごとに差し替える hook。
  saveResult: SaveResult = { ok: true, filePath: '/tmp/foo.mply' };
  loadResult: LoadResult = {
    ok: true,
    snapshot: { format: 'mojiplay', version: 1, canvas: { objects: [] } },
    filePath: '/tmp/bar.mply',
  };

  // 「ディスク」相当の永続ストレージ。save が成功すると ここに書き、load は
  // ここに値があればそれを返す (= 同じ FakeRepo 経由なら保存内容を読み戻せる)。
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
    if (this.storedSnapshot && this.storedPath) {
      return { ok: true, snapshot: this.storedSnapshot, filePath: this.storedPath };
    }
    return this.loadResult;
  }
}

class FakeUI implements UIPort {
  toasts: Array<{ message: string; isError: boolean }> = [];
  discardAnswer: DiscardChoice = 'cancel';
  yesNoAnswer = false;
  dirtyValues: boolean[] = [];

  showToast(message: string, isError = false): void {
    this.toasts.push({ message, isError });
  }
  async confirmDiscard(_message: string): Promise<DiscardChoice> {
    return this.discardAnswer;
  }
  async confirmYesNo(_message: string): Promise<boolean> {
    return this.yesNoAnswer;
  }
  setNativeDirty(dirty: boolean): void {
    this.dirtyValues.push(dirty);
  }
  async copyImageToClipboard(_dataUrl: string): Promise<void> {
    /* no-op */
  }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

// ── State 操作 helper ────────────────────────────────────────────────────
//
// real State.pushCommand は token を bump して onMutate を発火する (= 「ユーザが
// 編集した」相当)。content を変える必要が無い場合はこれで dirty 化できる。
const DUMMY_COMMAND: Command = {
  kind: 'objectChanged',
  objectId: 'dummy' as ObjectId,
  before: {
    type: 'text',
    data: { objectId: 'dummy' as ObjectId, type: 'text' },
  } as unknown as ObjectSnapshot,
  after: {
    type: 'text',
    data: { objectId: 'dummy' as ObjectId, type: 'text' },
  } as unknown as ObjectSnapshot,
};

function simulateMutation(state: State): void {
  state.pushCommand(DUMMY_COMMAND);
}

// 「content を入れ替える (= 初期 fixture の投入も、後続の編集でも)」を applySnapshot
// で表現。fabric stub の loadFromJSON が type に応じて FakeFabricText/Path/IText を
// 構築するため、objects 配列に shape 自由に入れて round-trip 検証できる。
async function loadCanvasContent(
  state: State,
  objects: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  await state.applySnapshot({
    format: 'mojiplay',
    version: 1,
    canvas: { objects },
  });
}

function makeController(): {
  ctrl: FileIOInteractor;
  state: State;
  repo: FakeRepo;
  ui: FakeUI;
} {
  const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
  const repo = new FakeRepo();
  const ui = new FakeUI();
  const ctrl = new FileIOInteractor(state, repo, ui, basename);
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
      simulateMutation(state);
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });
  });

  describe('saveCurrent', () => {
    test('成功で dirty=false になり fileName を反映する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      expect(ctrl.getDocStatus().dirty).toBe(true);
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(true);
      expect(repo.saveCalled).toBe(1);
      expect(ctrl.getDocStatus()).toEqual({ fileName: 'foo.mply', dirty: false });
      expect(ui.toasts.some((t) => !t.isError && t.message.includes('保存しました'))).toBe(true);
    });

    test('commit を先に呼ぶ (IText 編集中 commit 規約)', async () => {
      // IText 編集中で commit が要るシナリオ: 1 文字選択された IText をシード後、
      // active にして isEditing=true を立てる。saveCurrent が state.commitActiveText を
      // 経由して discardActiveObject を呼ぶことで isEditing=false に戻ることを観測する。
      const { ctrl, state } = makeController();
      simulateMutation(state);

      // active な i-text を seed (isEditing は手動で true にして編集中 simulate)
      await loadCanvasContent(state, [
        {
          type: 'i-text',
          text: '',
          left: 0,
          top: 0,
          fontFamily: 'Arial',
          fontSize: 16,
          data: { objectId: 'a' },
        },
      ]);
      const [h] = state.getAllObjects();
      state.setActiveSelection([h]);
      const obj = (h as unknown as { _obj: { isEditing: boolean } })._obj;
      obj.isEditing = true;

      await ctrl.saveCurrent();
      // commitActiveText 内の discardActiveObject が走り、selection が外れる ⇒
      // commit の経路が実際に通った証拠
      expect(state.getActiveObjects()).toHaveLength(0);
    });

    test('token を await 前に capture する (race regression 防止)', async () => {
      // fabric.js / IPC roundtrip の async 中にユーザが編集すると token が進む。
      // savedToken を await 前に capture することで、await 中の編集を dirty に残せる。
      const { ctrl, state, repo } = makeController();
      simulateMutation(state); // token=1

      let resolveSave: (v: SaveResult) => void = () => {};
      repo.onSave = () =>
        new Promise((res) => {
          resolveSave = res;
        });

      const savePromise = ctrl.saveCurrent();
      simulateMutation(state); // await 中の編集 (token=2)
      resolveSave({ ok: true, filePath: '/tmp/foo.mply' });
      await savePromise;

      // savedToken は capture 時点 (=1) を採用、現 token (=2) と不一致 → dirty
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });

    test('saving 中は再入を block する (連打抑止)', async () => {
      const { ctrl, state, repo } = makeController();
      simulateMutation(state);

      let resolveSave: (v: SaveResult) => void = () => {};
      repo.onSave = () =>
        new Promise((res) => {
          resolveSave = res;
        });

      const p1 = ctrl.saveCurrent();
      const p2 = ctrl.saveCurrent();
      const p3 = ctrl.saveCurrent();
      resolveSave({ ok: true, filePath: '/tmp/foo.mply' });

      expect(await p1).toBe(true);
      expect(await p2).toBe(false);
      expect(await p3).toBe(false);
      expect(repo.saveCalled).toBe(1);
    });

    test('cancel では toast を出さず dirty も維持する (silent)', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      repo.saveResult = { ok: false, canceled: true };
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(false);
      expect(ui.toasts.length).toBe(0);
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });

    test('error は toast に出す', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      repo.saveResult = { ok: false, canceled: false, error: { message: 'disk full' } };
      const ok = await ctrl.saveCurrent();
      expect(ok).toBe(false);
      expect(ui.toasts.some((t) => t.isError && t.message.includes('disk full'))).toBe(true);
    });
  });

  describe('saveAs', () => {
    test('currentPath を null にして保存 dialog を強制起動できる', async () => {
      const { ctrl, repo } = makeController();
      await ctrl.saveCurrent();
      expect(ctrl.getDocStatus().fileName).toBe('foo.mply');
      expect(repo.lastSavedPath).toBe(null);

      repo.saveResult = { ok: true, filePath: '/tmp/foo.mply' };
      await ctrl.saveCurrent();
      expect(repo.lastSavedPath).toBe('/tmp/foo.mply');

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
      expect(ctrl.getDocStatus().fileName).toBe('foo.mply');
    });
  });

  describe('openFile', () => {
    test('dirty 時に discard を選ぶと save をスキップして load する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      ui.discardAnswer = 'discard';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(0);
      expect(repo.loadCalled).toBe(1);
      expect(state.getAllObjects()).toHaveLength(0); // loadResult のデフォルト
      expect(ctrl.getDocStatus()).toEqual({ fileName: 'bar.mply', dirty: false });
    });

    test('dirty 時に cancel を選ぶと何もしない', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      ui.discardAnswer = 'cancel';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(0);
      expect(repo.loadCalled).toBe(0);
      expect(ctrl.getDocStatus().dirty).toBe(true);
    });

    test('dirty 時に save 成功なら save 後 load する', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      ui.discardAnswer = 'save';
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(1);
      expect(repo.loadCalled).toBe(1);
    });

    test('dirty 時に save 失敗なら load しない', async () => {
      const { ctrl, state, repo, ui } = makeController();
      simulateMutation(state);
      ui.discardAnswer = 'save';
      repo.saveResult = { ok: false, canceled: true };
      await ctrl.openFile();
      expect(repo.saveCalled).toBe(1);
      expect(repo.loadCalled).toBe(0);
    });

    test('load 後は dirty=false になる (savedToken を post-load に baseline 化)', async () => {
      const { ctrl, state, ui } = makeController();
      simulateMutation(state);
      ui.discardAnswer = 'discard';
      await ctrl.openFile();
      expect(ctrl.getDocStatus().dirty).toBe(false);
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
      repo.loadResult = {
        ok: false,
        canceled: false,
        error: { kind: 'invalid-json', message: 'unexpected token' },
      };
      await ctrl.openFile();
      expect(ui.toasts.some((t) => t.isError && t.message.includes('不正なファイル形式'))).toBe(
        true,
      );
    });
  });

  describe('confirmDiscardIfDirty', () => {
    test('clean なら true を返して確認 dialog を出さない', async () => {
      const { ctrl, ui } = makeController();
      const ok = await ctrl.confirmDiscardIfDirty();
      expect(ok).toBe(true);
      expect(ui.dirtyValues.length).toBe(0);
    });
  });

  describe('subscribeDocStatus', () => {
    test('登録直後と mutation 時に通知し、unsub 後は通知しない', () => {
      const { ctrl, state } = makeController();
      const log: Array<{ fileName: string | null; dirty: boolean }> = [];
      const unsub = ctrl.subscribeDocStatus((s) => log.push({ ...s }));
      expect(log.length).toBe(1);
      expect(log[0]).toEqual({ fileName: null, dirty: false });
      simulateMutation(state);
      expect(log.length).toBe(2);
      expect(log[1].dirty).toBe(true);
      unsub();
      simulateMutation(state);
      expect(log.length).toBe(2);
    });
  });

  describe('setNativeDirty', () => {
    test('UIPort に dirty 値を push する (main の close guard 連動)', async () => {
      const { ctrl, state, ui } = makeController();
      simulateMutation(state);
      expect(ui.dirtyValues).toEqual([true]);
      await ctrl.saveCurrent();
      expect(ui.dirtyValues[ui.dirtyValues.length - 1]).toBe(false);
    });
  });

  // 一番ユーザー目線で意味のある契約: 「保存した State を開けば同一の State に戻る」。
  // FileIOInteractor + real State.toSnapshot/applySnapshot + Repository の round-trip
  // を統合的に検証する。
  describe('save → load の round-trip', () => {
    const SAMPLE_OBJECTS: ReadonlyArray<Record<string, unknown>> = [
      {
        type: 'i-text',
        text: 'hello',
        left: 10,
        top: 20,
        fontFamily: 'Arial',
        fontSize: 16,
        data: { objectId: 'a' },
      },
      {
        type: 'i-text',
        text: 'world',
        left: 30,
        top: 40,
        fontFamily: 'Arial',
        fontSize: 16,
        data: { objectId: 'b' },
      },
    ];

    test('別 instance で openFile しても保存時点と同一 snapshot に戻る (アプリ再起動相当)', async () => {
      const repo = new FakeRepo();

      // インスタンス A: 内容を入れて保存
      const stateA = new State(new FakeFabricCanvas() as never, new NullFontProvider());
      const ctrlA = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
      await loadCanvasContent(stateA, SAMPLE_OBJECTS);
      const savedSnapshot = stateA.toSnapshot();
      expect(await ctrlA.saveCurrent()).toBe(true);

      // インスタンス B (= 別 process / 再起動相当): 同じ repo から開く
      const stateB = new State(new FakeFabricCanvas() as never, new NullFontProvider());
      const ctrlB = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
      await ctrlB.openFile();

      // ロード後の State の snapshot が保存時点と完全一致
      expect(stateB.toSnapshot()).toEqual(savedSnapshot);
    });

    test('save → 編集 → openFile (discard) で保存時点の snapshot に戻る', async () => {
      const { ctrl, state, ui } = makeController();

      await loadCanvasContent(state, [
        {
          type: 'i-text',
          text: 'original',
          left: 0,
          top: 0,
          fontFamily: 'Arial',
          fontSize: 16,
          data: { objectId: 'a' },
        },
      ]);
      const savedSnapshot = state.toSnapshot();
      await ctrl.saveCurrent();
      expect(ctrl.getDocStatus().dirty).toBe(false);

      // 保存後に別の content で上書き (= ユーザの編集相当)
      await loadCanvasContent(state, [
        {
          type: 'i-text',
          text: 'modified',
          left: 0,
          top: 0,
          fontFamily: 'Arial',
          fontSize: 16,
          data: { objectId: 'b' },
        },
      ]);
      expect(ctrl.getDocStatus().dirty).toBe(true);

      // 開き直す: 編集を破棄して保存版をロード
      ui.discardAnswer = 'discard';
      await ctrl.openFile();

      expect(state.toSnapshot()).toEqual(savedSnapshot);
      expect(ctrl.getDocStatus().dirty).toBe(false);
    });

    test('複数回 save しても最新版が load される', async () => {
      const { ctrl, state, ui } = makeController();

      await loadCanvasContent(state, [
        { type: 'i-text', text: 'v1', left: 0, top: 0, data: { objectId: 'a' } },
      ]);
      await ctrl.saveCurrent();

      await loadCanvasContent(state, [
        { type: 'i-text', text: 'v2', left: 0, top: 0, data: { objectId: 'b' } },
      ]);
      await ctrl.saveCurrent();

      await loadCanvasContent(state, [
        { type: 'i-text', text: 'v3', left: 0, top: 0, data: { objectId: 'c' } },
      ]);
      await ctrl.saveCurrent();
      const v3Snapshot = state.toSnapshot();

      // 適当に編集して discard で開き直す
      await loadCanvasContent(state, [
        { type: 'i-text', text: 'unsaved', left: 0, top: 0, data: { objectId: 'd' } },
      ]);
      ui.discardAnswer = 'discard';
      await ctrl.openFile();

      expect(state.toSnapshot()).toEqual(v3Snapshot);
    });

    // アウトライン化済 path (`type: 'path'` + `data.outlined: true`) を含む round-trip。
    // i-text のみだと、以下が静かに壊れても気づけない:
    //   - data.outlined フラグの persistence (= open 後にアンカー編集 / pen tool が効くか)
    //   - path commands (M / C / L / Z 列) の損失なし復元
    //   - data.groupId の保持 (= 単語単位選択が壊れないか)
    //   - text と path が同じ groupId で混在するケース (アウトライン化部分適用相当)
    describe('outlined path を含む round-trip', () => {
      const SAMPLE_PATH_OBJECTS: ReadonlyArray<Record<string, unknown>> = [
        {
          type: 'path',
          path: [['M', 0, 0], ['C', 10, 0, 10, 10, 0, 10], ['L', -5, 5], ['Z']],
          left: 100,
          top: 200,
          fill: '#000000',
          data: { objectId: 'p1', type: 'path', outlined: true, groupId: 'g1', charIndex: 0 },
        },
        {
          type: 'path',
          path: [['M', 5, 5], ['C', 15, 5, 15, 15, 5, 15], ['Z']],
          left: 150,
          top: 200,
          fill: '#000000',
          data: { objectId: 'p2', type: 'path', outlined: true, groupId: 'g1', charIndex: 1 },
        },
      ];

      test('outlined path のみの canvas が同一 snapshot で復元される', async () => {
        const repo = new FakeRepo();
        const stateA = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlA = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
        await loadCanvasContent(stateA, SAMPLE_PATH_OBJECTS);
        const savedSnapshot = stateA.toSnapshot();
        expect(await ctrlA.saveCurrent()).toBe(true);

        const stateB = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlB = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
        await ctrlB.openFile();

        expect(stateB.toSnapshot()).toEqual(savedSnapshot);
      });

      test('open 後も data.outlined と data.groupId が保持される (アンカー編集可能性 / 単語性の維持)', async () => {
        const repo = new FakeRepo();
        const stateA = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlA = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
        await loadCanvasContent(stateA, SAMPLE_PATH_OBJECTS);
        await ctrlA.saveCurrent();

        const stateB = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlB = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
        await ctrlB.openFile();

        const snap = stateB.toSnapshot() as {
          canvas: { objects: Array<{ data?: Record<string, unknown> }> };
        };
        expect(snap.canvas.objects).toHaveLength(2);
        expect(snap.canvas.objects[0].data).toMatchObject({
          outlined: true,
          groupId: 'g1',
          type: 'path',
        });
        expect(snap.canvas.objects[1].data).toMatchObject({
          outlined: true,
          groupId: 'g1',
          type: 'path',
        });
      });

      test('path commands 配列 (M/C/L/Z) が損失なく復元される', async () => {
        const repo = new FakeRepo();
        const stateA = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlA = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
        await loadCanvasContent(stateA, [SAMPLE_PATH_OBJECTS[0]]);
        await ctrlA.saveCurrent();

        const stateB = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlB = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
        await ctrlB.openFile();

        const snap = stateB.toSnapshot() as {
          canvas: { objects: Array<{ path?: ReadonlyArray<ReadonlyArray<unknown>> }> };
        };
        expect(snap.canvas.objects[0].path).toEqual([
          ['M', 0, 0],
          ['C', 10, 0, 10, 10, 0, 10],
          ['L', -5, 5],
          ['Z'],
        ]);
      });

      test('text と outlined path が混在する canvas も同一 snapshot で復元される', async () => {
        const repo = new FakeRepo();
        const stateA = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlA = new FileIOInteractor(stateA, repo, new FakeUI(), basename);
        await loadCanvasContent(stateA, [
          {
            type: 'i-text',
            text: 'A',
            left: 0,
            top: 0,
            fontFamily: 'Arial',
            fontSize: 16,
            data: { objectId: 't1', groupId: 'g-text' },
          },
          ...SAMPLE_PATH_OBJECTS,
        ]);
        const savedSnapshot = stateA.toSnapshot();
        await ctrlA.saveCurrent();

        const stateB = new State(new FakeFabricCanvas() as never, new NullFontProvider());
        const ctrlB = new FileIOInteractor(stateB, repo, new FakeUI(), basename);
        await ctrlB.openFile();

        expect(stateB.toSnapshot()).toEqual(savedSnapshot);
        expect(stateB.getAllObjects()).toHaveLength(3);
      });
    });
  });
});
