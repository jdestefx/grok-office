"use strict";

const fs = require("fs");
const path = require("path");

const WHEN_MAX = 240;
const BODY_MAX = 20000;
const BRIEF_MAX = 20000;

const CATALOG_HEADER = [
  "# Catalog",
  "",
  "One line per note: path, then when to open it. The shelves are this worker's own.",
  "",
].join("\n");

const BRIEF_SEED = [
  "# Project brief",
  "",
  "Facts the whole office shares. The chief keeps this file. Workers read it. Each worker's own lore stays in that worker's ledger.",
  "",
].join("\n");

function createLedger(dataDir) {
  const briefPath = path.join(dataDir, "project", "brief.md");

  function ensureWorker(workerId) {
    const root = ledgerRoot(workerId);
    fs.mkdirSync(root, { recursive: true });
    const indexPath = path.join(root, "index.md");
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, CATALOG_HEADER, "utf8");
    }
    ensureBrief();
    return root;
  }

  function ensureBrief() {
    if (fs.existsSync(briefPath)) return briefPath;
    fs.mkdirSync(path.dirname(briefPath), { recursive: true });
    fs.writeFileSync(briefPath, BRIEF_SEED, "utf8");
    return briefPath;
  }

  function removeWorker(workerId) {
    const id = assertId(workerId);
    fs.rmSync(path.join(dataDir, "workers", id), { recursive: true, force: true });
  }

  function read(workerId) {
    ensureWorker(workerId);
    return {
      entries: readCatalog(workerId),
      brief: fs.readFileSync(briefPath, "utf8"),
    };
  }

  function readNote(workerId, notePath) {
    const located = locate(workerId, notePath);
    if (!fs.existsSync(located.full)) {
      throw new Error("That note is not in the ledger yet.");
    }
    const entries = readCatalog(workerId);
    const entry = entries.find((item) => item.path === located.rel);
    return {
      path: located.rel,
      when: entry ? entry.when : "",
      body: fs.readFileSync(located.full, "utf8"),
    };
  }

  function saveNote(workerId, input) {
    const located = locate(workerId, input && input.path);
    const when = cleanWhen(input && input.when);
    const body = cleanBody(input && input.body);
    if (!when) {
      throw new Error("Say when this note should be opened.");
    }
    const previous = input && input.previousPath ? locate(workerId, input.previousPath) : null;
    if (previous && previous.rel !== located.rel && fs.existsSync(located.full)) {
      throw new Error("A note already uses that path.");
    }
    if (!previous && fs.existsSync(located.full)) {
      const entries = readCatalog(workerId);
      const known = entries.some((item) => item.path === located.rel);
      if (!known) {
        throw new Error("A file already uses that path.");
      }
    }
    fs.mkdirSync(path.dirname(located.full), { recursive: true });
    fs.writeFileSync(located.full, body.endsWith("\n") ? body : body + "\n", "utf8");
    if (previous && previous.rel !== located.rel) {
      if (fs.existsSync(previous.full)) fs.rmSync(previous.full);
      pruneEmpty(path.dirname(previous.full), previous.ledgerRoot);
    }
    writeCatalog(workerId, upsert(readCatalog(workerId), { path: located.rel, when }, previous && previous.rel));
    return { path: located.rel, when, body };
  }

  function deleteNote(workerId, notePath) {
    const located = locate(workerId, notePath);
    if (fs.existsSync(located.full)) fs.rmSync(located.full);
    pruneEmpty(path.dirname(located.full), located.ledgerRoot);
    const entries = readCatalog(workerId).filter((item) => item.path !== located.rel);
    writeCatalog(workerId, entries);
    return entries;
  }

  function saveBrief(text) {
    ensureBrief();
    const body = String(text || "").replace(/\r\n/g, "\n").slice(0, BRIEF_MAX);
    fs.writeFileSync(briefPath, body.endsWith("\n") ? body : body + "\n", "utf8");
    return fs.readFileSync(briefPath, "utf8");
  }

  function readCatalog(workerId) {
    const indexPath = path.join(ledgerRoot(workerId), "index.md");
    if (!fs.existsSync(indexPath)) return [];
    return parseCatalog(fs.readFileSync(indexPath, "utf8"));
  }

  function writeCatalog(workerId, entries) {
    const lines = [CATALOG_HEADER.trimEnd()];
    if (entries.length) lines.push("");
    for (const entry of entries) {
      lines.push("- " + entry.path + " — " + entry.when);
    }
    lines.push("");
    fs.writeFileSync(path.join(ledgerRoot(workerId), "index.md"), lines.join("\n"), "utf8");
  }

  function ledgerRoot(workerId) {
    return path.join(dataDir, "workers", assertId(workerId), "ledger");
  }

  function locate(workerId, notePath) {
    const id = assertId(workerId);
    const rel = normalizeNotePath(notePath);
    const root = path.resolve(dataDir, "workers", id, "ledger");
    const full = path.resolve(root, rel);
    const relative = path.relative(root, full);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("That path is outside this worker's ledger.");
    }
    return { rel: rel.split(path.sep).join("/"), full, ledgerRoot: root };
  }

  return {
    ensureWorker,
    ensureBrief,
    removeWorker,
    read,
    readNote,
    saveNote,
    deleteNote,
    saveBrief,
    briefPath,
  };
}

function parseCatalog(text) {
  const entries = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^- (\S+) — (.+)$/.exec(line.trim());
    if (!match) continue;
    entries.push({ path: match[1], when: match[2].trim() });
  }
  return entries;
}

function upsert(entries, entry, previousPath) {
  const next = [];
  let placed = false;
  for (const item of entries) {
    if (item.path === entry.path || item.path === previousPath) {
      if (!placed) {
        next.push(entry);
        placed = true;
      }
      continue;
    }
    next.push(item);
  }
  if (!placed) next.push(entry);
  return next;
}

function normalizeNotePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error("Use a path inside the ledger, such as regions/mediterranean.md.");
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.length > 6) {
    throw new Error("Use a shorter path, with at most six folders.");
  }
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("That path is outside this worker's ledger.");
  }
  for (const part of parts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$/.test(part)) {
      throw new Error("Paths use letters, numbers, dots, and dashes. No spaces.");
    }
  }
  if (parts.length === 1 && parts[0].toLowerCase() === "index.md") {
    throw new Error("index.md is the catalog. Put the note on its own path.");
  }
  if (!parts[parts.length - 1].toLowerCase().endsWith(".md")) {
    throw new Error("Note files end in .md.");
  }
  return parts.join("/");
}

function assertId(workerId) {
  const id = String(workerId || "");
  if (!/^(chief|w_[a-f0-9]{12})$/.test(id)) {
    throw new Error("That worker is no longer in the office.");
  }
  return id;
}

function cleanWhen(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, WHEN_MAX);
}

function cleanBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").slice(0, BODY_MAX);
}

function pruneEmpty(start, stop) {
  let current = path.resolve(start);
  const root = path.resolve(stop);
  while (current !== root && current.startsWith(root + path.sep)) {
    let names = [];
    try {
      names = fs.readdirSync(current);
    } catch (_error) {
      break;
    }
    if (names.length) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

module.exports = {
  BRIEF_SEED,
  CATALOG_HEADER,
  createLedger,
  normalizeNotePath,
  parseCatalog,
};
