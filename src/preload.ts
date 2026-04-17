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
  log: {
    debug: (msg: string) => ipcRenderer.invoke('log', 'debug', msg),
    info:  (msg: string) => ipcRenderer.invoke('log', 'info',  msg),
    warn:  (msg: string) => ipcRenderer.invoke('log', 'warn',  msg),
    error: (msg: string) => ipcRenderer.invoke('log', 'error', msg),
  },
});
