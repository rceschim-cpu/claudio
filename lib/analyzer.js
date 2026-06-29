// lib/analyzer.js
// Analisador de pasta DETERMINÍSTICO (não usa LLM): varre a pasta de um projeto
// e produz um relatório com tamanhos, ranking, classificação por tipo e
// detecção de DUPLICADOS reais (por conteúdo/hash) — arquivos e pastas.
//
// Cuidados de performance e de OneDrive:
//  - O hash só roda em arquivos cujo TAMANHO coincide com outro (condição
//    necessária p/ serem iguais), respeitando um teto por arquivo e um
//    orçamento total — assim evitamos baixar todo arquivo "online-only".
//  - Arquivos em colisão de tamanho mas acima do orçamento são reportados
//    como "possíveis duplicados (não verificados)".

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// classificação por extensão → categoria legível
const CATEGORIES = {
  imagem: ["jpg", "jpeg", "png", "gif", "bmp", "tiff", "webp", "heic", "raw", "svg", "ico"],
  vídeo: ["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "mpeg", "mpg", "m4v", "3gp"],
  áudio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"],
  documento: ["doc", "docx", "odt", "rtf", "txt", "md", "pages"],
  pdf: ["pdf"],
  planilha: ["xls", "xlsx", "ods", "csv", "tsv"],
  apresentação: ["ppt", "pptx", "odp", "key"],
  compactado: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
  programa: ["exe", "msi", "bat", "cmd", "sh", "app", "apk", "deb", "dmg"],
  código: ["js", "ts", "py", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "html", "css", "json", "xml", "yml", "yaml", "sql", "jsx", "tsx"],
  fonte: ["ttf", "otf", "woff", "woff2"],
};

const EXT_TO_CAT = {};
for (const [cat, exts] of Object.entries(CATEGORIES)) for (const e of exts) EXT_TO_CAT[e] = cat;

// heurística de "natureza" pelo caminho (pistas frágeis, só sugestão)
const NATURE_HINTS = [
  ["profissional", /trabalho|work|projeto|cliente|empresa|positivo|relat[óo]rio|contrato|nota.?fiscal|nf|fatura|invoice/i],
  ["acadêmico", /faculdade|universidade|curso|aula|estudo|tcc|monografia|disciplina|prova|trabalho.?escolar|academ/i],
  ["família/pessoal", /fam[íi]lia|familia|viagem|f[ée]rias|fotos|pessoal|casa|filhos?|anivers[áa]rio|natal|casamento/i],
  ["financeiro", /banco|extrato|imposto|ir\b|financ|or[çc]amento|boleto/i],
  ["backup", /backup|c[óo]pia|cópia|old|antig[oa]|bkp|_bak|restore/i],
];

function fmtBytes(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

function classify(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const cat = EXT_TO_CAT[ext] || "outro";
  let nature = null;
  for (const [name, re] of NATURE_HINTS) if (re.test(file)) { nature = name; break; }
  return { ext, category: cat, nature };
}

// hash streaming (sha256) com teto de bytes
function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(abs);
    s.on("error", reject);
    s.on("data", (d) => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

// varre recursivamente coletando metadados (sem ler conteúdo → sem download)
function walk(root, { ignore, maxFiles }) {
  const files = [];
  let skippedDirs = 0;
  (function rec(dir) {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= maxFiles) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.test(e.name)) { skippedDirs++; continue; }
        rec(abs);
      } else if (e.isFile()) {
        let st;
        try { st = fs.statSync(abs); } catch { continue; }
        files.push({
          abs,
          rel: path.relative(root, abs).replace(/\\/g, "/"),
          dir: path.relative(root, dir).replace(/\\/g, "/"),
          name: e.name,
          size: st.size,
          mtime: st.mtimeMs,
        });
      }
    }
  })(root);
  return { files, skippedDirs };
}

async function analyze(root, opts = {}) {
  const cfg = {
    maxFiles: opts.maxFiles || 60000,
    perFileHashCap: opts.perFileHashCap || 600 * 1e6, // 600 MB por arquivo
    hashBudget: opts.hashBudget || 8 * 1e9,           // 8 GB de hashing no total
    ignore: opts.ignore || /^(node_modules|\.git|\$RECYCLE\.BIN|System Volume Information)$/i,
    topN: opts.topN || 50,
    ...opts,
  };

  const started = Date.now();
  const { files, skippedDirs } = walk(root, cfg);

  let totalSize = 0;
  const byCat = {};
  for (const f of files) {
    totalSize += f.size;
    const c = classify(f.rel);
    f.category = c.category;
    f.ext = c.ext;
    f.nature = c.nature;
    byCat[c.category] = byCat[c.category] || { count: 0, size: 0 };
    byCat[c.category].count++;
    byCat[c.category].size += f.size;
  }

  // ---- duplicados de ARQUIVO ----
  // 1) agrupa por tamanho; só tamanhos repetidos (>0) podem ter duplicata
  const bySize = new Map();
  for (const f of files) {
    if (f.size <= 0) continue;
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }

  let budgetUsed = 0;
  const unverified = []; // colisão de tamanho mas não verificada (orçamento/teto)
  const byHash = new Map();
  for (const [size, group] of bySize) {
    if (group.length < 2) continue;
    for (const f of group) {
      if (size > cfg.perFileHashCap || budgetUsed + size > cfg.hashBudget) {
        unverified.push(f);
        continue;
      }
      try {
        f.hash = await hashFile(f.abs);
        budgetUsed += size;
        if (!byHash.has(f.hash)) byHash.set(f.hash, []);
        byHash.get(f.hash).push(f);
      } catch {
        unverified.push(f);
      }
    }
  }

  // grupos de duplicados reais (mesmo hash, 2+ arquivos)
  const duplicateGroups = [];
  let recoverable = 0;
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    // mantém o de caminho mais curto/mais antigo; sugere apagar o resto
    group.sort((a, b) => a.rel.length - b.rel.length || a.mtime - b.mtime);
    const keep = group[0];
    const remove = group.slice(1);
    recoverable += remove.reduce((s, f) => s + f.size, 0);
    duplicateGroups.push({
      hash: hash.slice(0, 12),
      size: keep.size,
      keep: keep.rel,
      remove: remove.map((f) => f.rel),
      count: group.length,
    });
  }
  duplicateGroups.sort((a, b) => b.size * b.remove.length - a.size * a.remove.length);

  // ---- pastas DUPLICADAS ----
  // assinatura da pasta = conjunto ordenado de (nomeRelativo|hash) dos arquivos
  // hasheados dela. Pastas com assinatura idêntica (2+ arquivos) são duplicatas.
  const folderFiles = new Map(); // dir -> [{name, hash}]
  for (const f of files) {
    if (!f.hash) continue;
    if (!folderFiles.has(f.dir)) folderFiles.set(f.dir, []);
    folderFiles.get(f.dir).push({ name: f.name, hash: f.hash });
  }
  const folderSig = new Map(); // sig -> [dirs]
  for (const [dir, fl] of folderFiles) {
    if (fl.length < 2) continue;
    const sig = fl.map((x) => x.name + "|" + x.hash).sort().join("\n");
    if (!folderSig.has(sig)) folderSig.set(sig, []);
    folderSig.get(sig).push(dir);
  }
  const duplicateFolders = [];
  for (const [sig, dirs] of folderSig) {
    if (dirs.length < 2) continue;
    dirs.sort((a, b) => a.length - b.length);
    const fileCount = sig.split("\n").length;
    const folderSize = (folderFiles.get(dirs[0]) || []).reduce((s) => s, 0);
    // tamanho aproximado da pasta (soma dos arquivos hasheados dela)
    const sizeOfDir = (d) => files.filter((f) => f.dir === d).reduce((s, f) => s + f.size, 0);
    duplicateFolders.push({
      keep: dirs[0] || "(raiz)",
      remove: dirs.slice(1),
      fileCount,
      sizeEach: sizeOfDir(dirs[0]),
    });
  }
  duplicateFolders.sort((a, b) => b.sizeEach * b.remove.length - a.sizeEach * a.remove.length);

  // ---- ranking por tamanho ----
  const largest = files
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, cfg.topN)
    .map((f) => ({ rel: f.rel, size: f.size, sizeHuman: fmtBytes(f.size), category: f.category, nature: f.nature, ext: f.ext }));

  return {
    root,
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    totalFiles: files.length,
    totalSize,
    totalSizeHuman: fmtBytes(totalSize),
    skippedDirs,
    limitedByMaxFiles: files.length >= cfg.maxFiles,
    byCategory: Object.entries(byCat)
      .map(([k, v]) => ({ category: k, count: v.count, size: v.size, sizeHuman: fmtBytes(v.size) }))
      .sort((a, b) => b.size - a.size),
    duplicateGroups,
    duplicateFolders,
    recoverableBytes: recoverable,
    recoverableHuman: fmtBytes(recoverable),
    unverifiedCount: unverified.length,
    hashBudgetExceeded: budgetUsed >= cfg.hashBudget,
    largest,
    fmtBytes,
  };
}

module.exports = { analyze, fmtBytes };
