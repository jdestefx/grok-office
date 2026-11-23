"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GROK_CANDIDATES = [
  process.env.GROK_BIN,
  "C:\\Users\\admin\\.grok\\bin\\grok.exe",
  "grok",
].filter(Boolean);

function findGrok() {
  for (const candidate of GROK_CANDIDATES) {
    if (candidate === "grok") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "grok";
}

function ollamaOrigin(host) {
  let raw = String(host || "").trim();
  if (!raw) throw new Error("Enter the address of the Linux server.");
  if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    throw new Error("That server address is not a valid host.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http address for the Ollama server.");
  }
  if (!url.port) url.port = "11434";
  return url.origin;
}

async function complete(options) {
  const settings = options.settings || { provider: "grok" };
  if (settings.provider === "ollama") return completeOllama(options);
  return completeGrok(options);
}

async function testOllama(settings) {
  const origin = ollamaOrigin(settings.ollamaHost);
  const model = settings.ollamaModel || "gpt-oss:20b";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(origin + "/api/tags", { signal: controller.signal });
    if (!response.ok) {
      throw new Error("Ollama at " + origin + " answered " + response.status + ".");
    }
    const payload = await response.json();
    const names = Array.isArray(payload.models) ? payload.models.map((item) => item.name).filter(Boolean) : [];
    const found = names.some((name) => name === model || name.startsWith(model));
    return { ok: true, origin, model, found, names };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Ollama at " + origin + " did not answer.");
    }
    if (error.message && error.message.startsWith("Ollama at")) throw error;
    throw new Error("Cannot reach Ollama at " + origin + ". The Linux server has to be awake, and Ollama has to listen on the network, not only on localhost.");
  } finally {
    clearTimeout(timer);
  }
}

function completeGrok(options) {
  const grokBin = options.grokBin || findGrok();
  const promptPath = path.join(os.tmpdir(), "grok-office-" + process.pid + "-" + Date.now() + ".txt");
  fs.writeFileSync(promptPath, options.prompt, "utf8");
  const args = [
    "--prompt-file",
    promptPath,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(options.schema),
    "--system-prompt-override",
    options.system,
    "--no-subagents",
    "--no-memory",
    "--no-plan",
    "--disable-web-search",
    "--max-turns",
    "2",
    "--cwd",
    options.cwd,
  ];
  if (options.sessionId) args.push("--resume", options.sessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(grokBin, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: process.env,
    });
    const handle = { kill() { child.kill(); } };
    if (typeof options.onStop === "function") options.onStop(handle);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The turn took too long and was stopped."));
    }, options.timeoutMs || 120000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fs.unlink(promptPath, () => {});
      if (error.code === "ENOENT") {
        reject(new Error("Could not find grok.exe on this PC."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.unlink(promptPath, () => {});
      try {
        const payload = parseJsonBlob(stdout);
        resolve({ data: extractData(payload), sessionId: payload.sessionId || "" });
      } catch (error) {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
        if (code && code !== 0) {
          reject(new Error(error.message + (detail ? " " + detail : "")));
          return;
        }
        reject(error);
      }
    });
  });
}

async function completeOllama(options) {
  const origin = ollamaOrigin(options.settings.ollamaHost);
  const model = options.settings.ollamaModel || "gpt-oss:20b";
  const controller = new AbortController();
  let timedOut = false;
  const handle = { kill() { controller.abort(); } };
  if (typeof options.onStop === "function") options.onStop(handle);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs || 180000);
  const messages = [{ role: "system", content: options.system }];
  for (const message of options.history || []) {
    if (!message || !message.content) continue;
    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content),
    });
  }
  messages.push({ role: "user", content: options.prompt });
  try {
    const response = await fetch(origin + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: options.schema,
        messages,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error("Ollama at " + origin + " answered " + response.status + ". " + detail.slice(0, 240));
    }
    const payload = await response.json();
    const content = payload && payload.message ? payload.message.content : "";
    return { data: parseModelJson(content), sessionId: "" };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(timedOut ? "The turn took too long and was stopped." : "The turn was stopped.");
    }
    if (error.message && error.message.startsWith("Ollama at")) throw error;
    throw new Error("Cannot reach Ollama at " + origin + ". The Linux server has to be awake, and Ollama has to listen on the network, not only on localhost.");
  } finally {
    clearTimeout(timer);
  }
}

function extractData(payload) {
  if (!payload || typeof payload !== "object") throw new Error("The model returned an empty response.");
  if (payload.type === "error") throw new Error(payload.message || "The model could not answer.");
  const structured = payload.structured_output || payload.structuredOutput || null;
  if (structured && typeof structured === "object") return structured;
  if (payload.text) return parseModelJson(payload.text);
  throw new Error("The model returned an empty response.");
}

function parseModelJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!raw) throw new Error("The model returned an empty response.");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_error) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error("The model returned something that was not JSON.");
}

function parseJsonBlob(raw) {
  const trimmed = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("The model returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("The model returned something that was not JSON.");
  }
}

module.exports = {
  complete,
  findGrok,
  ollamaOrigin,
  parseModelJson,
  testOllama,
};
