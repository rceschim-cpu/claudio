// lib/skills.js
// Skills no estilo Claude: cada skill é uma pasta em data/skills/<nome>/
// com um SKILL.md contendo frontmatter (name, description) + instruções.
//
//   data/skills/<nome>/SKILL.md
//   ---
//   name: revisor-codigo
//   description: Revisa código procurando bugs e simplificações.
//   ---
//   <instruções detalhadas...>
//
// Progressive disclosure: o system prompt recebe só a LISTA (nome + descrição).
// O modelo "invoca" uma skill escrevendo <skill name="revisor-codigo"/> na
// resposta; o servidor injeta o corpo do SKILL.md no próximo turno.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "data", "skills");

function ensure() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) meta[k] = v;
  }
  return { meta, body: (m[2] || "").trim() };
}

function list() {
  ensure();
  const dirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory());
  const skills = [];
  for (const d of dirs) {
    const p = path.join(ROOT, d.name, "SKILL.md");
    if (!fs.existsSync(p)) continue;
    const { meta, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    skills.push({
      name: meta.name || d.name,
      dir: d.name,
      description: meta.description || "",
      body,
    });
  }
  return skills;
}

function get(name) {
  return list().find((s) => s.name === name || s.dir === name) || null;
}

function listText() {
  const skills = list();
  if (!skills.length) return "(nenhuma skill instalada)";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

// Detecta <skill name="..."/> na resposta do modelo.
// Devolve { cleanText, invoked: [names] }.
function detectInvocations(text) {
  const invoked = [];
  const re = /<skill\s+([^>]*?)\/?>(?:<\/skill>)?/gi;
  const clean = text.replace(re, (_full, attrs) => {
    const m = attrs.match(/name\s*=\s*"([^"]*)"/);
    if (m && m[1]) invoked.push(m[1]);
    return "";
  });
  return { cleanText: clean.trim(), invoked };
}

// Cria/atualiza uma skill a partir da UI.
function save({ name, description = "", body = "" }) {
  ensure();
  const dir = String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  const content =
    `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n` +
    String(body).trim() +
    "\n";
  fs.writeFileSync(path.join(ROOT, dir, "SKILL.md"), content, "utf8");
  return dir;
}

function remove(name) {
  ensure();
  const s = get(name);
  if (!s) return false;
  fs.rmSync(path.join(ROOT, s.dir), { recursive: true, force: true });
  return true;
}

module.exports = { ensure, list, get, listText, detectInvocations, save, remove, ROOT };
