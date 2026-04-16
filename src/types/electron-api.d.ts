type SaveResult =
  | { success: true; filePath: string }
  | { success: false; reason: string };

interface Window {
  electronAPI?: {
    savePng(base64Data: string): Promise<SaveResult>;
    log?: {
      debug(msg: string): Promise<void>;
      info(msg: string):  Promise<void>;
      warn(msg: string):  Promise<void>;
      error(msg: string): Promise<void>;
    };
  };
}
