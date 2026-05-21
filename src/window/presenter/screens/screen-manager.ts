// ScreenManager: 登録済 Screen の中から 1 つを active にする薄い切替 helper。
//
// active screen を変更する時:
//   1. 旧 screen の unmount() を呼ぶ (Controller detach 等)
//   2. 旧 screen.root から .is-active class を外す (= CSS で display:none)
//   3. 新 screen.root に .is-active を付ける
//   4. 新 screen の mount() を await (= 初期化完了まで待つ)
//
// 各 Screen は ScreenManager 自身を deps として受け取り、screen 切替トリガ
// (例: drawing 画面の bottom-bar から「Font Viewer を開く」ボタン) を実装できる。
// Screen 同士は ScreenManager 経由でのみ切替を起こす (= 直接 root を触らない)。

import type { Screen, ScreenId } from './screen-interface';

export class ScreenManager {
  private current: Screen | null = null;

  constructor(private readonly screens: ReadonlyMap<ScreenId, Screen>) {}

  async show(id: ScreenId): Promise<void> {
    if (this.current?.id === id) return;
    const next = this.screens.get(id);
    if (!next) throw new Error(`ScreenManager: unknown screen id "${id}"`);

    if (this.current) {
      this.current.unmount();
      this.current.root.classList.remove('is-active');
    }
    next.root.classList.add('is-active');
    await next.mount();
    this.current = next;
  }

  /** window unload 等で全 screen を tear-down する用。 */
  detach(): void {
    if (this.current) {
      this.current.unmount();
      this.current.root.classList.remove('is-active');
      this.current = null;
    }
  }
}
