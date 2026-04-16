import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  savePng: (base64Data: string): Promise<SaveResult> =>
    ipcRenderer.invoke('save-png', base64Data),
  log: {
    debug: (msg: string) => ipcRenderer.invoke('log', 'debug', msg),
    info:  (msg: string) => ipcRenderer.invoke('log', 'info',  msg),
    warn:  (msg: string) => ipcRenderer.invoke('log', 'warn',  msg),
    error: (msg: string) => ipcRenderer.invoke('log', 'error', msg),
  },
});
