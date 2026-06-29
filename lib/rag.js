// lib/rag.js
// "Chat com seus documentos": indexa a pasta de um projeto em embeddings
// (grátis, via Gemini) e faz busca semântica para responder com fontes.
//
//   data/rag/<projectId>.json = { projectId, model, dim, builtAt, files, chunks:[{file, idx, text, vec}] }
//
// Vetores são normalizados no índice → busca vira simples produto escalar.

const fs = require("fs");
const path = require("path");
const projects = require("./projects");
const providers = require("./providers");

const DIR = path.join(__dirname, "..", "data", "rag");

// só indexamos arquivos de TEXTO (ler binário/office como utf8 vira lixo)
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "yaml", "yml",
  "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx", "py", "java", "c",
  "cpp", "h", "hpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "sql", "ini",
  "conf", "env", "toml", "tex",
]);

function ensure() { fs.mkdirSync(DIR, { recursive: true }); }
function pathFor(id) { return path.join(DIR, String(id).replace(/[^a-z0-9-]/gi, "") + ".json"); }

function status(id) {
  try {
    const idx = JSON.parse(fs.readFileSync(pathFor(id), "utf8"));
    return { indexed: true, chunks: idx.chunks.length, files: idx.files, builtAt: idx.builtAt, model: idx.model };
  } catch {
    return { indexed: false };
  }
}
function has(id) { return fs.existsSync(pathFor(id)); }

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// divide um texto em pedaços com sobreposição, quebrando em limites de linha
function chunkText(text, size = 1100, overlap = 160) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + size * 0.5) end = nl;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    i = end - overlap;
  }
  return out;
}

// Constrói o índice. opts.maxChunks limita custo/tamanho.
async function indexProject(id, { maxChunks = 4000, maxFileBytes = 200000, onProgress } = {}) {
  ensure();
  const proj = projects.get(id);
  if (!proj) throw new Error("Projeto não encontrado");
  const tree = projects.tree(id, { maxEntries: 5000 });

  const targets = tree.files.filter((f) => TEXT_EXT.has(path.extname(f).slice(1).toLowerCase()));
  const items = []; // {file, idx, text}
  for (const rel of targets) {
    if (items.length >= maxChunks) break;
    let content;
    try { content = projects.readFile(id, rel, { maxBytes: maxFileBytes }).content; } catch { continue; }
    const chunks = chunkText(content);
    chunks.forEach((c, i) => { if (items.length < maxChunks) items.push({ file: rel, idx: i, text: c }); });
  }

  if (!items.length) throw new Error("Nenhum arquivo de texto para indexar nesta pasta.");

  // embeda em lotes, reportando progresso
  const vecs = [];
  const BATCH = 64;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH).map((x) => x.text);
    const part = await providers.embedTexts(slice, { taskType: "RETRIEVAL_DOCUMENT" });
    for (const v of part) vecs.push(normalize(v));
    if (onProgress) onProgress(Math.min(items.length, i + BATCH), items.length);
  }

  const index = {
    projectId: id,
    model: "gemini-embedding-001",
    dim: vecs[0]?.length || 0,
    builtAt: new Date().toISOString(),
    files: new Set(items.map((x) => x.file)).size,
    chunks: items.map((it, k) => ({ file: it.file, idx: it.idx, text: it.text, vec: vecs[k] })),
  };
  fs.writeFileSync(pathFor(id), JSON.stringify(index), "utf8");
  return { chunks: index.chunks.length, files: index.files, builtAt: index.builtAt };
}

// Busca os k trechos mais relevantes para a consulta.
async function search(id, query, k = 6) {
  if (!has(id)) return [];
  const index = JSON.parse(fs.readFileSync(pathFor(id), "utf8"));
  const [qv] = await providers.embedTexts([query], { taskType: "RETRIEVAL_QUERY" });
  const q = normalize(qv);
  const scored = index.chunks.map((c) => {
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * (c.vec[i] || 0);
    return { file: c.file, text: c.text, score: dot };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

function remove(id) {
  try { fs.unlinkSync(pathFor(id)); return true; } catch { return false; }
}

module.exports = { ensure, status, has, indexProject, search, remove, chunkText };
