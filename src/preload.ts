import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronIPC } from './electron-ipc';

// ElectronIPC 契約を満たす実装。型エラーで dropされた key があれば即検出。
const api: ElectronIPC = {
  savePng: (base64Data) => ipcRenderer.invoke('save-png', base64Data),
  copyImageToClipboard: (dataUrl) => ipcRenderer.invoke('copy-image', dataUrl),
  onMenuCopy: (callback) => {
    ipcRenderer.on('menu-copy', callback);
  },
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  zoomReset: () => ipcRenderer.invoke('zoom-reset'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  undo: () => ipcRenderer.invoke('undo'),
  redo: () => ipcRenderer.invoke('redo'),
  paste: () => ipcRenderer.invoke('paste'),

  // ── ドキュメント保存 / 読み込み ──
  saveMply: (json, currentPath) => ipcRenderer.invoke('save-mply', json, currentPath),
  openMply: () => ipcRenderer.invoke('open-mply'),
  confirmDiscard: (message) => ipcRenderer.invoke('confirm-discard', message),
  setDirty: (dirty) => ipcRenderer.invoke('set-dirty', dirty),
  onAppCloseRequest: (callback) => {
    ipcRenderer.on('app-close-request', () => callback());
  },
  respondAppClose: (decision) => ipcRenderer.invoke('app-close-response', decision),

  log: {
    debug: (msg) => ipcRenderer.invoke('log', 'debug', msg),
    info: (msg) => ipcRenderer.invoke('log', 'info', msg),
    warn: (msg) => ipcRenderer.invoke('log', 'warn', msg),
    error: (msg) => ipcRenderer.invoke('log', 'error', msg),
  },
};

contextBridge.exposeInMainWorld('electronIPC', api);
