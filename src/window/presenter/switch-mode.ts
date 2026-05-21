// ツールモード切替の camera 操作 (= renderer presenter)。
//
// mode は camera 層 (CLAUDE.md「camera 層 = viewport / selection / tool mode / IText
// 編集中 state」) で history / 永続化対象外。「アプリの use case (ドキュメント編集)」
// ではなく「現在のツール状態の切替」なので usecases/ ではなく renderer/ に置く。
//
// 旧 ToolbarController.setMode に inline で書かれていた tool ライフサイクル管理
// (前 mode の onDeactivate → 次 mode の onActivate → state.setMode) を free function
// として extract。controller 側は presentation 責務 (mode button の is-active class
// 切替) だけ残す。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';

export function switchMode(state: State, tools: Record<Mode, Tool>, next: Mode): void {
  const prev = state.getCurrentMode();
  if (prev !== next) {
    tools[prev].onDeactivate(state);
    tools[next].onActivate(state);
  }
  state.setMode(next);
}
