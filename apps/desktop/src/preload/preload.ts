import { contextBridge, ipcRenderer } from "electron";

function listen(channel: string) {
  return (handler: (payload: unknown) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => handler(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  };
}

contextBridge.exposeInMainWorld("buddy", {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  onMessage: listen("buddy:message"),
  onRun: listen("buddy:run"),
  onApproval: listen("buddy:approval"),
});
