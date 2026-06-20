import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // ─── 站点管理 ────────────────────────────────────
  getSites: () => ipcRenderer.invoke('sites:get'),
  getSelectedSites: () => ipcRenderer.invoke('sites:getSelected'),
  setSelectedSites: (ids: string[]) => ipcRenderer.invoke('sites:setSelected', ids),
  addSite: (data: { name: string; url: string; script: string }) =>
    ipcRenderer.invoke('sites:add', data),
  updateSite: (
    id: string,
    updates: { name?: string; url?: string; enabled?: boolean },
    script?: string
  ) => ipcRenderer.invoke('sites:update', id, updates, script),
  deleteSite: (id: string) => ipcRenderer.invoke('sites:delete', id),
  getScript: (name: string) => ipcRenderer.invoke('sites:getScript', name),
  getTemplate: () => ipcRenderer.invoke('sites:getTemplate'),

  // ─── 运行 ────────────────────────────────────────
  run: (payload: { sites: string[]; prompt: string; attachments: string[]; statusMsgId: string }) =>
    ipcRenderer.invoke('run', payload),
  onRunEvent: (callback: (event: any) => void) => {
    const handler = (_e: any, data: any) => callback(data);
    ipcRenderer.on('run:event', handler);
    return () => { ipcRenderer.removeListener('run:event', handler); };
  },

  // ─── 文件 ────────────────────────────────────────
  selectFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  readTsFile: () => ipcRenderer.invoke('dialog:readTsFile'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
