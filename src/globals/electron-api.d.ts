type SaveResult =
  | { success: true; filePath: string }
  | { success: false; reason: string };

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
    log?: {
      debug(msg: string): Promise<void>;
      info(msg: string):  Promise<void>;
      warn(msg: string):  Promise<void>;
      error(msg: string): Promise<void>;
    };
  };
}
