// move-selected-anchors-by-arrow use case の test。
//
// 検証方針:
//   - arrowKeyToDirection / arrowStepMagnitude は pure なので fabric なしで単体 test
//   - moveSelectedAnchorsByArrow は real State + fake SelectCharTool で integration
//     test。tool の moveSelectedAnchorsBy が正しい delta で呼ばれるか / no-selection
//     時に no-op + false return するかを観測する

jest.mock('../src/renderer/outline-conversion', () => ({
  outlineTextToPath: jest.fn(async () => null),
}));

import { installFabricStub, FakeFabricCanvas } from './fabric-stub';

installFabricStub();

import {
  arrowKeyToDirection,
  arrowStepMagnitude,
  moveSelectedAnchorsByArrow,
  type ArrowDirection,
} from '../src/usecases/menu/move-selected-anchors-by-arrow';
import { State } from '../src/renderer/state';
import type { SelectCharTool } from '../src/usecases/tools/select-char-tool';

describe('arrowKeyToDirection (pure)', () => {
  test.each<[string, ArrowDirection | null]>([
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['Enter', null],
    ['a', null],
    ['', null],
  ])('%s → %s', (key, expected) => {
    expect(arrowKeyToDirection(key)).toBe(expected);
  });
});

describe('arrowStepMagnitude (pure)', () => {
  test('shift なしで 1 (Photoshop 標準ステップ)', () => {
    expect(arrowStepMagnitude(false)).toBe(1);
  });
  test('shift ありで 10 (Photoshop 大ステップ)', () => {
    expect(arrowStepMagnitude(true)).toBe(10);
  });
});

// 必要最小の SelectCharTool surface だけ模擬。test 対象は use case なので、tool は
// 「呼ばれた delta を記録する箱」として fake する。
class FakeSelectCharTool {
  selectedCount = 0;
  moveCalls: Array<{ dx: number; dy: number }> = [];

  getSelectedAnchorIndices(): ReadonlySet<number> {
    return new Set(Array.from({ length: this.selectedCount }, (_, i) => i));
  }
  moveSelectedAnchorsBy(_state: unknown, worldDx: number, worldDy: number): void {
    this.moveCalls.push({ dx: worldDx, dy: worldDy });
  }
}

describe('moveSelectedAnchorsByArrow (orchestration)', () => {
  function setup(selectedCount: number): { state: State; tool: FakeSelectCharTool } {
    const canvas = new FakeFabricCanvas();
    const state = new State(canvas as never);
    const tool = new FakeSelectCharTool();
    tool.selectedCount = selectedCount;
    return { state, tool };
  }

  test('selection 無しなら false を返して tool を呼ばない', () => {
    const { state, tool } = setup(0);
    const acted = moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'left', 1);
    expect(acted).toBe(false);
    expect(tool.moveCalls).toHaveLength(0);
  });

  test('left direction で (-magnitude, 0) を tool に渡す', () => {
    const { state, tool } = setup(1);
    const acted = moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'left', 1);
    expect(acted).toBe(true);
    expect(tool.moveCalls).toEqual([{ dx: -1, dy: 0 }]);
  });

  test('right direction で (+magnitude, 0) を tool に渡す', () => {
    const { state, tool } = setup(1);
    moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'right', 1);
    expect(tool.moveCalls).toEqual([{ dx: 1, dy: 0 }]);
  });

  test('up direction で (0, -magnitude) を tool に渡す', () => {
    const { state, tool } = setup(1);
    moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'up', 1);
    expect(tool.moveCalls).toEqual([{ dx: 0, dy: -1 }]);
  });

  test('down direction で (0, +magnitude) を tool に渡す', () => {
    const { state, tool } = setup(1);
    moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'down', 1);
    expect(tool.moveCalls).toEqual([{ dx: 0, dy: 1 }]);
  });

  test('magnitude 10 (= Shift+矢印) でステップが 10 倍になる', () => {
    const { state, tool } = setup(1);
    moveSelectedAnchorsByArrow(state, tool as unknown as SelectCharTool, 'right', 10);
    expect(tool.moveCalls).toEqual([{ dx: 10, dy: 0 }]);
  });
});
