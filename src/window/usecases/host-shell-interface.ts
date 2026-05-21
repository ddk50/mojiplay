// HostShell: Electron / Web どちらの環境にも存在する「shell 機能」(= window
// 制御 / クリップボード隣接 / IPC からの入力 / 画像保存 / ログ) の Output Port。
//
// CA の Interface Adapter (Output) として、Use Case 層 (FileIOInteractor 等)
// および Controller 層 (ViewController / MenuController / KeyboardController)
// が「外側の世界」に副作用を出す唯一の経路。
//
// Electron 実装は renderer/electron-host-shell.ts (window.electronAPI 経由)。
// 将来の Web 実装は renderer/browser-host-shell.ts (Fullscreen API + a[download]
// + clipboard API + beforeunload) として sibling 配置。
//
// 設計判断:
//   - input cb (onPasteRequest / onCloseGuardRequest) と output method 両方を
//     束ねる facade としている。CA 厳密には Controller (input) と Presenter (output)
//     を別 port にすべきだが、実装現実として「Electron facade」は 1 個で扱うほうが
//     呼び出し側 (Controller の wiring) で見通しが良い。
//   - log は infra 寄りなので HostShell に置く (= renderer/logger.ts は console
//     fallback の static 実装を維持)。

export type CloseGuardDecision = 'destroy' | 'cancel';

export interface HostShellLog {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface HostShell {
  // ── 出力 (= Use Case の output を Frameworks に届ける) ──

  /**
   * PNG dataURL をユーザの選んだ場所に保存。Electron は dialog + write、
   * Web は a[download] で実装する想定。
   */
  savePng(dataUrl: string): Promise<{ ok: true; filePath: string } | { ok: false; reason: string }>;

  /** PNG dataURL をクリップボードに画像としてコピー (Edit > Copy / Ctrl+C 経由)。 */
  copyImageToClipboard(dataUrl: string): Promise<void>;

  /** ズームレベル制御 (Electron: webContents.setZoomLevel、Web: no-op か CSS zoom)。 */
  setZoom(delta: 'in' | 'out' | 'reset'): void;

  /** 全画面切替。 */
  toggleFullscreen(): void;

  /** DevTools 開閉 (Electron のみ。Web は no-op)。 */
  toggleDevTools(): void;

  /** main process / window に dirty 状態を push (= close guard の判定に使う)。 */
  setNativeDirty(dirty: boolean): void;

  // ── 入力 (= Frameworks 側から Use Case / Controller 側へのコールバック登録) ──

  /**
   * Edit > Paste メニューや native menu copy IPC からの paste 要求を購読。
   * 戻り値は unsubscribe 関数。
   */
  onPasteRequest(cb: () => void): () => void;

  /**
   * Edit > Copy メニューや native menu copy IPC からの copy 要求を購読。
   */
  onCopyRequest(cb: () => void): () => void;

  /**
   * window 閉じ要求 (close guard)。renderer は dirty 状態を確認した上で
   * 'destroy' (= close 続行) または 'cancel' (= close 中止) を Promise で返す。
   * 戻り値は unsubscribe 関数。
   */
  onCloseGuardRequest(cb: () => Promise<CloseGuardDecision>): () => void;

  // ── ログ ──

  readonly log: HostShellLog;
}
