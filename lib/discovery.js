// lib/discovery.js
// Descoberta semanal de modelos GRÁTIS nas APIs cadastradas.
// Auto-atualiza o catálogo efetivo (decisão do usuário): consulta o
// endpoint /models de cada provedor com chave, e:
//   - valida se os modelos curados ainda existem (remove os que sumiram);
//   - adiciona automaticamente novos modelos grátis quando dá para ter
//     certeza do custo zero (OpenRouter :free / pricing 0, e free tier
//     flash do Gemini). Para Groq/Cerebras/Mistral/NVIDIA o /models não
//     expõe preço, então só validamos a liveness dos curados (não inventamos
//     "grátis" para um modelo que pode ser pago, como Kimi K2).
//
// Resultado gravado em:
//   data/catalog.overrides.json   → consumido pelo server para o catálogo efetivo
//   data/discovery-report.md      → relatório legível da última varredura

const fs = require("fs");
const path = require("path");
const providers = require("./providers");

const DATA = path.join(__dirname, "..", "data");
const OVERRIDES_FILE = path.join(DATA, "catalog.overrides.json");
const REPORT_FILE = path.join(DATA, "discovery-report.md");

// Provedores onde conseguimos confirmar "grátis" com segurança e, por isso,
// podemos AUTO-ADICIONAR modelos novos.
const RELIABLE_FREE = new Set(["openrouter", "gemini"]);

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
  } catch {
    return { generatedAt: null, providers: {} };
  }
}

// Aplica os overrides sobre o catálogo base, produzindo o catálogo efetivo.
function applyOverrides(baseCatalog, overrides = loadOverrides()) {
  const eff = JSON.parse(JSON.stringify(baseCatalog));
  const ov = overrides.providers || {};
  for (const [providerId, provider] of Object.entries(eff)) {
    const po = ov[providerId];
    if (!po) continue;
    const removed = new Set(po.removed || []);
    provider.models = (provider.models || []).filter((m) => !removed.has(m.id));
    for (const m of provider.models) {
      if (removed.has(m.id)) m.deprecated = true;
    }
    // adiciona descobertos que ainda não estão no catálogo
    const existing = new Set(provider.models.map((m) => m.id));
    for (const added of po.added || []) {
      if (!existing.has(added.id)) provider.models.push(added);
    }
  }
  return eff;
}

// Executa a varredura. baseCatalog = CATALOG do catalog.js.
async function run(baseCatalog, { hasKeyFn = providers.hasKey } = {}) {
  const report = {
    startedAt: new Date().toISOString(),
    providers: {},
    summary: { checked: 0, removed: 0, added: 0, errors: 0 },
  };
  const newOverrides = { generatedAt: new Date().toISOString(), providers: {} };

  for (const [providerId, provider] of Object.entries(baseCatalog)) {
    if (!hasKeyFn(providerId)) {
      report.providers[providerId] = { skipped: "sem chave" };
      continue;
    }
    report.summary.checked += 1;

    let live;
    try {
      live = await providers.listModels(providerId);
    } catch (err) {
      report.providers[providerId] = { error: String(err.message || err) };
      report.summary.errors += 1;
      continue;
    }

    const liveIds = new Set(live.map((m) => m.id));
    const curated = provider.models || [];
    const curatedFree = curated.filter((m) => m.input === 0 && m.output === 0);

    // 1. modelos curados grátis que sumiram do provedor → remover
    const removed = curatedFree
      .filter((m) => !liveIds.has(m.id))
      .map((m) => m.id);

    // 2. novos modelos grátis (só onde a detecção é confiável)
    const added = [];
    if (RELIABLE_FREE.has(providerId)) {
      const curatedIds = new Set(curated.map((m) => m.id));
      for (const lm of live) {
        if (!lm.free || curatedIds.has(lm.id)) continue;
        added.push(normalizeDiscovered(providerId, lm));
      }
    }

    if (removed.length || added.length) {
      newOverrides.providers[providerId] = { removed, added };
    }
    report.providers[providerId] = {
      liveCount: live.length,
      curatedFree: curatedFree.length,
      removed,
      added: added.map((a) => a.id),
    };
    report.summary.removed += removed.length;
    report.summary.added += added.length;
  }

  report.finishedAt = new Date().toISOString();

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(newOverrides, null, 2), "utf8");
  fs.writeFileSync(REPORT_FILE, renderReport(report), "utf8");

  return report;
}

function normalizeDiscovered(providerId, liveModel) {
  const raw = liveModel.raw || {};
  let context = "";
  if (raw.context_length) context = approxContext(raw.context_length);
  else if (raw.inputTokenLimit) context = approxContext(raw.inputTokenLimit);

  return {
    id: liveModel.id,
    name: prettifyId(liveModel.id),
    released: new Date().toISOString().slice(0, 10),
    tier: "grátis (descoberto automaticamente)",
    input: 0,
    output: 0,
    context: context || "—",
    outputs: ["texto"],
    notes: "Adicionado automaticamente pela descoberta semanal de modelos grátis.",
    discovered: true,
  };
}

function approxContext(n) {
  if (n >= 1_000_000) return Math.round(n / 1_000_000) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

function prettifyId(id) {
  const tail = String(id).split("/").pop().replace(/:free$/, "");
  return tail.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderReport(report) {
  const lines = [];
  lines.push("# Relatório de descoberta de modelos grátis\n");
  lines.push(`- Início: ${report.startedAt}`);
  lines.push(`- Fim: ${report.finishedAt}`);
  lines.push(
    `- Provedores verificados: ${report.summary.checked} | adicionados: ${report.summary.added} | removidos: ${report.summary.removed} | erros: ${report.summary.errors}\n`
  );
  for (const [p, info] of Object.entries(report.providers)) {
    lines.push(`## ${p}`);
    if (info.skipped) lines.push(`- ignorado: ${info.skipped}`);
    else if (info.error) lines.push(`- ⚠ erro: ${info.error}`);
    else {
      lines.push(`- modelos vivos na API: ${info.liveCount}`);
      lines.push(`- grátis curados: ${info.curatedFree}`);
      if (info.removed?.length) lines.push(`- 🗑 removidos (sumiram): ${info.removed.join(", ")}`);
      if (info.added?.length) lines.push(`- ✨ adicionados: ${info.added.join(", ")}`);
      if (!info.removed?.length && !info.added?.length) lines.push("- sem mudanças");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function lastReport() {
  try {
    return fs.readFileSync(REPORT_FILE, "utf8");
  } catch {
    return null;
  }
}

module.exports = { run, applyOverrides, loadOverrides, lastReport, OVERRIDES_FILE, REPORT_FILE };
