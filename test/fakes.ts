// テストダブル (= mock 相当) の共通定義。
//
// State / PathHandle interface の method が増えても各 *.test.ts を更新せず
// ここだけ直せば済むように、各 method の no-op default を一箇所にまとめる。
//
// 使い方:
//   - FakePathHandle: そのまま使えば OK。`commands` を直接 read してアサーション
//   - FakeState: `class MyHost extends FakeState { ... }` で必要な method だけ override
//                (TS の構造的 subtyping により method 追加は不要、field 拡張のみで足りる)
//   - pointer(x, y, opts?): PointerInput 生成
//   - IDENT_MATRIX: identity な Mat2x3 (path local ↔ world ↔ screen 変換が無いケース用)

import type { PathCommand } from '../src/core/path/types';
import type { Mat2x3 } from '../src/core/path/coords';
import type { PointerInput } from '../src/usecases/tools/tool-interface';
import type {
  State, PathHandle, PathSnapshot, ObjectHandle, TextCreateProps,
} from '../src/core/state';
import type { Command, ObjectSnapshot } from '../src/core/history/types';
import type { ObjectId } from '../src/core/object-id';
import type { DocumentSnapshot } from '../src/core/document/snapshot';

// ── 共通定数 ──────────────────────────────────────────────────────────────

export const IDENT_MATRIX: Mat2x3 = [1, 0, 0, 1, 0, 0];

// ── PathHandle Fake ──────────────────────────────────────────────────────

export class FakePathHandle implements PathHandle {
  public commands: PathCommand[];
  public finalizeCount = 0;
  public setCount = 0;

  constructor(initial: PathCommand[]) {
    this.commands = initial.map(c => c);
  }

  snapshot(): PathSnapshot {
    return {
      commands: this.commands,
      pathMatrix: IDENT_MATRIX,
      pathOffset: { x: 0, y: 0 },
    };
  }
  setCommands(cmds: ReadonlyArray<PathCommand>): void {
    this.commands = cmds.slice();
    this.setCount++;
  }
  finalizeEdit(): void {
    this.finalizeCount++;
  }
  getId(): ObjectId {
    return 'fake-id-1' as ObjectId;
  }
  captureForHistory(): ObjectSnapshot {
    return {
      type: 'path',
      data: { objectId: 'fake-id-1' as ObjectId, type: 'path' },
      commands: this.commands.slice(),
    } as unknown as ObjectSnapshot;
  }
}

// ── State Fake (base class、no-op default) ────────────────────────────────
//
// 各 test は必要な method / field のみを subclass で override する。
// 例: tools-pen-add では `path: PathHandle | null` field を追加 + `getActivePath` を override。

export class FakeState implements State {
  // ── object / path / text ──
  getActivePath(): PathHandle | null { return null; }
  getViewportMatrix(): Mat2x3 { return IDENT_MATRIX; }
  requestRerender(): void { /* no-op */ }
  setCursor(_c: string): void { /* no-op */ }
  getActiveObjects(): ReadonlyArray<ObjectHandle> { return []; }
  getAllObjects(): ReadonlyArray<ObjectHandle> { return []; }
  setActiveSelection(_h: ReadonlyArray<ObjectHandle>): void { /* no-op */ }
  createTextAt(_x: number, _y: number, _p: TextCreateProps): void { /* no-op */ }

  // ── history ──
  pushCommand(_c: Command): void { /* no-op */ }
  undo(): void { /* no-op */ }
  redo(): void { /* no-op */ }
  canUndo(): boolean { return false; }
  canRedo(): boolean { return false; }

  // ── persistence ──
  toSnapshot(): DocumentSnapshot {
    return { format: 'mojiplay', version: 1, canvas: {} };
  }
  async applySnapshot(_s: DocumentSnapshot): Promise<void> { /* no-op */ }
  commitActiveText(): void { /* no-op */ }

  // ── dirty tracking ──
  getHistoryToken(): number { return 0; }
  onMutate(_cb: () => void): () => void { return () => { /* no-op */ }; }
  clearHistory(): void { /* no-op */ }

  // ── 高レベル selection ──
  getZoom(): number { return 1; }
  removeActiveObjects(): void { /* no-op */ }
  duplicateActiveObjects(_o: { x: number; y: number }): void { /* no-op */ }
  selectAllObjects(): void { /* no-op */ }
  async outlineActiveTexts() {
    return { succeeded: 0, failedChars: '', failedFamilies: [] as string[] };
  }
  exportActiveAsPngDataUrl(_m: number): { dataUrl: string; width: number; height: number } | null {
    return null;
  }

  // ── debug ──
  linearizeHistory(): ReadonlyArray<Command> { return []; }
}

// ── PointerInput helper ──────────────────────────────────────────────────

export function pointer(
  x: number,
  y: number,
  opts?: { altKey?: boolean; shiftKey?: boolean },
): PointerInput {
  return {
    screenX: x, screenY: y,
    worldX: x, worldY: y,
    altKey:   opts?.altKey   ?? false,
    shiftKey: opts?.shiftKey ?? false,
  };
}
