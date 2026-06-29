// lib/memory.js
// Memória persistente em disco, no mesmo espírito do Claude Code:
//   data/memory/MEMORY.md      → índice (1 linha por memória), carregado todo turno
//   data/memory/<slug>.md      → 1 fato por arquivo, com frontmatter
//
// O modelo cria/atualiza memórias emitindo blocos na resposta:
//   <memory name="slug" type="user" desc="resumo de uma linha">
//   corpo do fato em markdown
//   </memory>
// e apaga com <forget name="slug"/>. O servidor extrai esses blocos,
// persiste, e remove-os do texto antes de mostrar ao usuário.
//
// Como só usamos modelos grátis, priorizamos performance de recall sobre
// economia de tokens: o índice inteiro vai no system prompt todo turno, e
// as memórias mais relevantes entram com corpo completo.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "data", "memory");
const INDEX = path.join(ROOT, "MEMORY.md");

const VALID_TYPES = ["user", "feedback", "project", "reference"];

function ensure() {
  fs.mkdirSync(ROOT, { recursive: true });
  if (!fs.existsSync(INDEX)) {
    fs.writeFileSync(
      INDEX,
      "# MEMORY.md\n\nÍndice de memórias do cowork. Uma linha por memória.\n\n",
      "utf8"
    );
  }
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "memoria";
}

// --- frontmatter mínimo (sem dependência de yaml) ---
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

function buildFrontmatter(meta) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function list() {
  ensure();
  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(ROOT, f), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      name: meta.name || f.replace(/\.md$/, ""),
      description: meta.description || "",
      type: meta.type || "reference",
      updated: meta.updated || "",
      body,
      file: f,
    };
  });
}

function rebuildIndex() {
  ensure();
  const mems = list().sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  const header =
    "# MEMORY.md\n\nÍndice de memórias do cowork — carregado a cada conversa. Uma linha por memória.\n\n";
  const lines = mems.map(
    (m) => `- [${m.name}](${m.name}.md) (${m.type}) — ${m.description}`
  );
  fs.writeFileSync(INDEX, header + lines.join("\n") + "\n", "utf8");
}

function indexText() {
  ensure();
  return fs.readFileSync(INDEX, "utf8");
}

function save({ name, description = "", type = "reference", body, updated }) {
  ensure();
  const slug = slugify(name);
  if (!VALID_TYPES.includes(type)) type = "reference";
  const meta = {
    name: slug,
    description: description.replace(/\n/g, " ").trim(),
    type,
    updated: updated || new Date().toISOString().slice(0, 10),
  };
  const content = buildFrontmatter(meta) + "\n" + String(body || "").trim() + "\n";
  fs.writeFileSync(path.join(ROOT, `${slug}.md`), content, "utf8");
  rebuildIndex();
  return slug;
}

function remove(name) {
  ensure();
  const slug = slugify(name);
  const p = path.join(ROOT, `${slug}.md`);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    rebuildIndex();
    return true;
  }
  return false;
}

// Recall por relevância: pontua cada memória pela sobreposição de palavras
// entre a consulta e (nome + descrição + corpo). Devolve as N melhores com
// corpo completo. Simples, determinístico e suficiente para uso local.
function recall(queryText, limit = 6) {
  const mems = list();
  if (!mems.length) return [];
  const terms = tokenize(queryText);
  if (!terms.size) return mems.slice(0, limit);

  const scored = mems.map((m) => {
    const hay = tokenize(`${m.name} ${m.description} ${m.body}`);
    let score = 0;
    for (const t of terms) if (hay.has(t)) score += 1;
    // peso extra se bater no nome/descrição (sinal mais forte)
    const head = tokenize(`${m.name} ${m.description}`);
    for (const t of terms) if (head.has(t)) score += 1;
    return { m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}

const STOP = new Set(
  "a o e de da do das dos um uma que para por com no na em os as ao aos se sua seu the and for with you your is are to of in on it that this".split(
    " "
  )
);

function tokenize(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

// --- extração de blocos <memory>/<forget> da resposta do modelo ---
// Devolve { cleanText, saved: [slugs], forgotten: [slugs] }.
function processModelOutput(text) {
  const saved = [];
  const forgotten = [];
  let clean = text;

  const memRe =
    /<memory\s+([^>]*?)>\s*([\s\S]*?)<\/memory>/gi;
  clean = clean.replace(memRe, (_full, attrs, body) => {
    const a = parseAttrs(attrs);
    if (a.name) {
      saved.push(
        save({
          name: a.name,
          description: a.desc || a.description || "",
          type: a.type || "reference",
          body,
        })
      );
    }
    return "";
  });

  const forgetRe = /<forget\s+([^>]*?)\/?>(?:<\/forget>)?/gi;
  clean = clean.replace(forgetRe, (_full, attrs) => {
    const a = parseAttrs(attrs);
    if (a.name && remove(a.name)) forgotten.push(slugify(a.name));
    return "";
  });

  return { cleanText: clean.trim(), saved, forgotten };
}

function parseAttrs(attrs) {
  const out = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrs)) !== null) out[m[1]] = m[2];
  return out;
}

module.exports = {
  ensure,
  list,
  save,
  remove,
  recall,
  indexText,
  rebuildIndex,
  processModelOutput,
  ROOT,
};
