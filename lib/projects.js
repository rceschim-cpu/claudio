// lib/projects.js
// Projetos = uma pasta local que o cowork pode LER e ESCREVER, como no
// Claude cowork. Cada projeto aponta para um diretório raiz no disco.
// Toda operação de arquivo é CONFINADA à raiz (proteção contra path traversal):
// nada fora da pasta do projeto é tocado, jamais.

const fs = require("fs");
const path = require("path");

const STORE = path.join(__dirname, "..", "data", "projects.json");

// pastas/arquivos ignorados ao montar a árvore (ruído / pesados / binários)
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next", ".cache",
  "__pycache__", ".venv", "venv", "coverage", ".idea", ".vscode", "data",
]);
const IGNORE_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".exe", ".dll", ".bin", ".mp4", ".mp3", ".woff", ".woff2", ".ttf", ".lock",
]);

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return [];
  }
}
function persist(arr) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(arr, null, 2), "utf8");
}

function newId() {
  return "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function list() {
  // remove duplicatas por pasta (case-insensitive), mantendo a primeira
  const seen = new Set();
  return load()
    .filter((p) => {
      const k = (p.folder || "").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p) => ({ ...p, exists: fs.existsSync(p.folder) }));
}
function get(id) {
  return load().find((p) => p.id === id) || null;
}

function create({ name, folder }) {
  const abs = path.resolve(folder);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error("Pasta não encontrada: " + abs);
  }
  const arr = load();
  // já conectada? não duplica — reaproveita a existente (case-insensitive)
  const existing = arr.find((p) => p.folder.toLowerCase() === abs.toLowerCase());
  if (existing) return existing;
  const proj = {
    id: newId(),
    name: name || path.basename(abs),
    folder: abs,
    created: new Date().toISOString(),
  };
  arr.push(proj);
  persist(arr);
  return proj;
}

function remove(id) {
  const arr = load().filter((p) => p.id !== id);
  persist(arr);
  return true;
}

// Resolve relPath DENTRO da raiz; lança se tentar escapar.
function safeResolve(root, relPath) {
  const clean = String(relPath || "").replace(/^[/\\]+/, "");
  const abs = path.resolve(root, clean);
  const rootAbs = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(rootAbs)) {
    throw new Error("Caminho fora da pasta do projeto: " + relPath);
  }
  return abs;
}

// Árvore de arquivos (lista de caminhos relativos), com limites de profundidade
// e quantidade para não explodir o contexto.
function tree(id, { maxEntries = 600, maxDepth = 8 } = {}) {
  const proj = get(id);
  if (!proj) throw new Error("Projeto não encontrado");
  const out = [];
  const root = proj.folder;

  (function walk(dir, depth) {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (out.length >= maxEntries) break;
      if (e.name.startsWith(".") && e.name !== ".env.example") {
        if (IGNORE_DIRS.has(e.name)) continue;
      }
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        if (IGNORE_EXT.has(path.extname(e.name).toLowerCase())) continue;
        out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
      }
    }
  })(root, 0);

  return { folder: root, files: out, truncated: out.length >= maxEntries };
}

function readFile(id, relPath, { maxBytes = 120_000 } = {}) {
  const proj = get(id);
  if (!proj) throw new Error("Projeto não encontrado");
  const abs = safeResolve(proj.folder, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error("Arquivo não existe: " + relPath);
  let content = fs.readFileSync(abs, "utf8");
  let truncated = false;
  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
    truncated = true;
  }
  return { path: relPath, content, truncated };
}

function writeFile(id, relPath, content) {
  const proj = get(id);
  if (!proj) throw new Error("Projeto não encontrado");
  const abs = safeResolve(proj.folder, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const existed = fs.existsSync(abs);
  fs.writeFileSync(abs, String(content), "utf8");
  return { path: relPath, action: existed ? "atualizado" : "criado", bytes: Buffer.byteLength(content) };
}

module.exports = { list, get, create, remove, tree, readFile, writeFile, safeResolve };
