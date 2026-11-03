/**
 * Preload: única ponte entre renderer e processo principal.
 * `sandbox: true` + `contextIsolation: true` → aqui só existe `electron`.
 * Expomos um objeto pequeno e tipado; nada de `ipcRenderer` cru, nada de `fs`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PrismaBridge } from '../src/shared/ipc-contract';

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const bridge: PrismaBridge = {
  runtime: 'electron',
  loadData: () => invoke(IPC.loadData),
  saveData: (data) => invoke(IPC.saveData, data),
  saveRecording: (payload) => invoke(IPC.saveRecording, payload),
  loadRecording: (id) => invoke(IPC.loadRecording, id),
  deleteRecording: (id) => invoke(IPC.deleteRecording, id),
  exportRecordingWav: (id) => invoke(IPC.exportRecordingWav, id),
  exportReport: (payload) => invoke(IPC.exportReport, payload),
  exportBackup: (data) => invoke(IPC.exportBackup, data),
  importBackup: () => invoke(IPC.importBackup),
  clearAllData: () => invoke(IPC.clearAllData),
  systemInfo: () => invoke(IPC.systemInfo),
  setReminders: (settings) => invoke(IPC.setReminders, settings),
  openExternal: (url) => invoke(IPC.openExternal, url),
  logError: (payload) => invoke(IPC.logError, payload),
  onReminder: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.onReminder, handler);
    return () => ipcRenderer.removeListener(IPC.onReminder, handler);
  },
  onFlushRequest: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.flushRequest, handler);
    return () => ipcRenderer.removeListener(IPC.flushRequest, handler);
  },
  flushDone: () => {
    ipcRenderer.send(IPC.flushDone);
  },
};

contextBridge.exposeInMainWorld('prisma', bridge);
