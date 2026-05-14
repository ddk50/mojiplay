// 矢印キーで選択中アンカーを world delta 分ずらす use case (select-char モード)。
//
// 旧 KeyboardController.onKeyDownBubble に inline で書かれていた arrow → direction →
// step → tool 呼び出しを 2 段階に分解:
//   - arrowKeyToDirection: pure function (key → 方向 enum)。test 容易。
//   - moveSelectedAnchorsByArrow: orchestration (selection 有無チェック + tool 呼び出し)。
//     act したかを bool で返す (controller 側で preventDefault するか判定するため)。
//
// 修飾子チェック (no ctrl/meta/alt)、mode チェック、toolbar input focus チェックは
// controller 側 (event filter) に残す。

import type { State } from '../../core/state-interface';
import type { SelectCharTool } from '../tools/select-char-tool';

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

/** KeyboardEvent.key を arrow direction に変換。非 arrow キーなら null。 */
export function arrowKeyToDirection(key: string): ArrowDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

/** Photoshop 流のステップ幅 (Shift で 10 倍。アンカー移動は 1px / 10px の 2 段階)。 */
export function arrowStepMagnitude(shift: boolean): number {
  return shift ? 10 : 1;
}

function directionToDelta(d: ArrowDirection): { dx: number; dy: number } {
  switch (d) {
    case 'left':
      return { dx: -1, dy: 0 };
    case 'right':
      return { dx: 1, dy: 0 };
    case 'up':
      return { dx: 0, dy: -1 };
    case 'down':
      return { dx: 0, dy: 1 };
  }
}

/**
 * 選択中アンカーを direction × magnitude だけ移動する。
 * @returns true なら act した (controller 側で preventDefault 推奨)、false なら no-op。
 */
export function moveSelectedAnchorsByArrow(
  state: State,
  tool: SelectCharTool,
  direction: ArrowDirection,
  magnitude: number,
): boolean {
  if (tool.getSelectedAnchorIndices().size === 0) return false;
  const { dx, dy } = directionToDelta(direction);
  tool.moveSelectedAnchorsBy(state, dx * magnitude, dy * magnitude);
  return true;
}
