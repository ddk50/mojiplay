import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  savePng: (base64Data: string): Promise<SaveResult> =>
    ipcRenderer.invoke('save-png', base64Data)
});
