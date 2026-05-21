// UIPort: Use Case 層から見た「UI 副作用」の output port (Clean Architecture の Port)。
//
// FileIOInteractor などの Use Case が DOM / Electron を直接知らずに済むよう抽象化。
// concrete 実装は renderer/ui-port-impl.ts (showToast + electronAPI bridge)。
// test 時は FakeUIPort を constructor に inject。

export type DiscardChoice = 'save' | 'discard' | 'cancel';

export interface UIPort {
  /** ユーザ向けトースト通知 (3 秒で自動消去)。 */
  showToast(message: string, isError?: boolean): void;

  /** 「保存しますか?」3 択ダイアログ。OS native dialog 経由の想定。 */
  confirmDiscard(message: string): Promise<DiscardChoice>;

  /** 破壊的操作 (clearAll 等) の確認 yes/no ダイアログ。
   *  user が yes (= 続行) を選んだら true、cancel なら false。 */
  confirmYesNo(message: string): Promise<boolean>;

  /** main process に dirty 状態を通知 (= window 閉じ時の 3 択 dialog 判定で使う)。 */
  setNativeDirty(dirty: boolean): void;

  /** PNG dataURL をクリップボードに画像としてコピー (Edit > Copy / Ctrl+C 経由)。 */
  copyImageToClipboard(dataUrl: string): Promise<void>;
}
