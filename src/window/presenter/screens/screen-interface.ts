// Screen 抽象: 全画面排他で切替可能な独立 UI 単位。
//
// 現状は drawing screen のみ存在し、将来 font-viewer screen を追加する想定。
// ScreenManager が active screen を 1 つだけ DOM 上で可視化する (= 残りは
// CSS で display:none)。各 Screen は自身の Composition Root を内包し、
// state / tools / Controllers / DOM listener の生成と破棄を mount/unmount で
// 完結させる。
//
// `id` は DOM 上の `#screen-{id}` wrapper と紐づく文字列リテラル。HTML 側に
// wrapper element が事前に存在する前提 (= ScreenManager は DOM を生成しない)。

export type ScreenId = 'drawing' | 'font-viewer';

export interface Screen {
  readonly id: ScreenId;
  /** screen ルート要素 (DOM 上に既に存在する `#screen-{id}` を返す)。 */
  readonly root: HTMLElement;
  /** active 化時に呼ばれる。Controller の attach / 初期化を内部で実行。 */
  mount(): void | Promise<void>;
  /** 別 screen に切替時、または window unload 時に呼ばれる。 */
  unmount(): void;
}
