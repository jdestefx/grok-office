"use strict";

const list = document.querySelector("#worker-list");
const form = document.querySelector("#worker-form");
const nameInput = document.querySelector("#worker-name");
const roleInput = document.querySelector("#worker-role");
const formKicker = document.querySelector("#form-kicker");
const formTitle = document.querySelector("#form-title");
const formNote = document.querySelector("#form-note");
const deleteButton = document.querySelector("#delete-worker");
const saveButton = document.querySelector("#save-worker");
const chiefPanel = document.querySelector("#chief-panel");
const transcript = document.querySelector("#transcript");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
const chatStatus = document.querySelector("#chat-status");
const deskTabs = document.querySelector("#desk-tabs");
const tabLedger = document.querySelector("#tab-ledger");
const tabTalk = document.querySelector("#tab-talk");
const ledgerPanel = document.querySelector("#ledger-panel");
const briefBody = document.querySelector("#brief-body");
const briefHint = document.querySelector("#brief-hint");
const briefNote = document.querySelector("#brief-note");
const saveBriefButton = document.querySelector("#save-brief");
const catalog = document.querySelector("#catalog");
const catalogEmpty = document.querySelector("#catalog-empty");
const noteForm = document.querySelector("#note-form");
const notePathInput = document.querySelector("#note-path");
const noteWhenInput = document.querySelector("#note-when");
const noteBodyInput = document.querySelector("#note-body");
const deleteNoteButton = document.querySelector("#delete-note");
const noteStatus = document.querySelector("#note-status");

const state = {
  workers: [],
  chat: [],
  selectedId: "chief",
  creating: false,
  drafts: {},
  deleteArmed: false,
  sending: false,
  pendingText: "",
  tab: "talk",
  ledger: null,
  ledgerWorkerId: "chief",
  notePrevious: "",
  noteDeleteArmed: false,
  view: "worker",
  groups: [],
  selectedGroupId: null,
  creatingGroup: false,
  groupFormToken: "",
  groupDeleteArmed: false,
};

document.querySelector("#new-worker").addEventListener("click", () => {
  state.view = "worker";
  state.creating = true;
  state.selectedId = null;
  state.creatingGroup = false;
  state.deleteArmed = false;
  delete formNote.dataset.lock;
  if (!state.drafts.__new__) {
    state.drafts.__new__ = { name: "", role: "" };
  }
  render();
  nameInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveOpenWorker();
});

form.addEventListener("input", () => {
  const key = draftKey();
  state.drafts[key] = {
    name: nameInput.value,
    role: roleInput.value,
  };
  state.deleteArmed = false;
  paintNote();
});

deleteButton.addEventListener("click", async () => {
  const worker = selectedWorker();
  if (!worker || worker.isChief) return;
  if (!state.deleteArmed) {
    state.deleteArmed = true;
    paintNote("Delete " + worker.name + "? Click delete again.");
    return;
  }
  try {
    const office = await window.office.deleteWorker(worker.id);
    delete state.drafts[worker.id];
    applyOffice(office);
    state.selectedId = "chief";
    state.creating = false;
    state.deleteArmed = false;
    state.tab = "talk";
    state.ledger = null;
    clearNoteForm();
    render();
    await loadLedger();
  } catch (error) {
    paintNote(error.message, "error");
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || state.sending) return;
  state.sending = true;
  state.pendingText = text;
  chatInput.value = "";
  paintChatStatus("The chief is writing…");
  renderChat();
  const saved = await saveOpenWorker();
  if (!saved) {
    state.sending = false;
    state.pendingText = "";
    chatInput.value = text;
    render();
    return;
  }
  try {
    const result = await window.office.askChief(text);
    applyOffice(result.office);
    if (!result.ok && result.error) {
      paintChatStatus(result.error, "error");
    } else {
      paintChatStatus("The chief proposes. A worker is added only when you accept.", "ok");
    }
  } catch (error) {
    paintChatStatus(plainError(error), "error");
  } finally {
    state.pendingText = "";
    state.sending = false;
    render();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelector("#reset-chat").addEventListener("click", async () => {
  if (state.sending) return;
  const office = await window.office.resetChat();
  applyOffice(office);
  paintChatStatus("The chief proposes. A worker is added only when you accept.");
  render();
});

deskTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !button.dataset.tab) return;
  state.tab = button.dataset.tab;
  render();
});

document.querySelector("#new-note").addEventListener("click", () => {
  clearNoteForm();
  renderCatalog();
  notePathInput.focus();
});

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const worker = selectedWorker();
  if (!worker) return;
  try {
    const result = await window.office.saveNote({
      workerId: worker.id,
      path: notePathInput.value,
      when: noteWhenInput.value,
      body: noteBodyInput.value,
      previousPath: state.notePrevious,
    });
    state.ledger = result.ledger;
    state.notePrevious = result.note.path;
    notePathInput.value = result.note.path;
    state.noteDeleteArmed = false;
    deleteNoteButton.hidden = false;
    deleteNoteButton.textContent = "Delete note";
    renderCatalog();
    paintLedgerStatus("Saved to the catalog.", "ok");
  } catch (error) {
    paintLedgerStatus(error.message, "error");
  }
});

deleteNoteButton.addEventListener("click", async () => {
  const worker = selectedWorker();
  if (!worker || !state.notePrevious) return;
  if (!state.noteDeleteArmed) {
    state.noteDeleteArmed = true;
    deleteNoteButton.textContent = "Confirm delete";
    paintLedgerStatus("Delete " + state.notePrevious + "? Click delete again.");
    return;
  }
  try {
    state.ledger = await window.office.deleteNote(worker.id, state.notePrevious);
    clearNoteForm();
    renderCatalog();
    paintLedgerStatus("Note removed.", "ok");
  } catch (error) {
    paintLedgerStatus(error.message, "error");
  }
});

saveBriefButton.addEventListener("click", async () => {
  try {
    const result = await window.office.saveBrief(briefBody.value);
    briefBody.value = result.brief;
    if (state.ledger) state.ledger.brief = result.brief;
    briefNote.textContent = "Saved.";
    briefNote.className = "note ok";
  } catch (error) {
    briefNote.textContent = error.message;
    briefNote.className = "note error";
  }
});

document.querySelector("#new-group").addEventListener("click", () => {
  state.view = "group";
  state.creatingGroup = true;
  state.selectedGroupId = null;
  state.groupFormToken = "";
  state.groupDeleteArmed = false;
  render();
  document.querySelector("#group-name").focus();
});

document.querySelector("#group-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveOpenGroup();
});

document.querySelector("#delete-group").addEventListener("click", async () => {
  const group = selectedGroup();
  if (!group) return;
  if (group.table && group.table.status === "running") {
    paintGroupNote("Stop the table before deleting the group.", "error");
    return;
  }
  if (!state.groupDeleteArmed) {
    state.groupDeleteArmed = true;
    paintGroupNote("Delete " + group.name + "? Click delete again.");
    document.querySelector("#delete-group").textContent = "Confirm delete";
    return;
  }
  try {
    const office = await window.office.deleteGroup(group.id);
    applyOffice(office);
    state.view = "worker";
    state.creatingGroup = false;
    state.selectedGroupId = null;
    state.selectedId = "chief";
    render();
  } catch (error) {
    paintGroupNote(plainError(error), "error");
  }
});

document.querySelector("#group-prompt").addEventListener("submit", async (event) => {
  event.preventDefault();
  const group = selectedGroup();
  if (!group) return;
  const prompt = document.querySelector("#group-prompt-input").value.trim();
  try {
    applyOffice(await window.office.startGroup(group.id, prompt));
    paintGroupStatus(group.name + " is working. The table stays open until every member signs.", "");
    render();
  } catch (error) {
    paintGroupStatus(error.message, "error");
  }
});

document.querySelector("#group-stop").addEventListener("click", async () => {
  try {
    applyOffice(await window.office.stopGroup());
    render();
  } catch (error) {
    paintGroupStatus(error.message, "error");
  }
});

document.querySelector("#group-continue").addEventListener("click", async () => {
  const group = selectedGroup();
  if (!group) return;
  try {
    applyOffice(await window.office.continueGroup(group.id));
    render();
  } catch (error) {
    paintGroupStatus(error.message, "error");
  }
});

window.office.onGroupUpdate((office) => {
  applyOffice(office);
  render();
});

bindPaneSplit();
boot();

function bindPaneSplit() {
  const split = document.querySelector("#pane-split");
  const roster = document.querySelector(".roster");
  const min = 160;
  const max = 520;
  split.setAttribute("aria-valuemin", String(min));
  split.setAttribute("aria-valuemax", String(max));

  function setWidth(px) {
    const next = Math.min(max, Math.max(min, Math.round(px)));
    roster.style.width = next + "px";
    split.setAttribute("aria-valuenow", String(next));
    return next;
  }

  const saved = Number(localStorage.getItem("roster-width"));
  if (saved >= min && saved <= max) setWidth(saved);

  split.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    split.classList.add("dragging");
    document.body.classList.add("pane-dragging");
    split.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = roster.getBoundingClientRect().width;

    function move(moveEvent) {
      setWidth(startW + (moveEvent.clientX - startX));
    }

    function up() {
      split.classList.remove("dragging");
      document.body.classList.remove("pane-dragging");
      split.removeEventListener("pointermove", move);
      split.removeEventListener("pointerup", up);
      split.removeEventListener("pointercancel", up);
      localStorage.setItem("roster-width", String(Math.round(roster.getBoundingClientRect().width)));
    }

    split.addEventListener("pointermove", move);
    split.addEventListener("pointerup", up);
    split.addEventListener("pointercancel", up);
  });

  split.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 16 : -16;
    const next = setWidth(roster.getBoundingClientRect().width + delta);
    localStorage.setItem("roster-width", String(next));
  });
}

async function boot() {
  try {
    settings = await window.office.getSettings();
    paintModelLabel();
    applyOffice(await window.office.get());
    render();
    await loadLedger();
  } catch (error) {
    formNote.textContent = error.message;
    formNote.className = "note error";
  }
}

async function saveOpenWorker() {
  const name = nameInput.value;
  const role = roleInput.value;
  const worker = selectedWorker();
  try {
    const result = await window.office.saveWorker({
      id: state.creating ? undefined : worker && worker.id,
      name,
      role,
    });
    delete state.drafts[draftKey()];
    applyOffice(result.office);
    const wasCreating = state.creating;
    state.creating = false;
    state.selectedId = result.worker.id;
    state.deleteArmed = false;
    if (wasCreating) state.tab = result.worker.isChief ? "talk" : "ledger";
    render();
    await loadLedger();
    paintNote("Saved.", "ok");
    return true;
  } catch (error) {
    paintNote(error.message, "error");
    return false;
  }
}

function applyOffice(office) {
  state.workers = office.workers || [];
  state.groups = office.groups || [];
  state.chat = office.chat || [];
  if (!state.creating && state.selectedId && !state.workers.some((worker) => worker.id === state.selectedId)) {
    state.selectedId = "chief";
  }
  if (state.selectedGroupId && !state.groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = null;
    state.view = "worker";
  }
}

function selectedWorker() {
  return state.workers.find((worker) => worker.id === state.selectedId) || null;
}

function draftKey() {
  return state.creating ? "__new__" : state.selectedId || "__new__";
}

function render() {
  renderList();
  renderGroupList();
  const groupMode = state.view === "group";
  document.querySelector("#worker-desk").hidden = groupMode;
  document.querySelector("#group-desk").hidden = !groupMode;
  if (groupMode) {
    renderGroupDesk();
    return;
  }
  renderForm();
  renderChat();
  const worker = !state.creating && selectedWorker();
  const chiefOpen = Boolean(worker && worker.isChief);
  if (!chiefOpen && state.tab === "talk") state.tab = "ledger";
  document.body.classList.toggle("is-chief", chiefOpen);
  document.body.classList.toggle("has-worker", Boolean(worker));
  deskTabs.hidden = !worker;
  tabTalk.hidden = !chiefOpen;
  tabLedger.setAttribute("aria-pressed", state.tab === "ledger" ? "true" : "false");
  tabTalk.setAttribute("aria-pressed", state.tab === "talk" ? "true" : "false");
  chiefPanel.hidden = !worker || state.tab !== "talk";
  ledgerPanel.hidden = !worker || state.tab !== "ledger";
  saveButton.disabled = state.sending;
  chatSend.disabled = state.sending;
  renderCatalog();
  paintBriefAccess();
}

function renderList() {
  list.replaceChildren();
  for (const worker of displayRows()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "worker-row";
    button.setAttribute("aria-current", isCurrent(worker) ? "true" : "false");
    const name = document.createElement("span");
    name.className = "worker-name";
    name.textContent = worker.name || "New worker";
    button.append(name);
    if (worker.isChief) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Chief";
      button.append(badge);
    }
    const job = document.createElement("span");
    job.className = "worker-job";
    job.textContent = oneLine(worker.role) || "No role yet";
    button.append(job);
    button.addEventListener("click", () => selectWorker(worker));
    item.append(button);
    list.append(item);
  }
}

function displayRows() {
  const saved = state.workers.map((worker) => {
    const draft = state.drafts[worker.id];
    if (!draft) return worker;
    return Object.assign({}, worker, { name: draft.name, role: draft.role });
  });
  if (!state.creating) return saved;
  const draft = state.drafts.__new__ || { name: "", role: "" };
  return [{ id: "__new__", name: draft.name, role: draft.role, isChief: false, draft: true }].concat(saved);
}

function isCurrent(worker) {
  if (worker.draft) return state.creating;
  return !state.creating && worker.id === state.selectedId;
}

function selectWorker(worker) {
  state.view = "worker";
  state.creatingGroup = false;
  const previous = state.selectedId;
  if (worker.draft) {
    state.creating = true;
    state.selectedId = null;
  } else {
    state.creating = false;
    state.selectedId = worker.id;
  }
  state.deleteArmed = false;
  delete formNote.dataset.lock;
  const changed = !worker.draft && worker.id !== previous;
  if (changed) {
    state.tab = worker.isChief ? "talk" : "ledger";
    state.ledger = null;
    clearNoteForm();
  }
  render();
  if (!worker.draft && changed) loadLedger();
}

function renderForm() {
  const worker = state.creating ? null : selectedWorker();
  const draft = state.drafts[draftKey()];
  const source = draft || worker || { name: "", role: "" };
  if (document.activeElement !== nameInput) nameInput.value = source.name || "";
  if (document.activeElement !== roleInput) roleInput.value = source.role || "";
  if (state.creating) {
    formKicker.textContent = "New hire";
    formTitle.textContent = "New worker";
    deleteButton.hidden = true;
  } else if (worker && worker.isChief) {
    formKicker.textContent = "Already hired";
    formTitle.textContent = worker.name;
    deleteButton.hidden = true;
  } else if (worker) {
    formKicker.textContent = "Worker";
    formTitle.textContent = worker.name;
    deleteButton.hidden = false;
    deleteButton.textContent = state.deleteArmed ? "Confirm delete" : "Delete";
  }
  if (!formNote.dataset.lock) paintNote(hintFor(worker));
}

function hintFor(worker) {
  if (state.creating) return "Say what they are in charge of, and how they file their notes. Or ask the chief to draft it.";
  if (worker && worker.isChief) return "This role is the chief's standing orders, including that each worker files notes their own way.";
  return "Include the shelves this worker files on. Those shelves stay theirs.";
}

function paintNote(text, kind) {
  if (!text) {
    formNote.textContent = "";
    formNote.className = "note";
    delete formNote.dataset.lock;
    return;
  }
  formNote.textContent = text;
  formNote.className = "note" + (kind ? " " + kind : "");
  if (kind) formNote.dataset.lock = "1";
  else delete formNote.dataset.lock;
}

function renderChat() {
  transcript.replaceChildren();
  const showPending = Boolean(state.pendingText);
  if (!state.chat.length && !showPending && !state.sending) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Describe the work this office should cover. The chief will answer and, when you are hiring, draft a name and a role you can add.";
    transcript.append(hint);
    return;
  }
  for (const message of state.chat) {
    transcript.append(renderMessage(message));
  }
  if (showPending) {
    transcript.append(renderMessage({ role: "user", text: state.pendingText }));
  }
  if (state.sending) {
    const pending = document.createElement("article");
    pending.className = "bubble chief";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = "Chief";
    pending.append(who, document.createTextNode("Writing…"));
    transcript.append(pending);
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = "bubble " + (message.role === "user" ? "user" : "chief") + (message.error ? " error" : "");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = message.role === "user" ? "You" : "Chief";
  article.append(who, document.createTextNode(message.text || ""));
  if (message.proposals && message.proposals.length) {
    const stack = document.createElement("div");
    stack.className = "proposals";
    for (const proposal of message.proposals) {
      stack.append(renderProposal(message, proposal));
    }
    article.append(stack);
  }
  return article;
}

function renderProposal(message, proposal) {
  const card = document.createElement("div");
  card.className = "proposal";
  const title = document.createElement("h3");
  title.textContent = proposal.name;
  const role = document.createElement("p");
  role.textContent = proposal.role;
  const row = document.createElement("div");
  row.className = "row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = proposal.added ? "ghost" : "primary";
  button.textContent = proposal.added ? "Added" : "Add to office";
  button.disabled = proposal.added || state.sending;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await window.office.acceptProposal(message.id, proposal.id);
      applyOffice(result.office);
      state.creating = false;
      state.selectedId = result.worker.id;
      state.tab = "ledger";
      state.ledger = null;
      delete state.drafts[result.worker.id];
      clearNoteForm();
      render();
      await loadLedger();
      paintNote(result.worker.name + " is in the office. File their notes on the shelves in their role.", "ok");
    } catch (error) {
      button.disabled = false;
      paintChatStatus(error.message, "error");
    }
  });
  row.append(button);
  card.append(title, role, row);
  return card;
}

function paintChatStatus(text, kind) {
  chatStatus.textContent = text;
  chatStatus.className = "note" + (kind ? " " + kind : "");
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function loadLedger() {
  const worker = selectedWorker();
  if (!worker) return;
  const token = worker.id;
  state.ledgerWorkerId = token;
  try {
    const ledger = await window.office.getLedger(token);
    if (state.selectedId !== token) return;
    state.ledger = ledger;
    if (document.activeElement !== briefBody) briefBody.value = ledger.brief || "";
    renderCatalog();
    paintBriefAccess();
  } catch (error) {
    paintLedgerStatus(error.message, "error");
  }
}

function renderCatalog() {
  catalog.replaceChildren();
  const entries = state.ledger && state.selectedId === state.ledgerWorkerId ? state.ledger.entries : [];
  catalogEmpty.hidden = entries.length > 0;
  for (const entry of entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", entry.path === state.notePrevious ? "true" : "false");
    const notePath = document.createElement("span");
    notePath.className = "path";
    notePath.textContent = entry.path;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = entry.when;
    button.append(notePath, when);
    button.addEventListener("click", () => openNote(entry.path));
    item.append(button);
    catalog.append(item);
  }
}

function paintBriefAccess() {
  const worker = selectedWorker();
  const chief = Boolean(worker && worker.isChief);
  briefBody.readOnly = !chief;
  saveBriefButton.hidden = !chief;
  briefHint.textContent = chief
    ? "Facts the whole office reads. Each worker's own lore stays in their catalog."
    : "The chief keeps this. Your notes are the catalog beside it.";
}

async function openNote(notePath) {
  const worker = selectedWorker();
  if (!worker) return;
  try {
    const note = await window.office.readNote(worker.id, notePath);
    notePathInput.value = note.path;
    noteWhenInput.value = note.when;
    noteBodyInput.value = note.body;
    state.notePrevious = note.path;
    state.noteDeleteArmed = false;
    deleteNoteButton.hidden = false;
    deleteNoteButton.textContent = "Delete note";
    paintLedgerStatus("");
    renderCatalog();
  } catch (error) {
    paintLedgerStatus(error.message, "error");
  }
}

function clearNoteForm() {
  notePathInput.value = "";
  noteWhenInput.value = "";
  noteBodyInput.value = "";
  state.notePrevious = "";
  state.noteDeleteArmed = false;
  deleteNoteButton.hidden = true;
  deleteNoteButton.textContent = "Delete note";
  paintLedgerStatus("");
}

let settings = { provider: "grok", ollamaHost: "", ollamaModel: "gpt-oss:20b" };

document.querySelector("#open-options").addEventListener("click", () => {
  const provider = settings.provider === "ollama" ? "ollama" : "grok";
  document.querySelector('input[name="provider"][value="' + provider + '"]').checked = true;
  document.querySelector("#ollama-host").value = settings.ollamaHost || "";
  document.querySelector("#ollama-model").value = settings.ollamaModel || "gpt-oss:20b";
  syncProviderFields();
  paintOptionsNote("");
  document.querySelector("#options-modal").hidden = false;
});

document.querySelector("#close-options").addEventListener("click", closeOptions);
document.querySelector("#options-modal").addEventListener("click", (event) => {
  if (event.target.id === "options-modal") closeOptions();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOptions();
});
document.querySelector("#provider-choices").addEventListener("change", syncProviderFields);

document.querySelector("#save-options").addEventListener("click", async () => {
  try {
    settings = await window.office.saveSettings(readOptionsForm());
    paintModelLabel();
    paintOptionsNote("Saved.", "ok");
    closeOptions();
  } catch (error) {
    paintOptionsNote(error.message, "error");
  }
});

document.querySelector("#test-ollama").addEventListener("click", async () => {
  paintOptionsNote("Checking the server…");
  try {
    const result = await window.office.testOllama(readOptionsForm());
    if (result.found) {
      paintOptionsNote(result.model + " is available at " + result.origin + ".", "ok");
    } else {
      paintOptionsNote("Ollama is up at " + result.origin + ", but " + result.model + " is not on that server.", "error");
    }
  } catch (error) {
    paintOptionsNote(error.message, "error");
  }
});

function closeOptions() {
  document.querySelector("#options-modal").hidden = true;
}

function readOptionsForm() {
  const selected = document.querySelector('input[name="provider"]:checked');
  return {
    provider: selected ? selected.value : "grok",
    ollamaHost: document.querySelector("#ollama-host").value,
    ollamaModel: document.querySelector("#ollama-model").value,
  };
}

function syncProviderFields() {
  const ollama = readOptionsForm().provider === "ollama";
  document.querySelector("#ollama-fields").hidden = !ollama;
  document.querySelector("#test-ollama").hidden = !ollama;
}

function paintModelLabel() {
  const label = document.querySelector("#model-label");
  label.textContent = settings.provider === "ollama"
    ? "Ollama · " + (settings.ollamaModel || "gpt-oss:20b")
    : "Grok Build";
}

function paintOptionsNote(text, kind) {
  const note = document.querySelector("#options-note");
  note.textContent = text || "";
  note.className = "note" + (kind ? " " + kind : "");
}

function paintLedgerStatus(text, kind) {
  noteStatus.textContent = text || "";
  noteStatus.className = "note" + (kind ? " " + kind : "");
}

function selectedGroup() {
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

function renderGroupList() {
  const list = document.querySelector("#group-list");
  list.replaceChildren();
  const rows = state.groups.slice();
  if (state.creatingGroup) {
    rows.unshift({ id: "__new__", name: "New group", memberIds: [], draft: true });
  }
  for (const group of rows) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-row";
    const current = group.draft ? state.creatingGroup : state.view === "group" && group.id === state.selectedGroupId;
    button.setAttribute("aria-current", current ? "true" : "false");
    const name = document.createElement("span");
    name.className = "worker-name";
    name.textContent = group.name;
    button.append(name);
    if (!group.draft && group.subject) {
      const focus = document.createElement("span");
      focus.className = "group-focus";
      focus.textContent = oneLine(group.subject);
      button.append(focus);
    }
    const faces = document.createElement("span");
    faces.className = "faces";
    faces.textContent = group.draft
      ? "Pick who sits at this table"
      : group.memberIds.map((id) => {
          const worker = state.workers.find((item) => item.id === id);
          return worker ? worker.name : "Missing";
        }).join(" · ");
    button.append(faces);
    button.addEventListener("click", () => selectGroup(group));
    item.append(button);
    list.append(item);
  }
}

function selectGroup(group) {
  const nextCreating = Boolean(group.draft);
  const nextId = group.draft ? null : group.id;
  if (nextCreating !== state.creatingGroup || nextId !== state.selectedGroupId) {
    state.groupFormToken = "";
  }
  state.view = "group";
  state.creatingGroup = nextCreating;
  state.selectedGroupId = nextId;
  state.groupDeleteArmed = false;
  render();
}

function renderGroupDesk() {
  document.body.classList.remove("is-chief", "has-worker");
  syncGroupForm();
  const group = selectedGroup();
  const visual = document.querySelector("#group-visual");
  visual.hidden = !group;
  const running = Boolean(group && group.table && group.table.status === "running");
  document.querySelector("#save-group").disabled = running;
  document.querySelector("#group-name").readOnly = running;
  document.querySelector("#group-subject").readOnly = running;
  document.querySelectorAll("#member-picks input").forEach((box) => {
    box.disabled = running;
  });
  document.querySelector("#group-send").hidden = running || !group;
  document.querySelector("#group-stop").hidden = !running;
  const canContinue = Boolean(group && group.table && (group.table.status === "stopped" || group.table.status === "error"));
  document.querySelector("#group-continue").hidden = !canContinue;
  document.querySelector("#group-prompt-input").readOnly = running;
  document.querySelector("#delete-group").hidden = !group;
  document.querySelector("#delete-group").textContent = state.groupDeleteArmed ? "Confirm delete" : "Delete";
  if (group && (!group.table || group.table.status !== "error")) {
    delete document.querySelector("#group-status").dataset.lock;
  }
  if (!group) return;
  paintMembers(group, running);
  paintDraft(group);
  paintRemarks(group);
  if (!groupStatusLocked()) paintGroupStatus(statusLine(group), group.table && group.table.status === "error" ? "error" : group.table && group.table.status === "signed" ? "ok" : "");
}

function syncGroupForm() {
  const token = state.creatingGroup ? "new" : state.selectedGroupId || "";
  if (state.groupFormToken === token) return;
  state.groupFormToken = token;
  const group = selectedGroup();
  document.querySelector("#group-name").value = group ? group.name : "";
  document.querySelector("#group-subject").value = group && group.subject ? group.subject : "";
  document.querySelector("#group-title").textContent = group ? group.name : "New group";
  const picks = document.querySelector("#member-picks");
  picks.querySelectorAll("label").forEach((label) => label.remove());
  const chosen = new Set(group ? group.memberIds : []);
  for (const worker of state.workers) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = worker.id;
    box.checked = chosen.has(worker.id);
    const text = document.createElement("span");
    const title = document.createElement("span");
    title.textContent = worker.name + (worker.isChief ? " (chief)" : "");
    const aspect = document.createElement("small");
    aspect.textContent = oneLine(worker.role);
    text.append(title, aspect);
    label.append(box, text);
    picks.append(label);
  }
  const prompt = document.querySelector("#group-prompt-input");
  if (document.activeElement !== prompt) prompt.value = group && group.table ? group.table.prompt : "";
}

function paintMembers(group, running) {
  const cards = document.querySelector("#member-cards");
  cards.replaceChildren();
  for (const id of group.memberIds) {
    const worker = state.workers.find((item) => item.id === id);
    const card = document.createElement("article");
    const approved = Boolean(group.table && group.table.approvals[id]);
    const speaking = Boolean(running && group.table && group.table.turnWorkerId === id);
    card.className = "member-card" + (speaking ? " speaking" : "") + (approved ? " approved" : "");
    const name = document.createElement("div");
    name.className = "who-name";
    name.textContent = worker ? worker.name : "Missing";
    const aspect = document.createElement("p");
    aspect.className = "aspect";
    aspect.textContent = worker ? oneLine(worker.role) : "";
    const sign = document.createElement("div");
    sign.className = "sign-state";
    sign.textContent = speaking
      ? "Writing"
      : (approved ? "[X] Approved By " + (worker ? worker.name : "") : "[ ] Not signed");
    card.append(name, aspect, sign);
    cards.append(card);
  }
}

function paintDraft(group) {
  const block = document.querySelector("#signature-block");
  const body = document.querySelector("#draft-body");
  const empty = document.querySelector("#draft-empty");
  block.replaceChildren();
  const table = group.table;
  if (!table) {
    empty.hidden = false;
    body.textContent = "";
    return;
  }
  empty.hidden = true;
  for (const id of group.memberIds) {
    const worker = state.workers.find((item) => item.id === id);
    const line = document.createElement("p");
    const approved = Boolean(table.approvals[id]);
    line.className = "signature-line " + (approved ? "on" : "off");
    line.textContent = (approved ? "[X]" : "[ ]") + " Approved By " + (worker ? worker.name : "Missing");
    block.append(line);
  }
  body.textContent = table.body || "";
}

function paintRemarks(group) {
  const list = document.querySelector("#remark-list");
  list.replaceChildren();
  const remarks = group.table ? group.table.remarks.slice(-6) : [];
  for (const remark of remarks) {
    const row = document.createElement("p");
    row.className = "remark";
    const name = document.createElement("strong");
    name.textContent = remark.name + (remark.approve ? " signed. " : ". ");
    row.append(name, document.createTextNode(remark.text || ""));
    list.append(row);
  }
}

function statusLine(group) {
  const table = group.table;
  if (!table) return "The table stays open until every member has signed the same draft. There is no round limit.";
  const signed = group.memberIds.filter((id) => table.approvals[id]).length;
  if (table.status === "running") {
    const speaker = state.workers.find((worker) => worker.id === table.turnWorkerId);
    return (speaker ? speaker.name + " is writing. " : "The group is working. ") + signed + " of " + group.memberIds.length + " have signed.";
  }
  if (table.status === "signed") return "Everyone signed this draft.";
  if (table.status === "error") return table.error || "The group stopped on an error.";
  return "Stopped. " + signed + " of " + group.memberIds.length + " have signed. Continue, or send a new prompt.";
}

function groupStatusLocked() {
  return document.querySelector("#group-status").dataset.lock === "1";
}

function paintGroupStatus(text, kind) {
  const note = document.querySelector("#group-status");
  note.textContent = text || "";
  note.className = "note" + (kind ? " " + kind : "");
  if (kind === "error") note.dataset.lock = "1";
  else delete note.dataset.lock;
}

function plainError(error) {
  return String(error && error.message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function paintGroupNote(text, kind) {
  const note = document.querySelector("#group-note");
  note.textContent = text || "";
  note.className = "note" + (kind ? " " + kind : "");
}

async function saveOpenGroup() {
  const memberIds = Array.from(document.querySelectorAll("#member-picks input:checked")).map((box) => box.value);
  const group = selectedGroup();
  try {
    const result = await window.office.saveGroup({
      id: state.creatingGroup ? undefined : group && group.id,
      name: document.querySelector("#group-name").value,
      subject: document.querySelector("#group-subject").value,
      memberIds,
    });
    applyOffice(result.office);
    state.creatingGroup = false;
    state.selectedGroupId = result.group.id;
    state.groupFormToken = "";
    state.groupDeleteArmed = false;
    render();
    paintGroupNote("Saved.", "ok");
  } catch (error) {
    paintGroupNote(plainError(error), "error");
  }
}
