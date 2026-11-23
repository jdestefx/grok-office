"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NAME_MAX = 48;
const ROLE_MAX = 4000;
const SUBJECT_MAX = 2000;
const MESSAGE_MAX = 8000;

const PREVIOUS_CHIEF_ROLE = [
  "You are the chief of staff.",
  "You are in charge of this office: which workers exist, and which one job each of them owns.",
  "You do not do their work yourself.",
  "When the user wants another worker, give that worker a short name and a role that says what they are in charge of.",
  "One worker, one job.",
].join(" ");

const DEFAULT_CHIEF_ROLE = [
  "You are the chief of staff.",
  "You are in charge of this office: which workers exist, and which one job each of them owns.",
  "You do not do their work yourself.",
  "When the user wants another worker, give that worker a short name and a role that says what they are in charge of, and how that worker files their notes.",
  "One worker, one job.",
  "You keep the project brief, the facts the whole office shares.",
  "Each worker keeps their own ledger and files it the way their role describes.",
  "You do not refile their notes.",
].join(" ");

function defaultChief() {
  return {
    id: "chief",
    name: "Chief",
    role: DEFAULT_CHIEF_ROLE,
    isChief: true,
    createdAt: new Date().toISOString(),
  };
}

function createStore(dataDir) {
  const filePath = path.join(dataDir, "office.json");
  let office = null;

  function blank() {
    return {
      workers: [defaultChief()],
      groups: [],
      chat: [],
      chiefSessionId: null,
    };
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(office, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  function ensureShape(raw) {
    const next = {
      workers: Array.isArray(raw && raw.workers) ? raw.workers : [],
      groups: [],
      chat: Array.isArray(raw && raw.chat) ? raw.chat : [],
      chiefSessionId:
        raw && typeof raw.chiefSessionId === "string" ? raw.chiefSessionId : null,
    };
    if (!next.workers.some((worker) => worker && worker.isChief)) {
      next.workers.unshift(defaultChief());
    }
    next.workers = next.workers.map(normalizeWorker).filter(Boolean);
    const chiefIndex = next.workers.findIndex((worker) => worker.isChief);
    if (chiefIndex > 0) {
      const [chief] = next.workers.splice(chiefIndex, 1);
      next.workers.unshift(chief);
    }
    const seenGroups = new Set();
    next.groups = (Array.isArray(raw && raw.groups) ? raw.groups : [])
      .map((group) => normalizeGroup(group, next.workers))
      .filter((group) => {
        if (!group || seenGroups.has(group.name.toLowerCase())) return false;
        seenGroups.add(group.name.toLowerCase());
        return true;
      });
    return next;
  }

  function load() {
    if (office) return office;
    try {
      office = ensureShape(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") {
        try {
          fs.renameSync(filePath, filePath + ".bad");
        } catch (_renameError) {
          /* keep going with a fresh office */
        }
      }
      office = blank();
      persist();
    }
    return office;
  }

  function publicView() {
    const current = load();
    return {
      workers: current.workers.map(clone),
      groups: current.groups.map(clone),
      chat: current.chat.map(clone),
    };
  }

  function saveWorker(input) {
    const current = load();
    const name = cleanName(input && input.name);
    const role = cleanRole(input && input.role);
    if (!name) {
      throw new Error("Give the worker a name.");
    }
    if (!role) {
      throw new Error("Write what this worker is in charge of.");
    }
    const id = input && input.id ? String(input.id) : "";
    const duplicate = current.workers.find(
      (worker) => worker.name.toLowerCase() === name.toLowerCase() && worker.id !== id
    );
    if (duplicate) {
      throw new Error("A worker already has that name.");
    }
    if (id) {
      const worker = current.workers.find((item) => item.id === id);
      if (!worker) {
        throw new Error("That worker is no longer in the office.");
      }
      worker.name = name;
      worker.role = role;
      worker.updatedAt = new Date().toISOString();
      persist();
      return clone(worker);
    }
    const worker = {
      id: "w_" + crypto.randomBytes(6).toString("hex"),
      name,
      role,
      isChief: false,
      createdAt: new Date().toISOString(),
    };
    current.workers.push(worker);
    persist();
    return clone(worker);
  }

  function deleteWorker(id) {
    const current = load();
    const worker = current.workers.find((item) => item.id === id);
    if (!worker) {
      throw new Error("That worker is no longer in the office.");
    }
    if (worker.isChief) {
      throw new Error("The chief stays. Edit the role instead of removing them.");
    }
    current.workers = current.workers.filter((item) => item.id !== id);
    for (const group of current.groups) {
      group.memberIds = group.memberIds.filter((memberId) => memberId !== id);
      if (group.table && group.table.approvals) delete group.table.approvals[id];
    }
    persist();
    return publicView();
  }

  function saveGroup(input) {
    const current = load();
    const name = cleanName(input && input.name);
    if (!name) throw new Error("Name the group.");
    const requested = Array.isArray(input && input.memberIds) ? input.memberIds.map(String) : [];
    const memberIds = [];
    for (const memberId of requested) {
      if (!current.workers.some((worker) => worker.id === memberId)) continue;
      if (!memberIds.includes(memberId)) memberIds.push(memberId);
    }
    if (memberIds.length < 2) throw new Error("A group needs at least two workers.");
    const subject = cleanSubject(input && input.subject);
    const id = input && input.id ? String(input.id) : "";
    const duplicate = current.groups.find(
      (group) => group.name.toLowerCase() === name.toLowerCase() && group.id !== id
    );
    if (duplicate) throw new Error("A group already has that name.");
    if (id) {
      const group = current.groups.find((item) => item.id === id);
      if (!group) throw new Error("That group is no longer in the office.");
      if (group.table && group.table.status === "running") {
        throw new Error("This group is still working. Stop it before changing the table.");
      }
      group.name = name;
      group.subject = subject;
      group.memberIds = memberIds;
      if (group.table) {
        const approvals = {};
        for (const memberId of memberIds) {
          if (group.table.approvals[memberId]) approvals[memberId] = true;
        }
        group.table.approvals = approvals;
      }
      persist();
      return clone(group);
    }
    const group = {
      id: "g_" + crypto.randomBytes(6).toString("hex"),
      name,
      subject,
      memberIds,
      createdAt: new Date().toISOString(),
      table: null,
    };
    current.groups.push(group);
    persist();
    return clone(group);
  }

  function deleteGroup(id) {
    const current = load();
    const group = current.groups.find((item) => item.id === id);
    if (!group) throw new Error("That group is no longer in the office.");
    if (group.table && group.table.status === "running") {
      throw new Error("Stop the group before deleting it.");
    }
    current.groups = current.groups.filter((item) => item.id !== id);
    persist();
    return publicView();
  }

  function groupById(id) {
    return load().groups.find((group) => group.id === id) || null;
  }

  function workerById(id) {
    return load().workers.find((worker) => worker.id === id) || null;
  }

  function runningGroup() {
    return load().groups.find((group) => group.table && group.table.status === "running") || null;
  }

  function beginTable(groupId, prompt) {
    const group = groupById(groupId);
    if (!group) throw new Error("That group is no longer in the office.");
    if (group.memberIds.length < 2) throw new Error("A group needs at least two workers.");
    if (group.table && group.table.status === "running") throw new Error("This group is already working.");
    const other = runningGroup();
    if (other) throw new Error(other.name + " is still working. Stop that table first.");
    const text = String(prompt || "").trim();
    if (!text) throw new Error("Write what the group should work on.");
    if (text.length > MESSAGE_MAX) throw new Error("That prompt is too long for one send.");
    group.table = {
      prompt: text,
      body: "",
      approvals: {},
      remarks: [],
      status: "running",
      turnWorkerId: "",
      error: "",
      cursor: 0,
    };
    persist();
    return clone(group);
  }

  function continueTable(groupId) {
    const group = groupById(groupId);
    if (!group || !group.table) throw new Error("This group has no draft to continue.");
    if (group.table.status === "running") return clone(group);
    if (group.table.status === "signed") throw new Error("Everyone already signed this draft. Send a new prompt to start another.");
    const other = runningGroup();
    if (other && other.id !== group.id) throw new Error(other.name + " is still working. Stop that table first.");
    group.table.status = "running";
    group.table.error = "";
    persist();
    return clone(group);
  }

  function markTurn(groupId, workerId) {
    const group = groupById(groupId);
    if (!group || !group.table) return null;
    group.table.turnWorkerId = workerId;
    persist();
    return clone(group);
  }

  function applyMemberTurn(groupId, workerId, result) {
    const group = groupById(groupId);
    if (!group || !group.table) throw new Error("That group is no longer working.");
    const worker = workerById(workerId);
    const incoming = String(result && result.body || "").slice(0, 20000).trim();
    const body = incoming || group.table.body;
    const changed = body.trim() !== group.table.body.trim();
    if (changed) group.table.approvals = {};
    group.table.body = body;
    const accepted = Boolean(result && result.approve && body.trim());
    if (accepted) group.table.approvals[workerId] = true;
    else delete group.table.approvals[workerId];
    group.table.remarks.push({
      id: "r_" + crypto.randomBytes(6).toString("hex"),
      workerId,
      name: worker ? worker.name : "Worker",
      text: String(result && result.remarks || "").replace(/\s+/g, " ").trim().slice(0, 2000),
      approve: accepted,
      at: new Date().toISOString(),
    });
    if (group.table.remarks.length > 40) {
      group.table.remarks = group.table.remarks.slice(-40);
    }
    group.table.cursor = group.table.cursor + 1;
    group.table.turnWorkerId = "";
    group.table.error = "";
    group.table.status = everyoneSigned(group) ? "signed" : "running";
    persist();
    return clone(group);
  }

  function finishTable(groupId, status, error) {
    const group = groupById(groupId);
    if (!group || !group.table) return null;
    if (group.table.status === "signed") return clone(group);
    group.table.status = status || "stopped";
    group.table.turnWorkerId = "";
    group.table.error = error ? String(error).slice(0, 500) : "";
    persist();
    return clone(group);
  }

  function appendChat(entry) {
    const current = load();
    current.chat.push(entry);
    persist();
    return clone(entry);
  }

  function sessionId() {
    return load().chiefSessionId;
  }

  function setSessionId(sessionId) {
    const current = load();
    current.chiefSessionId = sessionId || null;
    persist();
  }

  function resetChat() {
    const current = load();
    current.chat = [];
    current.chiefSessionId = null;
    persist();
    return publicView();
  }

  function acceptProposal(messageId, proposalId) {
    const current = load();
    const message = current.chat.find((item) => item.id === messageId && item.role === "chief");
    if (!message) {
      throw new Error("That draft is no longer in the conversation.");
    }
    const proposal = (message.proposals || []).find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error("That draft is no longer in the conversation.");
    }
    if (proposal.added && proposal.workerId) {
      const existing = current.workers.find((worker) => worker.id === proposal.workerId);
      if (existing) return { worker: clone(existing), office: publicView() };
    }
    const worker = saveWorker({ name: proposal.name, role: proposal.role });
    proposal.added = true;
    proposal.workerId = worker.id;
    persist();
    return { worker, office: publicView() };
  }

  function rosterBrief() {
    return load()
      .workers.map((worker) => {
        const title = worker.isChief ? worker.name + " (chief of staff)" : worker.name;
        return "- " + title + ": " + oneLine(worker.role);
      })
      .join("\n");
  }

  function chiefRole() {
    const chief = load().workers.find((worker) => worker.isChief);
    return chief ? chief.role : DEFAULT_CHIEF_ROLE;
  }

  return {
    load,
    publicView,
    saveWorker,
    deleteWorker,
    appendChat,
    sessionId,
    setSessionId,
    resetChat,
    acceptProposal,
    rosterBrief,
    chiefRole,
    saveGroup,
    deleteGroup,
    groupById,
    workerById,
    runningGroup,
    beginTable,
    continueTable,
    markTurn,
    applyMemberTurn,
    finishTable,
    filePath,
  };
}

function normalizeGroup(group, workers) {
  if (!group || typeof group !== "object") return null;
  const name = cleanName(group.name);
  if (!name) return null;
  const memberIds = [];
  const requested = Array.isArray(group.memberIds) ? group.memberIds : [];
  for (const memberId of requested) {
    const id = String(memberId || "");
    if (!workers.some((worker) => worker.id === id)) continue;
    if (!memberIds.includes(id)) memberIds.push(id);
  }
  const id = /^g_[a-f0-9]{12}$/.test(group.id)
    ? group.id
    : "g_" + crypto.randomBytes(6).toString("hex");
  return {
    id,
    name,
    subject: cleanSubject(group.subject),
    memberIds,
    createdAt: typeof group.createdAt === "string" ? group.createdAt : new Date().toISOString(),
    table: normalizeTable(group.table, memberIds),
  };
}

function normalizeTable(table, memberIds) {
  if (!table || typeof table !== "object") return null;
  const approvals = {};
  const raw = table.approvals && typeof table.approvals === "object" ? table.approvals : {};
  for (const memberId of memberIds) {
    if (raw[memberId]) approvals[memberId] = true;
  }
  let status = table.status === "running" ? "stopped" : table.status;
  if (status !== "signed" && status !== "stopped" && status !== "error") status = "stopped";
  return {
    prompt: String(table.prompt || "").slice(0, MESSAGE_MAX),
    body: String(table.body || "").slice(0, 20000),
    approvals,
    remarks: Array.isArray(table.remarks) ? table.remarks.slice(-40) : [],
    status,
    turnWorkerId: "",
    error: String(table.error || "").slice(0, 500),
    cursor: Number.isFinite(table.cursor) ? table.cursor : 0,
  };
}

function everyoneSigned(group) {
  if (!group.table || !group.table.body.trim()) return false;
  return group.memberIds.every((memberId) => group.table.approvals[memberId]);
}

function normalizeWorker(worker) {
  if (!worker || typeof worker !== "object") return null;
  const name = cleanName(worker.name);
  const role = cleanRole(worker.role);
  if (!name || !role) return null;
  return {
    id: worker.isChief ? "chief" : String(worker.id || "w_" + crypto.randomBytes(6).toString("hex")),
    name,
    role,
    isChief: Boolean(worker.isChief),
    createdAt: typeof worker.createdAt === "string" ? worker.createdAt : new Date().toISOString(),
    updatedAt: typeof worker.updatedAt === "string" ? worker.updatedAt : undefined,
  };
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

function cleanRole(value) {
  return String(value || "").trim().slice(0, ROLE_MAX);
}

function cleanSubject(value) {
  return String(value || "").trim().slice(0, SUBJECT_MAX);
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(6).toString("hex");
}

module.exports = {
  DEFAULT_CHIEF_ROLE,
  PREVIOUS_CHIEF_ROLE,
  MESSAGE_MAX,
  NAME_MAX,
  ROLE_MAX,
  SUBJECT_MAX,
  createStore,
  cleanName,
  cleanRole,
  cleanSubject,
  newId,
};
