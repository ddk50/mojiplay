// Tool 系 unit test 用の入力ヘルパ。
//
// FakeState / FakePathHandle はかつてここに居たが、State の振る舞いを別実装する
// tautology になっていたため削除済 (= real `class State` (renderer/state.ts) +
// fabric stub に置き換え)。fabric の最小 stub は test/fabric-stub.ts 参照。

import type { PointerInput } from '../src/usecases/tools/tool-interface';

/** screen / world 座標を同値で構築する PointerInput ヘルパ (= viewport 識別変換前提)。 */
export function pointer(
  x: number,
  y: number,
  opts?: { altKey?: boolean; shiftKey?: boolean },
): PointerInput {
  return {
    screenX: x,
    screenY: y,
    worldX: x,
    worldY: y,
    altKey: opts?.altKey ?? false,
    shiftKey: opts?.shiftKey ?? false,
  };
}
