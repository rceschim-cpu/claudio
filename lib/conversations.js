// lib/conversations.js
// Histórico de conversas persistido em disco (1 arquivo JSON por conversa).
//   data/conversations/<id>.json
//   { id, title, created, updated, messages: [{role, content, meta}] }

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "data", "conversations");

function ensure() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function newId() {
  // id ordenável por tempo + sufixo aleatório curto
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

function pathFor(id) {
  // proteção básica contra path traversal
  const safe = String(id).replace(/[^a-z0-9-]/gi, "");
  return path.join(ROOT, `${safe}.json`);
}

function load(id) {
  ensure();
  const p = pathFor(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function saveConversation(conv) {
  ensure();
  conv.updated = new Date().toISOString();
  fs.writeFileSync(pathFor(conv.id), JSON.stringify(conv, null, 2), "utf8");
  return conv;
}

function create(title = "Nova conversa", opts = {}) {
  const now = new Date().toISOString();
  const conv = {
    id: newId(),
    title,
    created: now,
    updated: now,
    messages: [],
    contextMemory: Boolean(opts.contextMemory),
    context: "",
  };
  return saveConversation(conv);
}

// Atualiza a "memória deste chat" (contexto sempre lido).
function setContext(id, text) {
  const conv = load(id);
  if (!conv) return false;
  conv.context = String(text || "");
  conv.contextMemory = true;
  saveConversation(conv);
  return true;
}

// Anexa mensagens e atualiza o título (se ainda for o padrão) com base
// na primeira mensagem do usuário.
function appendMessages(id, messages) {
  let conv = load(id);
  if (!conv) conv = { ...create(), id };
  conv.messages.push(...messages);
  if ((!conv.title || conv.title === "Nova conversa") && conv.messages.length) {
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser) {
      conv.title = String(firstUser.content).replace(/\s+/g, " ").slice(0, 50);
    }
  }
  return saveConversation(conv);
}

function list() {
  ensure();
  return fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
        return {
          id: c.id,
          title: c.title,
          created: c.created,
          updated: c.updated,
          count: (c.messages || []).length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}

function remove(id) {
  ensure();
  const p = pathFor(id);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    return true;
  }
  return false;
}

module.exports = {
  ensure,
  create,
  setContext,
  load,
  save: saveConversation,
  appendMessages,
  list,
  remove,
  ROOT,
};
