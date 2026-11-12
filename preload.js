/**
 * Jalaram Enterprise - Quotation Manager
 * Electron Preload Script (Secure Context Bridge)
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // App & Environment Information
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),

  // Database Management (app.getPath('userData')/local_database.json)
  readDatabase: () => ipcRenderer.invoke('db:read'),
  writeDatabase: (dataObj) => ipcRenderer.invoke('db:write', dataObj),
  exportDatabase: (dataObj) => ipcRenderer.invoke('db:export', dataObj),
  importDatabase: () => ipcRenderer.invoke('db:import'),

  // Software Update (Manual In-App Asset Updater)
  selectUpdateFile: () => ipcRenderer.invoke('update:select-file'),
  applyUpdate: (payload) => ipcRenderer.invoke('update:apply', payload),
  rollbackUpdate: () => ipcRenderer.invoke('update:rollback'),
  restartApp: () => ipcRenderer.invoke('app:restart'),

  // External Links & System Tools
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Menu Event Listeners
  onExportBackup: (callback) => {
    ipcRenderer.on('menu:export-backup', () => callback());
  },
  onImportBackup: (callback) => {
    ipcRenderer.on('menu:import-backup', () => callback());
  }
});
