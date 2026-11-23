"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  width: 1120,
  height: 780,
  x: null,
  y: null,
  maximized: false,
  zoomFactor: 1,
};

function createWindowState(dataDir) {
  const filePath = path.join(dataDir, "window.json");
  let state = Object.assign({}, DEFAULTS);

  function load() {
    try {
      state = normalize(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (_error) {
      state = Object.assign({}, DEFAULTS);
    }
    return current();
  }

  function current() {
    return Object.assign({}, state);
  }

  function update(patch) {
    state = normalize(Object.assign({}, state, patch || {}));
    const tmp = filePath + ".tmp";
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
    return current();
  }

  return { load, update, current };
}

function normalize(input) {
  const source = input && typeof input === "object" ? input : {};
  const width = clamp(source.width, 880, 4000, DEFAULTS.width);
  const height = clamp(source.height, 620, 3000, DEFAULTS.height);
  const zoomFactor = round(clamp(source.zoomFactor, 0.5, 3, DEFAULTS.zoomFactor));
  const x = finite(source.x) ? Math.round(source.x) : null;
  const y = finite(source.y) ? Math.round(source.y) : null;
  return {
    width: Math.round(width),
    height: Math.round(height),
    x,
    y,
    maximized: Boolean(source.maximized),
    zoomFactor,
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  createWindowState,
  normalize,
};
