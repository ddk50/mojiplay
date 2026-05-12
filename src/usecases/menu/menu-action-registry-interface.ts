// MenuActionRegistry の public 契約。
//
// Factory + 実装は ./menu-action-registry.ts の createMenuActionRegistry。

import type { State } from '../../core/state-interface';
import type { UIPort } from '../ui-port-interface';
import type { HostShell } from '../host-shell-interface';
import type { MenuAction } from './menu-action-interface';
import type { FileIOInteractor } from './file-io-interactor';

export interface MenuActionRegistryDeps {
  state: State;
  ui: UIPort;
  fileIO: FileIOInteractor;
  host: HostShell;
}

export interface MenuActionRegistry {
  /** 指定 id のアクションを実行。未登録 id は no-op。 */
  execute(id: string): void | Promise<void>;
  /** 指定 id のアクション取得 (canExecute 確認等)。未登録なら null。 */
  get(id: string): MenuAction | null;
}
