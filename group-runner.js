"use strict";

const { complete } = require("./model-client");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    remarks: {
      type: "string",
      description: "What this worker says to the others. One short paragraph.",
    },
    body: {
      type: "string",
      description: "The full proposed content, without any signature lines.",
    },
    approve: {
      type: "boolean",
      description: "True only when this worker can sign this exact body.",
    },
  },
  required: ["remarks", "body", "approve"],
};

function signatureLine(name, approved) {
  return (approved ? "[X]" : "[ ]") + " Approved By " + name;
}

function proposedContent(members, approvals, body) {
  const lines = members.map((member) => signatureLine(member.name, Boolean(approvals && approvals[member.id])));
  const prose = stripSignatures(body);
  return lines.join("\n") + (prose ? "\n\n" + prose : "");
}

function stripSignatures(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\[(X| )\] Approved By \S.*$/.test(line.trim()))
    .join("\n")
    .trim();
}

function buildMemberPrompt(input) {
  const others = input.members.filter((member) => member.id !== input.worker.id);
  const catalog = input.catalog.length
    ? input.catalog.map((entry) => "- " + entry.path + " — " + entry.when).join("\n")
    : "- (no notes yet)";
  const recent = input.recent.length
    ? input.recent.map((remark) => remark.name + ": " + (remark.text || (remark.approve ? "Signed." : "No remark."))).join("\n")
    : "(no remarks yet)";
  const brief = String(input.brief || "").trim().slice(0, 6000) || "(empty)";
  return [
    "You are " + input.worker.name + ".",
    input.worker.role,
    "",
    "You are sitting with " + others.map((member) => member.name).join(", ") + " in the group \"" + input.groupName + "\".",
    "The chief is not in this conversation. Work only your own aspect, and leave their aspects intact.",
    "",
    "Why this group is together, and what the discussion stays on:",
    String(input.subject || "").trim() || "(No subject written yet. The prompt is the whole focus. Stay inside your own role.)",
    "",
    "Your catalog. These lines say when a note is worth opening. Do not paste the whole ledger.",
    catalog,
    "",
    "Project brief:",
    brief,
    "",
    "The group was asked:",
    input.prompt,
    "",
    "Current proposed content. The office owns the signature lines. Do not put them in body.",
    input.proposed || "(nothing drafted yet)",
    "",
    "Recent remarks:",
    recent,
    "",
    "Return the whole body, not a fragment.",
    "Set approve to true only when you can sign this exact body.",
    "Signing adds this line for you: " + signatureLine(input.worker.name, true) + ".",
    "If you change the body, the other signatures come off and those workers must sign again.",
  ].join("\n");
}

const SYSTEM = [
  "You are one member of a working group.",
  "The group subject says why you are at this table and what the discussion is about. Stay inside it and inside your own role.",
  "Return only the JSON object.",
  "remarks is a short note to the other members.",
  "body is the full proposed content and contains no signature lines.",
  "approve is true only when you accept that exact body.",
  "Do not use tools. Do not browse. Do not write files.",
].join(" ");

async function askMember(options) {
  const result = await complete({
    settings: options.settings || { provider: "grok" },
    system: SYSTEM,
    prompt: options.prompt,
    schema: SCHEMA,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    onStop: options.onStop,
  });
  const data = result.data || {};
  return {
    remarks: String(data.remarks || "").trim(),
    body: stripSignatures(data.body),
    approve: Boolean(data.approve),
  };
}

module.exports = {
  askMember,
  buildMemberPrompt,
  proposedContent,
  signatureLine,
  stripSignatures,
};
