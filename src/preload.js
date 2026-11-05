const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  meta: () => ipcRenderer.invoke("meta"),
  saveSettings: (p) => ipcRenderer.invoke("settings:save", p),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  pickImages: () => ipcRenderer.invoke("pick-images"),
  reveal: (p) => ipcRenderer.invoke("reveal", p),
  refine: (o) => ipcRenderer.invoke("refine", o),
  generate: (o) => ipcRenderer.invoke("generate", o),
  cancel: (id) => ipcRenderer.invoke("cancel", id),
  onProgress: (cb) => ipcRenderer.on("progress", (_e, d) => cb(d)),
});
