import type { FatupApi } from '../shared-ipc';

declare global {
  interface Window {
    fatup: FatupApi;
  }
}

export {};
