"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("office", {
  get: () => ipcRenderer.invoke("office:get"),
  saveWorker: (worker) => ipcRenderer.invoke("worker:save", worker),
  deleteWorker: (id) => ipcRenderer.invoke("worker:delete", id),
  askChief: (text) => ipcRenderer.invoke("chief:send", text),
  acceptProposal: (messageId, proposalId) =>
    ipcRenderer.invoke("proposal:accept", { messageId, proposalId }),
  resetChat: () => ipcRenderer.invoke("chief:reset"),
  getLedger: (workerId) => ipcRenderer.invoke("ledger:get", workerId),
  readNote: (workerId, notePath) => ipcRenderer.invoke("ledger:read", { workerId, path: notePath }),
  saveNote: (input) => ipcRenderer.invoke("ledger:save", input),
  deleteNote: (workerId, notePath) => ipcRenderer.invoke("ledger:delete", { workerId, path: notePath }),
  saveBrief: (text) => ipcRenderer.invoke("brief:save", text),
  saveGroup: (group) => ipcRenderer.invoke("group:save", group),
  deleteGroup: (id) => ipcRenderer.invoke("group:delete", id),
  startGroup: (groupId, prompt) => ipcRenderer.invoke("group:start", { groupId, prompt }),
  continueGroup: (groupId) => ipcRenderer.invoke("group:continue", groupId),
  stopGroup: () => ipcRenderer.invoke("group:stop"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  testOllama: (settings) => ipcRenderer.invoke("settings:test", settings),
  onGroupUpdate: (callback) => {
    const handler = (_event, office) => callback(office);
    ipcRenderer.on("group:update", handler);
    return () => ipcRenderer.removeListener("group:update", handler);
  },
});
