import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { FatupApi, UpdateProgress, UploadJob } from '../shared-ipc';

const api: FatupApi = {
  getState: () => ipcRenderer.invoke('state'),
  testConnection: (url, token) => ipcRenderer.invoke('testConnection', url, token),
  saveConnection: (url, token) => ipcRenderer.invoke('saveConnection', url, token),
  setPin: (pin) => ipcRenderer.invoke('setPin', pin),
  unlock: (pin) => ipcRenderer.invoke('unlock', pin),
  lock: () => ipcRenderer.invoke('lock'),
  reset: () => ipcRenderer.invoke('reset'),
  changePin: (oldPin, newPin) => ipcRenderer.invoke('changePin', oldPin, newPin),
  setPrefs: (prefs) => ipcRenderer.invoke('setPrefs', prefs),
  list: () => ipcRenderer.invoke('list'),
  listTrash: () => ipcRenderer.invoke('listTrash'),
  usage: () => ipcRenderer.invoke('usage'),
  vaultOpen: (pin) => ipcRenderer.invoke('vaultOpen', pin),
  vaultClose: () => ipcRenderer.invoke('vaultClose'),
  listVault: () => ipcRenderer.invoke('listVault'),
  setVault: (id, inVault) => ipcRenderer.invoke('setVault', id, inVault),
  rename: (id, name) => ipcRenderer.invoke('rename', id, name),
  previewUrl: (id) => ipcRenderer.invoke('previewUrl', id),
  download: (id) => ipcRenderer.invoke('download', id),
  copyImage: (id) => ipcRenderer.invoke('copyImage', id),
  remove: (id) => ipcRenderer.invoke('remove', id),
  restore: (id) => ipcRenderer.invoke('restore', id),
  removeForever: (id) => ipcRenderer.invoke('removeForever', id),
  emptyTrash: () => ipcRenderer.invoke('emptyTrash'),
  pairingQr: (pin) => ipcRenderer.invoke('pairingQr', pin),
  uploadPick: (vault) => ipcRenderer.invoke('uploadPick', vault),
  uploadPaths: (paths, vault) => ipcRenderer.invoke('uploadPaths', paths, vault),
  uploadCancel: (id) => ipcRenderer.invoke('uploadCancel', id),
  uploadClear: () => ipcRenderer.invoke('uploadClear'),
  uploadList: () => ipcRenderer.invoke('uploadList'),
  onUploads: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, jobs: UploadJob[]) => cb(jobs);
    ipcRenderer.on('uploads', handler);
    return () => ipcRenderer.removeListener('uploads', handler);
  },
  pathsForFiles: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  appVersion: () => ipcRenderer.invoke('appVersion'),
  checkForUpdate: () => ipcRenderer.invoke('checkForUpdate'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),
  onUpdateProgress: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, p: UpdateProgress) => cb(p);
    ipcRenderer.on('updateProgress', handler);
    return () => ipcRenderer.removeListener('updateProgress', handler);
  },
};

contextBridge.exposeInMainWorld('fatup', api);
