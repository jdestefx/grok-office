"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MODEL = "gpt-oss:20b";

function createSettings(dataDir) {
  const filePath = path.join(dataDir, "settings.json");
  let settings = null;

  function load() {
    if (settings) return clone(settings);
    try {
      settings = normalize(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") {
        try {
          fs.renameSync(filePath, filePath + ".bad");
        } catch (_renameError) {
          /* replace a damaged settings file */
        }
      }
      settings = normalize({});
      persist();
    }
    return clone(settings);
  }

  function save(input) {
    settings = normalize(input || {});
    if (settings.provider === "ollama" && !settings.ollamaHost) {
      throw new Error("Enter the address of the Linux server.");
    }
    persist();
    return clone(settings);
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  return { load, save, filePath };
}

function normalize(input) {
  const provider = input && input.provider === "ollama" ? "ollama" : "grok";
  return {
    provider,
    ollamaHost: cleanHost(input && input.ollamaHost),
    ollamaModel: cleanModel(input && input.ollamaModel) || DEFAULT_MODEL,
  };
}

function cleanHost(value) {
  return String(value || "").trim().slice(0, 200);
}

function cleanModel(value) {
  return String(value || "").trim().slice(0, 80);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_MODEL,
  createSettings,
  normalize,
};
