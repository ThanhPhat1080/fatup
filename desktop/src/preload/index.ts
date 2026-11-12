import { contextBridge, ipcRenderer } from 'electron';
import type { FatupApi } from '../shared-ipc';

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
  previewUrl: (id) => ipcRenderer.invoke('previewUrl', id),
  download: (id) => ipcRenderer.invoke('download', id),
  copyImage: (id) => ipcRenderer.invoke('copyImage', id),
  remove: (id) => ipcRenderer.invoke('remove', id),
  pairingQr: (pin) => ipcRenderer.invoke('pairingQr', pin),
};

contextBridge.exposeInMainWorld('fatup', api);
