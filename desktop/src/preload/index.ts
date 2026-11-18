import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { FatupApi, UpdateProgress, UploadJob, VaultProgress, WebPreviewState } from '../shared-ipc';

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
  vaultStatus: () => ipcRenderer.invoke('vaultStatus'),
  vaultSetup: (pin) => ipcRenderer.invoke('vaultSetup', pin),
  vaultSetupPrepare: (pin) => ipcRenderer.invoke('vaultSetupPrepare', pin),
  vaultSetupCommit: () => ipcRenderer.invoke('vaultSetupCommit'),
  vaultUnlock: (pin, purpose) => ipcRenderer.invoke('vaultUnlock', pin, purpose),
  vaultRecover: (recoveryKey, newPin) => ipcRenderer.invoke('vaultRecover', recoveryKey, newPin),
  vaultChangePin: (oldPin, newPin) => ipcRenderer.invoke('vaultChangePin', oldPin, newPin),
  vaultLeave: () => ipcRenderer.invoke('vaultLeave'),
  listVault: (opts) => ipcRenderer.invoke('listVault', opts),
  vaultMoveIn: (ids) => ipcRenderer.invoke('vaultMoveIn', ids),
  vaultMoveOut: (ids) => ipcRenderer.invoke('vaultMoveOut', ids),
  onVaultProgress: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, p: VaultProgress) => cb(p);
    ipcRenderer.on('vaultProgress', handler);
    return () => ipcRenderer.removeListener('vaultProgress', handler);
  },
  updateFile: (id, patch) => ipcRenderer.invoke('updateFile', id, patch),
  getShare: (id) => ipcRenderer.invoke('getShare', id),
  setShare: (id, days) => ipcRenderer.invoke('setShare', id, days),
  stopShare: (id) => ipcRenderer.invoke('stopShare', id),
  addLink: (url, title, vault) => ipcRenderer.invoke('addLink', url, title, vault),
  previewLink: (id, force) => ipcRenderer.invoke('previewLink', id, force),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  previewUrl: (id) => ipcRenderer.invoke('previewUrl', id),
  fileBytes: (id) => ipcRenderer.invoke('fileBytes', id),
  webPreview: {
    show: (url, bounds) => ipcRenderer.invoke('webPreview:show', url, bounds),
    setBounds: (bounds) => ipcRenderer.send('webPreview:bounds', bounds),
    hide: () => ipcRenderer.send('webPreview:hide'),
    navigate: (action) => ipcRenderer.send('webPreview:navigate', action),
    onState: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, s: WebPreviewState) => cb(s);
      ipcRenderer.on('webPreview:state', handler);
      return () => ipcRenderer.removeListener('webPreview:state', handler);
    },
    onEscape: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('webPreview:escape', handler);
      return () => ipcRenderer.removeListener('webPreview:escape', handler);
    },
  },
  download: (id, reveal) => ipcRenderer.invoke('download', id, reveal),
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
