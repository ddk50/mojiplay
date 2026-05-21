// IPC 越し (contextBridge → window.electronIPC) の API 契約。
//
// preload.ts (impl) / globals/electron-ipc.d.ts (Window 拡張) / host/ipc.ts
// (ipcMain.handle の型) から参照される single source of truth。
// pure type のみ、runtime code 無し。
//
// 注: 同名の SaveResult / LoadResult が core/document/snapshot.ts にもあるが、
// あちらは Use Case 層の domain result (ok/canceled/error の richer 表現)。
// 本ファイルの Ipc* prefix 付きの型は IPC 越しの単純な success/reason 表現で、
// boundary translation は repository/file-system-document.ts で行う。

export type IpcSaveResult =
  | { success: true; filePath: string }
  | { success: false; reason: string };

export type IpcOpenResult =
  | { ok: true; filePath: string; content: string }
  | { ok: false; reason: string };

export type IpcDiscardChoice = 'save' | 'discard' | 'cancel';

export interface ElectronIPC {
  savePng(base64Data: string): Promise<IpcSaveResult>;
  copyImageToClipboard(dataUrl: string): Promise<void>;
  onMenuCopy(callback: () => void): void;
  toggleDevTools(): Promise<void>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  paste(): Promise<void>;

  // ── ドキュメント保存 / 読み込み ──
  /** @param currentPath null なら dialog で新規パス取得、非 null なら同パスへ atomic 上書き */
  saveMply(json: string, currentPath: string | null): Promise<IpcSaveResult>;
  openMply(): Promise<IpcOpenResult>;
  /** dirty 状態の確認 dialog (3 択)。OS native messageBox 経由。 */
  confirmDiscard(message: string): Promise<IpcDiscardChoice>;
  /** main process に dirty を push (= window 閉じ時の close guard 判定で使う)。 */
  setDirty(dirty: boolean): Promise<void>;
  /** main → renderer: window 閉じ要求。renderer は decision を respondAppClose で返す。 */
  onAppCloseRequest(callback: () => void): void;
  respondAppClose(decision: 'destroy' | 'cancel'): Promise<void>;

  log?: {
    debug(msg: string): Promise<void>;
    info(msg: string): Promise<void>;
    warn(msg: string): Promise<void>;
    error(msg: string): Promise<void>;
  };
}
