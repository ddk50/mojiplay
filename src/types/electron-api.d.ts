type SaveResult =
  | { success: true; filePath: string }
  | { success: false; reason: string };

interface Window {
  electronAPI?: {
    savePng(base64Data: string): Promise<SaveResult>;
  };
}
