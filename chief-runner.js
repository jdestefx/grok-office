"use strict";

const { complete } = require("./model-client");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: {
      type: "string",
      description: "What the chief says to the user. Plain sentences. No JSON inside the reply.",
    },
    workers: {
      type: "array",
      description: "Workers to propose. Empty unless the user is asking to define or create a worker.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Short worker name, a few words at most." },
          role: {
            type: "string",
            description: "Second-person job. Say what this worker is in charge of, then name the shelves they file notes on. Those shelves are theirs alone. One job only.",
          },
        },
        required: ["name", "role"],
      },
    },
  },
  required: ["reply", "workers"],
};

const CONTRACT = [
  "You are speaking inside Grok Office, a desk where the user defines workers.",
  "The user message lists the workers who already exist.",
  "Answer only as the JSON object you were given.",
  "reply is what you say to the user.",
  "workers is a list of new people to hire.",
  "Leave workers empty when the user is asking a question, editing someone who already exists, or chatting.",
  "Propose a worker only when the user wants a new one defined or created.",
  "Never propose a name that already appears in the roster.",
  "Each role is written to that worker, in the second person, and starts by saying what they are in charge of.",
  "Each role also names how that worker files their notes.",
  "The shelves belong to that worker. A historian might file by region, people, and date. Another worker may file by a completely different set of shelves.",
  "Do not give every worker the same filing system.",
  "Do not use tools. Do not write files. Do not browse.",
].join(" ");

function buildPrompt(rosterBrief, userText) {
  return [
    "Workers already in the office:",
    rosterBrief || "- (none besides you)",
    "",
    "The user says:",
    userText.trim(),
  ].join("\n");
}

function buildSystemPrompt(chiefRole) {
  return [chiefRole.trim(), "", CONTRACT].join("\n");
}

function parseGrokOutput(raw) {
  const payload = parseJsonBlob(raw);
  if (!payload || typeof payload !== "object") {
    throw new Error("The chief returned an empty response.");
  }
  if (payload.type === "error") {
    throw new Error(payload.message || "The chief could not answer.");
  }
  const structured = payload.structured_output || payload.structuredOutput || null;
  if (structured && typeof structured === "object") {
    return {
      reply: String(structured.reply || "").trim(),
      workers: asWorkers(structured.workers),
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    };
  }
  const text = String(payload.text || "").trim();
  if (text) {
    try {
      const embedded = JSON.parse(text);
      if (embedded && typeof embedded === "object") {
        return {
          reply: String(embedded.reply || "").trim(),
          workers: asWorkers(embedded.workers),
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
        };
      }
    } catch (_error) {
      return {
        reply: text,
        workers: [],
        sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
      };
    }
  }
  throw new Error("The chief returned no reply.");
}

function asWorkers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: item && item.name ? String(item.name) : "",
      role: item && item.role ? String(item.role) : "",
    }))
    .filter((item) => item.name.trim() && item.role.trim());
}

function parseJsonBlob(raw) {
  const trimmed = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new Error("The chief returned an empty response.");
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("The chief returned something that was not JSON.");
  }
}

async function askChief(options) {
  const result = await complete({
    settings: options.settings || { provider: "grok" },
    system: options.systemPrompt,
    prompt: options.prompt,
    schema: SCHEMA,
    sessionId: options.sessionId,
    history: options.history || [],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    onStop: options.onStop,
  });
  const data = result.data || {};
  return {
    reply: String(data.reply || "").trim(),
    workers: asWorkers(data.workers),
    sessionId: result.sessionId || "",
  };
}

module.exports = {
  CONTRACT,
  SCHEMA,
  askChief,
  buildPrompt,
  buildSystemPrompt,
  parseGrokOutput,
};
