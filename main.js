"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { createStore, newId, MESSAGE_MAX, DEFAULT_CHIEF_ROLE, PREVIOUS_CHIEF_ROLE } = require("./office-store");
const { askChief, buildPrompt, buildSystemPrompt } = require("./chief-runner");
const { askMember, buildMemberPrompt, proposedContent } = require("./group-runner");
const { createLedger } = require("./ledger");
const { createSettings } = require("./settings-store");
const { testOllama } = require("./model-client");

const dataDir = path.join(__dirname, "data");
const store = createStore(dataDir);
const ledger = createLedger(dataDir);
const settingsStore = createSettings(dataDir);
let mainWindow = null;
let chiefChild = null;
let groupRun = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: "#171512",
    title: "Grok Office",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  store.load();
  migrateChiefRole();
  for (const worker of store.publicView().workers) {
    ledger.ensureWorker(worker.id);
  }
  ledger.ensureBrief();
  createWindow();
});

app.on("window-all-closed", () => {
  if (chiefChild) chiefChild.kill();
  if (groupRun && groupRun.child) groupRun.child.kill();
  app.quit();
});

ipcMain.handle("office:get", () => store.publicView());

ipcMain.handle("settings:get", () => settingsStore.load());

ipcMain.handle("settings:save", (_event, input) => settingsStore.save(input || {}));

ipcMain.handle("settings:test", (_event, input) => {
  const draft = Object.assign({}, settingsStore.load(), input || {}, { provider: "ollama" });
  return testOllama(draft);
});

ipcMain.handle("worker:save", (_event, input) => {
  const worker = store.saveWorker(input || {});
  ledger.ensureWorker(worker.id);
  return { worker, office: store.publicView() };
});

ipcMain.handle("worker:delete", (_event, id) => {
  const view = store.deleteWorker(String(id || ""));
  ledger.removeWorker(String(id || ""));
  return view;
});

ipcMain.handle("proposal:accept", (_event, input) => {
  const messageId = input && input.messageId;
  const proposalId = input && input.proposalId;
  const result = store.acceptProposal(String(messageId || ""), String(proposalId || ""));
  ledger.ensureWorker(result.worker.id);
  return result;
});

ipcMain.handle("ledger:get", (_event, workerId) => ledger.read(String(workerId || "")));

ipcMain.handle("ledger:read", (_event, input) => {
  return ledger.readNote(input && input.workerId, input && input.path);
});

ipcMain.handle("ledger:save", (_event, input) => {
  const saved = ledger.saveNote(input && input.workerId, input || {});
  return { note: saved, ledger: ledger.read(input.workerId) };
});

ipcMain.handle("ledger:delete", (_event, input) => {
  ledger.deleteNote(input && input.workerId, input && input.path);
  return ledger.read(input.workerId);
});

ipcMain.handle("brief:save", (_event, text) => {
  return { brief: ledger.saveBrief(text) };
});

ipcMain.handle("group:save", (_event, input) => {
  const group = store.saveGroup(input || {});
  return { group, office: store.publicView() };
});

ipcMain.handle("group:delete", (_event, id) => store.deleteGroup(String(id || "")));

ipcMain.handle("group:start", (_event, input) => {
  const groupId = String(input && input.groupId || "");
  const group = store.beginTable(groupId, input && input.prompt);
  startTable(group.id);
  return store.publicView();
});

ipcMain.handle("group:continue", (_event, groupId) => {
  const group = store.continueTable(String(groupId || ""));
  startTable(group.id);
  return store.publicView();
});

ipcMain.handle("group:stop", () => {
  if (groupRun) {
    groupRun.stop = true;
    if (groupRun.child) groupRun.child.kill();
  }
  return store.publicView();
});

ipcMain.handle("chief:reset", () => {
  if (chiefChild) chiefChild.kill();
  return store.resetChat();
});

ipcMain.handle("chief:send", async (_event, text) => {
  const message = String(text || "").trim();
  if (!message) {
    throw new Error("Write a message to the chief first.");
  }
  if (message.length > MESSAGE_MAX) {
    throw new Error("That message is too long for one turn.");
  }
  if (chiefChild) {
    throw new Error("The chief is still answering the last message.");
  }

  store.appendChat({
    id: newId("m"),
    role: "user",
    text: message,
    at: new Date().toISOString(),
  });

  try {
    const result = await runChief(message, store.sessionId());
    if (result.sessionId) store.setSessionId(result.sessionId);
    const proposals = result.workers.map((worker) => ({
      id: newId("p"),
      name: worker.name.replace(/\s+/g, " ").trim().slice(0, 48),
      role: worker.role.trim().slice(0, 4000),
      added: false,
    })).filter((worker) => worker.name && worker.role);

    const reply = result.reply || (proposals.length
      ? "I drafted " + (proposals.length === 1 ? "a worker" : "these workers") + " from what you described."
      : "I have nothing to add.");

    store.appendChat({
      id: newId("m"),
      role: "chief",
      text: reply,
      proposals,
      at: new Date().toISOString(),
    });
    return { ok: true, office: store.publicView() };
  } catch (error) {
    const lostSession = /session|resume|no conversation/i.test(error.message || "");
    if (lostSession && store.sessionId()) {
      store.setSessionId(null);
      try {
        const result = await runChief(message, null);
        if (result.sessionId) store.setSessionId(result.sessionId);
        const proposals = result.workers.map((worker) => ({
          id: newId("p"),
          name: worker.name.replace(/\s+/g, " ").trim().slice(0, 48),
          role: worker.role.trim().slice(0, 4000),
          added: false,
        })).filter((worker) => worker.name && worker.role);
        store.appendChat({
          id: newId("m"),
          role: "chief",
          text: result.reply || "I drafted a worker from what you described.",
          proposals,
          at: new Date().toISOString(),
        });
        return { ok: true, office: store.publicView() };
      } catch (retryError) {
        return recordChiefFailure(retryError);
      }
    }
    return recordChiefFailure(error);
  }
});

function recordChiefFailure(error) {
  store.appendChat({
    id: newId("m"),
    role: "chief",
    text: error && error.message ? error.message : "The chief could not answer.",
    proposals: [],
    error: true,
    at: new Date().toISOString(),
  });
  return { ok: false, error: error.message, office: store.publicView() };
}

function migrateChiefRole() {
  const chief = store.publicView().workers.find((worker) => worker.isChief);
  if (!chief || chief.role !== PREVIOUS_CHIEF_ROLE) return;
  store.saveWorker({ id: chief.id, name: chief.name, role: DEFAULT_CHIEF_ROLE });
}

function broadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("group:update", store.publicView());
}

function startTable(groupId) {
  if (groupRun) return;
  groupRun = { groupId, stop: false, child: null };
  runTable(groupId)
    .catch((error) => {
      const stopped = groupRun && groupRun.stop;
      store.finishTable(groupId, stopped ? "stopped" : "error", stopped ? "" : (error && error.message) || "The group stopped.");
      broadcast();
    })
    .finally(() => {
      if (groupRun && groupRun.groupId === groupId) groupRun = null;
    });
}

async function runTable(groupId) {
  while (groupRun && groupRun.groupId === groupId && !groupRun.stop) {
    const group = store.groupById(groupId);
    if (!group || !group.table || group.table.status === "signed") return;
    const members = group.memberIds
      .map((id) => store.workerById(id))
      .filter(Boolean);
    if (members.length < 2) {
      store.finishTable(groupId, "error", "A group needs at least two workers.");
      broadcast();
      return;
    }
    if (group.table.body.trim() && members.every((member) => group.table.approvals[member.id])) {
      store.finishTable(groupId, "signed", "");
      broadcast();
      return;
    }
    const worker = members[group.table.cursor % members.length];
    store.markTurn(groupId, worker.id);
    broadcast();
    const notes = ledger.read(worker.id);
    const latest = store.groupById(groupId);
    const result = await askMember({
      cwd: __dirname,
      workerName: worker.name,
      prompt: buildMemberPrompt({
        worker,
        members,
        groupName: latest.name,
        catalog: notes.entries,
        brief: notes.brief,
        prompt: latest.table.prompt,
        proposed: proposedContent(members, latest.table.approvals, latest.table.body),
        recent: latest.table.remarks.slice(-3),
      }),
      settings: settingsStore.load(),
      onStop(handle) {
        if (groupRun && groupRun.groupId === groupId) groupRun.child = handle;
      },
    });
    if (!groupRun || groupRun.groupId !== groupId || groupRun.stop) break;
    const applied = store.applyMemberTurn(groupId, worker.id, result);
    broadcast();
    if (applied.table && applied.table.status === "signed") return;
  }
  if (store.groupById(groupId)) {
    store.finishTable(groupId, "stopped", "");
    broadcast();
  }
}

function chiefHistory() {
  const chat = store.publicView().chat.slice(0, -1).slice(-20);
  return chat
    .filter((message) => message && message.text && !message.error)
    .map((message) => ({
      role: message.role === "chief" ? "assistant" : "user",
      content: message.text,
    }));
}

function runChief(message, sessionId) {
  const settings = settingsStore.load();
  return askChief({
    cwd: __dirname,
    settings,
    prompt: buildPrompt(store.rosterBrief(), message),
    systemPrompt: buildSystemPrompt(store.chiefRole()),
    sessionId: settings.provider === "grok" ? sessionId || "" : "",
    history: settings.provider === "ollama" ? chiefHistory() : [],
    onStop(handle) {
      chiefChild = handle;
    },
  });
}
