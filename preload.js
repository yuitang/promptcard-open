// PromptCard Open - Electron 预加载脚本
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptCardAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
