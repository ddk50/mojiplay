type SaveResult = { success: true; filePath: string } | { success: false; reason: string };

type OpenResult = { ok: true; filePath: string; content: string } | { ok: false; reason: string };

type DiscardChoice = 'save' | 'discard' | 'cancel';

interface Window {
  electronAPI?: {
    savePng(base64Data: string): Promise<SaveResult>;
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
    saveMply(json: string, currentPath: string | null): Promise<SaveResult>;
    openMply(): Promise<OpenResult>;
    /** dirty 状態の確認 dialog (3 択)。OS native messageBox 経由。 */
    confirmDiscard(message: string): Promise<DiscardChoice>;
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
  };
}
