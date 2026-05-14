// MenuActionRegistry の単体テスト。
//
// 検証方針: real State + fabric stub + fake UIPort + fake HostShell + fake FileIOInteractor。
// MenuAction は thin wrapper なので、execute() 経由で対応する dependency の method が
// 呼ばれることを確認すれば十分。

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';
installFabricStub();

import { State } from '../src/renderer/state';
import { NullFontProvider } from './fakes';
import { createMenuActionRegistry } from '../src/usecases/menu/menu-action-registry';
import type { MenuActionRegistry } from '../src/usecases/menu/menu-action-registry-interface';
import type { UIPort, DiscardChoice } from '../src/usecases/ui-port-interface';
import type { HostShell } from '../src/usecases/host-shell-interface';
import type { FileIOInteractor } from '../src/usecases/menu/file-io-interactor';

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

class FakeFileIO {
  openCalled = 0;
  saveCurrentCalled = 0;
  saveAsCalled = 0;
  async openFile(): Promise<void> {
    this.openCalled++;
  }
  async saveCurrent(): Promise<boolean> {
    this.saveCurrentCalled++;
    return true;
  }
  async saveAs(): Promise<boolean> {
    this.saveAsCalled++;
    return true;
  }
}

function setup(): {
  registry: MenuActionRegistry;
  state: State;
  ui: FakeUI;
  host: FakeHost;
  fileIO: FakeFileIO;
} {
  const state = new State(new FakeFabricCanvas() as never, new NullFontProvider());
  const ui = new FakeUI();
  const host = new FakeHost();
  const fileIO = new FakeFileIO();
  const registry = createMenuActionRegistry({
    state,
    ui,
    host,
    fileIO: fileIO as unknown as FileIOInteractor,
  });
  return { registry, state, ui, host, fileIO };
}

describe('MenuActionRegistry', () => {
  test('未登録 id は no-op (エラーにならない)', async () => {
    const { registry } = setup();
    expect(() => registry.execute('xxx-unknown')).not.toThrow();
  });

  test('get() で登録済 action を取得できる', () => {
    const { registry } = setup();
    expect(registry.get('select-all')?.id).toBe('select-all');
    expect(registry.get('xxx-unknown')).toBeNull();
  });

  test("execute('select-all') が State.selectAllObjects を呼ぶ", async () => {
    const { registry, state } = setup();
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [{ type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } }],
      } as unknown,
    });
    await registry.execute('select-all');
    expect(state.getActiveObjects()).toHaveLength(1);
  });

  test("execute('undo') / execute('redo') が State.undo / State.redo を呼ぶ", async () => {
    const { registry, state } = setup();
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

    await registry.execute('undo');
    await registry.execute('redo');
    expect(undoCalled).toBe(1);
    expect(redoCalled).toBe(1);
  });

  test("execute('zoom-in' / 'zoom-out' / 'zoom-reset') が host.setZoom を呼ぶ", async () => {
    const { registry, host } = setup();
    await registry.execute('zoom-in');
    await registry.execute('zoom-out');
    await registry.execute('zoom-reset');
    expect(host.zoomCalls).toEqual(['in', 'out', 'reset']);
  });

  test("execute('fullscreen') が host.toggleFullscreen を呼ぶ", async () => {
    const { registry, host } = setup();
    await registry.execute('fullscreen');
    expect(host.fullscreenCalls).toBe(1);
  });

  test("execute('devtools') が host.toggleDevTools を呼ぶ", async () => {
    const { registry, host } = setup();
    await registry.execute('devtools');
    expect(host.devToolsCalls).toBe(1);
  });

  test("execute('file-save' / 'file-save-as' / 'file-open') が FileIOInteractor を呼ぶ", async () => {
    const { registry, fileIO } = setup();
    await registry.execute('file-save');
    await registry.execute('file-save-as');
    await registry.execute('file-open');
    expect(fileIO.saveCurrentCalled).toBe(1);
    expect(fileIO.saveAsCalled).toBe(1);
    expect(fileIO.openCalled).toBe(1);
  });

  test("execute('outline') が UIPort.showToast に「選択してください」を出す (= 選択無し時)", async () => {
    const { registry, ui } = setup();
    await registry.execute('outline');
    expect(ui.toasts.length).toBeGreaterThan(0);
    expect(ui.toasts[0]).toMatchObject({ isError: true });
  });

  test("execute('clear-all') yes で State.clearAll を呼ぶ", async () => {
    const { registry, state, ui } = setup();
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
    await registry.execute('clear-all');
    expect(state.getAllObjects()).toHaveLength(0);
  });

  test("execute('clear-all') no で State.clearAll を呼ばない", async () => {
    const { registry, state, ui } = setup();
    await state.applySnapshot({
      format: 'mojiplay',
      version: 1,
      canvas: {
        objects: [{ type: 'text', text: 'A', data: { objectId: 'id1', type: 'text' } }],
      } as unknown,
    });
    expect(state.getAllObjects()).toHaveLength(1);
    ui.yesNoAnswer = false;
    await registry.execute('clear-all');
    expect(state.getAllObjects()).toHaveLength(1);
  });

  test("execute('export-canvas-png') が host.savePng を canvas dataURL で呼ぶ", async () => {
    const { registry, host, ui } = setup();
    await registry.execute('export-canvas-png');
    expect(host.savePngCalls).toHaveLength(1);
    expect(host.savePngCalls[0]).toMatch(/^data:image\/png/);
    expect(ui.toasts.some((t) => !t.isError && t.message.includes('保存しました'))).toBe(true);
  });
});
