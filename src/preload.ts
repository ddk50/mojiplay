import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  savePng: (base64Data: string): Promise<SaveResult> =>
    ipcRenderer.invoke('save-png', base64Data),
  copyImageToClipboard: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('copy-image', dataUrl),
  onMenuCopy: (callback: () => void): void => {
    ipcRenderer.on('menu-copy', callback);
  },
  toggleDevTools: (): Promise<void> => ipcRenderer.invoke('toggle-devtools'),
  zoomIn:         (): Promise<void> => ipcRenderer.invoke('zoom-in'),
  zoomOut:        (): Promise<void> => ipcRenderer.invoke('zoom-out'),
  zoomReset:      (): Promise<void> => ipcRenderer.invoke('zoom-reset'),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('toggle-fullscreen'),
  undo:  (): Promise<void> => ipcRenderer.invoke('undo'),
  redo:  (): Promise<void> => ipcRenderer.invoke('redo'),
  paste: (): Promise<void> => ipcRenderer.invoke('paste'),

  // ── ドキュメント保存 / 読み込み ──
  saveMply: (json: string, currentPath: string | null): Promise<SaveResult> =>
    ipcRenderer.invoke('save-mply', json, currentPath),
  openMply: (): Promise<OpenResult> => ipcRenderer.invoke('open-mply'),
  confirmDiscard: (message: string): Promise<DiscardChoice> =>
    ipcRenderer.invoke('confirm-discard', message),
  setDirty: (dirty: boolean): Promise<void> =>
    ipcRenderer.invoke('set-dirty', dirty),
  onAppCloseRequest: (callback: () => void): void => {
    ipcRenderer.on('app-close-request', () => callback());
  },
  respondAppClose: (decision: 'destroy' | 'cancel'): Promise<void> =>
    ipcRenderer.invoke('app-close-response', decision),

  log: {
    debug: (msg: string) => ipcRenderer.invoke('log', 'debug', msg),
    info:  (msg: string) => ipcRenderer.invoke('log', 'info',  msg),
    warn:  (msg: string) => ipcRenderer.invoke('log', 'warn',  msg),
    error: (msg: string) => ipcRenderer.invoke('log', 'error', msg),
  },
});
