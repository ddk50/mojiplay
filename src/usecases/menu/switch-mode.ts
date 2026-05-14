// ツールモード切替の orchestration use case。
//
// 旧 ToolbarController.setMode に inline で書かれていた tool ライフサイクル管理
// (前 mode の onDeactivate → 次 mode の onActivate → state.setMode) を free function
// として extract。controller 側は presentation 責務 (mode button の is-active class
// 切替) だけ残す。
//
// 引数を取るので MenuActionRegistry には登録しない (registry は no-arg execute()
// 前提)。controller / 他 use case から直接 import して呼ぶ。

import type { State, Mode } from '../../core/state-interface';
import type { Tool } from '../tools/tool-interface';

export function switchMode(state: State, tools: Record<Mode, Tool>, next: Mode): void {
  const prev = state.getCurrentMode();
  if (prev !== next) {
    tools[prev].onDeactivate(state);
    tools[next].onActivate(state);
  }
  state.setMode(next);
}
