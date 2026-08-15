// DocumentInteractor (usecases/document-interactor.ts) の単体テスト。
//
// CanvasPort を object literal の fake で差し替えるだけで書ける (fabric stub 不要)
// のが port 分離の狙いそのもの。fake は呼び出しを記録し、assert は「port に何が
// 渡ったか」+ Interactor の public API (canUndo / token 等) で行う。

import type { Command, ObjectSnapshot } from '../src/window/core/history/types';
import type { ObjectId } from '../src/window/core/object-id';
import type { CanvasPort } from '../src/window/usecases/canvas-port-interface';
import { DocumentInteractorImpl } from '../src/window/usecases/document-interactor';

type PortCall =
  | { op: 'writeSnapshot'; snapshot: ObjectSnapshot }
  | { op: 'createFromSnapshot'; snapshot: ObjectSnapshot }
  | { op: 'removeObject'; id: ObjectId }
  | { op: 'requestRender' }
  | { op: 'loadDocument'; canvasJson: unknown }
  | { op: 'dumpDocument' };

function makeFakePort(): { port: CanvasPort; calls: PortCall[] } {
  const calls: PortCall[] = [];
  const port: CanvasPort = {
    writeSnapshot: (snapshot) => {
      calls.push({ op: 'writeSnapshot', snapshot });
    },
    createFromSnapshot: (snapshot) => {
      calls.push({ op: 'createFromSnapshot', snapshot });
    },
    removeObject: (id) => {
      calls.push({ op: 'removeObject', id });
    },
    requestRender: () => {
      calls.push({ op: 'requestRender' });
    },
    loadDocument: async (canvasJson) => {
      calls.push({ op: 'loadDocument', canvasJson });
    },
    dumpDocument: () => {
      calls.push({ op: 'dumpDocument' });
      return { objects: [] };
    },
  };
  return { port, calls };
}

function mkSnap(id: string, tag = 'a'): ObjectSnapshot {
  return {
    type: 'path',
    tag,
    data: { objectId: id as ObjectId, type: 'path' as const },
  };
}

function mkChanged(id: string, fromTag: string, toTag: string) {
  return {
    kind: 'objectChanged' as const,
    objectId: id as ObjectId,
    before: mkSnap(id, fromTag),
    after: mkSnap(id, toTag),
  };
}

function setup(): {
  doc: DocumentInteractorImpl;
  calls: PortCall[];
} {
  const { port, calls } = makeFakePort();
  const doc = new DocumentInteractorImpl({ port, historyMax: 10 });
  return { doc, calls };
}

describe('DocumentInteractor: history と port の連携', () => {
  test('undo(objectChanged) は before を writeSnapshot し render する', () => {
    const { doc, calls } = setup();
    const c = mkChanged('o1', 'a', 'b');
    doc.pushCommand(c);
    expect(calls).toEqual([]); // push は canvas を触らない

    const undone = doc.undo();
    expect(undone).toBe(c);
    expect(calls).toEqual([{ op: 'writeSnapshot', snapshot: c.before }, { op: 'requestRender' }]);
  });

  test('redo(objectChanged) は after を writeSnapshot する', () => {
    const { doc, calls } = setup();
    const c = mkChanged('o1', 'a', 'b');
    doc.pushCommand(c);
    doc.undo();
    calls.length = 0;

    const redone = doc.redo();
    expect(redone).toBe(c);
    expect(calls[0]).toEqual({ op: 'writeSnapshot', snapshot: c.after });
  });

  test('objectCreated の undo は removeObject、redo は createFromSnapshot', () => {
    const { doc, calls } = setup();
    const c: Command = { kind: 'objectCreated', objectId: 'o1' as ObjectId, after: mkSnap('o1') };
    doc.pushCommand(c);

    doc.undo();
    expect(calls[0]).toEqual({ op: 'removeObject', id: 'o1' as ObjectId });

    calls.length = 0;
    doc.redo();
    expect(calls[0]).toEqual({ op: 'createFromSnapshot', snapshot: mkSnap('o1') });
  });

  test('compound の revert は逆順で打ち消す', () => {
    const { doc, calls } = setup();
    const c: Command = {
      kind: 'compound',
      commands: [
        { kind: 'objectDeleted', objectId: 'del1' as ObjectId, before: mkSnap('del1') },
        { kind: 'objectCreated', objectId: 'new1' as ObjectId, after: mkSnap('new1') },
      ],
    };
    doc.pushCommand(c);
    doc.undo();

    // revert 逆順: objectCreated の打ち消し (remove) → objectDeleted の打ち消し (create)
    const ops = calls.map((x) => x.op);
    expect(ops.indexOf('removeObject')).toBeLessThan(ops.indexOf('createFromSnapshot'));
  });

  test('空履歴の undo / redo は null を返し port を触らず token も進めない', () => {
    const { doc, calls } = setup();
    const before = doc.getHistoryToken();
    expect(doc.undo()).toBeNull();
    expect(doc.redo()).toBeNull();
    expect(calls).toEqual([]);
    expect(doc.getHistoryToken()).toBe(before);
  });
});

describe('DocumentInteractor: dirty token / onMutate', () => {
  test('pushCommand / undo / redo / clearHistory で token が進み listener が発火する', () => {
    const { doc } = setup();
    let fired = 0;
    doc.onMutate(() => fired++);

    const t0 = doc.getHistoryToken();
    doc.pushCommand(mkChanged('o1', 'a', 'b'));
    doc.undo();
    doc.redo();
    doc.clearHistory();

    expect(doc.getHistoryToken()).toBe(t0 + 4);
    expect(fired).toBe(4);
  });

  test('onMutate の戻り値で listener を解除できる', () => {
    const { doc } = setup();
    let fired = 0;
    const off = doc.onMutate(() => fired++);
    doc.pushCommand(mkChanged('o1', 'a', 'b'));
    off();
    doc.pushCommand(mkChanged('o1', 'b', 'c'));
    expect(fired).toBe(1);
  });
});

describe('DocumentInteractor: 永続化', () => {
  test('toSnapshot は dumpDocument を format/version で包む', () => {
    const { doc, calls } = setup();
    const snap = doc.toSnapshot();
    expect(snap).toEqual({ format: 'mojiplay', version: 1, canvas: { objects: [] } });
    expect(calls).toEqual([{ op: 'dumpDocument' }]);
  });

  test('applySnapshot は loadDocument して履歴をリセットする', async () => {
    const { doc, calls } = setup();
    doc.pushCommand(mkChanged('o1', 'a', 'b'));
    expect(doc.canUndo()).toBe(true);
    const tokenBefore = doc.getHistoryToken();

    await doc.applySnapshot({ format: 'mojiplay', version: 1, canvas: { objects: [] } });

    expect(calls).toContainEqual({ op: 'loadDocument', canvasJson: { objects: [] } });
    expect(doc.canUndo()).toBe(false);
    expect(doc.canRedo()).toBe(false);
    expect(doc.getHistoryToken()).toBeGreaterThan(tokenBefore);
  });
});
