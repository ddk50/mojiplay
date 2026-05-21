// MenuActions dispatch object の単体テスト。
//
// 検証方針: real State + fabric stub + fake UIPort + fake HostShell + fake FileIOInteractor。
// 各 action は thin wrapper なので、actions[id]() 経由で対応する dependency の method
// が呼ばれることを確認すれば十分。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';
installFabricStub();

import { State } from '../src/window/presenter/state';
import { NullFontProvider } from './fakes';
import { makeMenuActions, type MenuActions } from '../src/window/menu-action-registry';
import type { UIPort, DiscardChoice } from '../src/window/usecases/ui-port-interface';
import type { HostShell } from '../src/window/usecases/host-shell-interface';
import type { FileIOInteractor } from '../src/window/usecases/menu/file-io-interactor-interface';

class FakeUI implements UIPort {
  toasts: Array<{ message: string; isError: boolean }> = [];
  yesNoAnswer = false;
  showToast(message: string, isError = false): void {
    this.toasts.push({ message, isError });
  }
  async confirmDiscard(_m: string): Promise<DiscardChoice> {
    return 'cancel';
  }
  async confirmYesNo(_m: string): Promise<boolean> {
    return this.yesNoAnswer;
  }
  setNativeDirty(_d: boolean): void {
    /* no-op */
  }
  async copyImageToClipboard(_url: string): Promise<void> {
    /* no-op */
  }
}

class FakeHost implements HostShell {
  zoomCalls: Array<'in' | 'out' | 'reset'> = [];
  fullscreenCalls = 0;
  devToolsCalls = 0;
  savePngCalls: string[] = [];
  log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  async savePng(d: string): Promise<{ ok: true; filePath: string }> {
    this.savePngCalls.push(d);
    return { ok: true, filePath: '/tmp/canvas.png' };
  }
  async copyImageToClipboard(_d: string): Promise<void> {
    /* no-op */
  }
  setZoom(d: 'in' | 'out' | 'reset'): void {
    this.zoomCalls.push(d);
  }
  toggleFullscreen(): void {
    this.fullscreenCalls++;
  }
  toggleDevTools(): void {
    this.devToolsCalls++;
  }
  setNativeDirty(_d: boolean): void {
    /* no-op */
  }
  onPasteRequest(_cb: () => void): () => void {
    return () => {};
  }
  onCopyRequest(_cb: () => void): () => void {
    return () => {};
  }
  onCloseGuardRequest(_cb: () => Promise<'destroy' | 'cancel'>): () => void {
    return () => {};
  }
}

// FileIOInteractor を full implements した fake。test が呼ぶ予定の method
// (openFile / saveCurrent / saveAs) は jest.fn() で観測可能、それ以外は throw で
// 「想定外の呼び出し = test bug」を loud に検出する。
// FileIOInteractor に method が増えたらここが compile error で止まる (= 拡張認知強制)。
class FakeFileIO implements FileIOInteractor {
  openFile = jest.fn(async (): Promise<void> => undefined);
  saveCurrent = jest.fn(async (): Promise<boolean> => true);
  saveAs = jest.fn(async (): Promise<boolean> => true);
  getDocStatus(): never {
    throw new Error('FakeFileIO.getDocStatus: not expected in this test');
  }
  subscribeDocStatus(): never {
    throw new Error('FakeFileIO.subscribeDocStatus: not expected in this test');
  }
  confirmDiscardIfDirty(): never {
    throw new Error('FakeFileIO.confirmDiscardIfDirty: not expected in this test');
  }
}

function setup(): {
  actions: MenuActions;
  state: State;
  ui: FakeUI;
  host: FakeHost;
  fileIO: FakeFileIO;
} {
  const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
  const ui = new FakeUI();
  const host = new FakeHost();
  const fileIO = new FakeFileIO();
  const actions = makeMenuActions({ state, ui, host, fileIO });
  return { actions, state, ui, host, fileIO };
}

describe('makeMenuActions', () => {
  test("'select-all' が State.selectAllObjects を呼ぶ", async () => {
    const { actions, state } = setup();
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [{ type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } }],
      } as unknown,
    });
    await actions['select-all']();
    expect(state.getActiveObjects()).toHaveLength(1);
  });

  test("'undo' / 'redo' が State.undo / State.redo を呼ぶ", async () => {
    const { actions, state } = setup();
    let undoCalled = 0,
      redoCalled = 0;
    const orig = { undo: state.undo.bind(state), redo: state.redo.bind(state) };
    state.undo = () => {
      undoCalled++;
      orig.undo();
    };
    state.redo = () => {
      redoCalled++;
      orig.redo();
    };

    await actions.undo();
    await actions.redo();
    expect(undoCalled).toBe(1);
    expect(redoCalled).toBe(1);
  });

  test("'zoom-in' / 'zoom-out' / 'zoom-reset' が host.setZoom を呼ぶ", async () => {
    const { actions, host } = setup();
    await actions['zoom-in']();
    await actions['zoom-out']();
    await actions['zoom-reset']();
    expect(host.zoomCalls).toEqual(['in', 'out', 'reset']);
  });

  test("'fullscreen' が host.toggleFullscreen を呼ぶ", async () => {
    const { actions, host } = setup();
    await actions.fullscreen();
    expect(host.fullscreenCalls).toBe(1);
  });

  test("'devtools' が host.toggleDevTools を呼ぶ", async () => {
    const { actions, host } = setup();
    await actions.devtools();
    expect(host.devToolsCalls).toBe(1);
  });

  test("'file-save' / 'file-save-as' / 'file-open' が FileIOInteractor を呼ぶ", async () => {
    const { actions, fileIO } = setup();
    await actions['file-save']();
    await actions['file-save-as']();
    await actions['file-open']();
    expect(fileIO.saveCurrent).toHaveBeenCalledTimes(1);
    expect(fileIO.saveAs).toHaveBeenCalledTimes(1);
    expect(fileIO.openFile).toHaveBeenCalledTimes(1);
  });

  test("'outline' が UIPort.showToast に「選択してください」を出す (= 選択無し時)", async () => {
    const { actions, ui } = setup();
    await actions.outline();
    expect(ui.toasts.length).toBeGreaterThan(0);
    expect(ui.toasts[0]).toMatchObject({ isError: true });
  });

  test("'clear-all' yes で State.clearAll を呼ぶ", async () => {
    const { actions, state, ui } = setup();
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [
          { type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } },
          { type: 'text', text: 'B', data: { objectId: 'id2', type: 'text' } },
        ],
      } as unknown,
    });
    expect(state.getAllObjects()).toHaveLength(2);
    ui.yesNoAnswer = true;
    await actions['clear-all']();
    expect(state.getAllObjects()).toHaveLength(0);
  });

  test("'clear-all' no で State.clearAll を呼ばない", async () => {
    const { actions, state, ui } = setup();
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [{ type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } }],
      } as unknown,
    });
    expect(state.getAllObjects()).toHaveLength(1);
    ui.yesNoAnswer = false;
    await actions['clear-all']();
    expect(state.getAllObjects()).toHaveLength(1);
  });

  test("'export-canvas-png' が host.savePng を canvas dataURL で呼ぶ", async () => {
    const { actions, host, ui } = setup();
    await actions['export-canvas-png']();
    expect(host.savePngCalls).toHaveLength(1);
    expect(host.savePngCalls[0]).toMatch(/^data:image\/png/);
    expect(ui.toasts.some((t) => !t.isError && t.message.includes('保存しました'))).toBe(true);
  });
});
