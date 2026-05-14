// key-binding (matchKeyBinding) の test。
//
// 検証方針: pure data + pure function なので fabric / DOM 一切不要。
// KeyboardEvent は最小 surface を object literal で擬似生成。controller 側は
// この binding 表に沿って dispatch するだけなので、ここで全 binding を網羅すれば
// keyboard shortcut の挙動全体が test される。

import { matchKeyBinding, type BindingContext } from '../src/usecases/menu/key-binding';

function makeEvent(opts: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): KeyboardEvent {
  return {
    key: opts.key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
  } as KeyboardEvent;
}

const ctxFull: BindingContext = { hasActiveObject: true, isToolbarInput: false };
const ctxNoSelection: BindingContext = { hasActiveObject: false, isToolbarInput: false };
const ctxToolbar: BindingContext = { hasActiveObject: true, isToolbarInput: true };

describe('matchKeyBinding (capture phase)', () => {
  test('Cmd+Z → undo', () => {
    expect(matchKeyBinding(makeEvent({ key: 'z', meta: true }), 'capture', ctxFull)?.action).toBe(
      'undo',
    );
  });

  test('Ctrl+Z (Windows) → undo', () => {
    expect(matchKeyBinding(makeEvent({ key: 'z', ctrl: true }), 'capture', ctxFull)?.action).toBe(
      'undo',
    );
  });

  test('Cmd+Shift+Z (= e.key="Z") → redo', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'Z', meta: true, shift: true }), 'capture', ctxFull)?.action,
    ).toBe('redo');
  });

  test('Cmd+Shift+z (= e.key="z" + shift) → redo', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'z', meta: true, shift: true }), 'capture', ctxFull)?.action,
    ).toBe('redo');
  });

  test('Cmd+O → file-open', () => {
    expect(matchKeyBinding(makeEvent({ key: 'o', meta: true }), 'capture', ctxFull)?.action).toBe(
      'file-open',
    );
  });

  test('Cmd+S → file-save', () => {
    expect(matchKeyBinding(makeEvent({ key: 's', meta: true }), 'capture', ctxFull)?.action).toBe(
      'file-save',
    );
  });

  test('Cmd+Shift+S → file-save-as', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'S', meta: true, shift: true }), 'capture', ctxFull)?.action,
    ).toBe('file-save-as');
  });

  test('Cmd+Shift+S は file-save にマッチしない (shift の絞り込み)', () => {
    const m = matchKeyBinding(makeEvent({ key: 's', meta: true, shift: true }), 'capture', ctxFull);
    expect(m?.action).toBe('file-save-as');
  });

  test('Z (修飾子無し) は undo にマッチしない', () => {
    expect(matchKeyBinding(makeEvent({ key: 'z' }), 'capture', ctxFull)).toBeNull();
  });

  test('Cmd+C は capture phase ではマッチしない (bubble 専用)', () => {
    expect(matchKeyBinding(makeEvent({ key: 'c', meta: true }), 'capture', ctxFull)).toBeNull();
  });
});

describe('matchKeyBinding (bubble phase)', () => {
  test('Cmd+C + 選択あり → copy', () => {
    expect(matchKeyBinding(makeEvent({ key: 'c', meta: true }), 'bubble', ctxFull)?.action).toBe(
      'copy',
    );
  });

  test('Cmd+C + 選択なし → null (precondition で除外)', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'c', meta: true }), 'bubble', ctxNoSelection),
    ).toBeNull();
  });

  test('Cmd+C + toolbar input focus → null (browser 標準コピー優先)', () => {
    expect(matchKeyBinding(makeEvent({ key: 'c', meta: true }), 'bubble', ctxToolbar)).toBeNull();
  });

  test('Delete → delete (修飾子問わず)', () => {
    expect(matchKeyBinding(makeEvent({ key: 'Delete' }), 'bubble', ctxFull)?.action).toBe('delete');
  });

  test('Backspace → delete', () => {
    expect(matchKeyBinding(makeEvent({ key: 'Backspace' }), 'bubble', ctxFull)?.action).toBe(
      'delete',
    );
  });

  test('Delete + toolbar input focus → null (browser 標準削除優先)', () => {
    expect(matchKeyBinding(makeEvent({ key: 'Delete' }), 'bubble', ctxToolbar)).toBeNull();
  });

  test('delete binding は preventDefault: false', () => {
    const b = matchKeyBinding(makeEvent({ key: 'Delete' }), 'bubble', ctxFull);
    expect(b?.preventDefault).toBe(false);
  });

  test('他 binding は preventDefault undefined (= default true)', () => {
    const b = matchKeyBinding(makeEvent({ key: 'c', meta: true }), 'bubble', ctxFull);
    expect(b?.preventDefault).toBeUndefined();
  });

  test('Cmd+D + 選択あり → duplicate', () => {
    expect(matchKeyBinding(makeEvent({ key: 'd', meta: true }), 'bubble', ctxFull)?.action).toBe(
      'duplicate',
    );
  });

  test('Cmd+Shift+O → outline (alt 不問)', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'O', meta: true, shift: true }), 'bubble', ctxFull)?.action,
    ).toBe('outline');
    // alt 押しても OK
    expect(
      matchKeyBinding(
        makeEvent({ key: 'o', meta: true, shift: true, alt: true }),
        'bubble',
        ctxFull,
      )?.action,
    ).toBe('outline');
  });

  test('F12 → devtools (修飾子問わず)', () => {
    expect(matchKeyBinding(makeEvent({ key: 'F12' }), 'bubble', ctxFull)?.action).toBe('devtools');
  });

  test('Cmd+Shift+I → devtools', () => {
    expect(
      matchKeyBinding(makeEvent({ key: 'I', meta: true, shift: true }), 'bubble', ctxFull)?.action,
    ).toBe('devtools');
  });

  test('未定義 key ("a") → null', () => {
    expect(matchKeyBinding(makeEvent({ key: 'a' }), 'bubble', ctxFull)).toBeNull();
    expect(matchKeyBinding(makeEvent({ key: 'a', meta: true }), 'bubble', ctxFull)).toBeNull();
  });
});
