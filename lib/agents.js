// lib/agents.js
// AGENTES — "cópias suas" que executam trabalhos.
// Um agente é um PACOTE portátil (1 arquivo JSON) com:
//   persona + instruções + playbook (programação) + conhecimento (RAG)
//   + conectores (web/office/imagem/pasta/skills) + preferência de modelo
//   + mapeamento de atividade (job description) para calcular ROI
//   + dono (usuário/depto/VP) para as visões gerenciais.
//
//   data/agents/<id>.json      → um arquivo por agente (fácil de compartilhar)
//   data/agent-runs.jsonl      → log append-only de execuções (base do ROI)

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "data", "agents");
const RUNS = path.join(__dirname, "..", "data", "agent-runs.jsonl");

const FREQ_PER_MONTH = { diaria: 21, semanal: 4.33, quinzenal: 2, mensal: 1, "sob demanda": 1 };

function ensure() {
  fs.mkdirSync(DIR, { recursive: true });
}
function newId() {
  return "ag-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function pathFor(id) {
  return path.join(DIR, String(id).replace(/[^a-z0-9-]/gi, "") + ".json");
}

// Normaliza qualquer entrada (form, import, Claude) no formato canônico.
function normalize(input = {}, base = {}) {
  const c = input.connectors || base.connectors || {};
  const a = input.activity || base.activity || {};
  const o = input.owner || base.owner || {};
  return {
    id: base.id || input.id || newId(),
    schema: "prisma-agent/1",
    name: String(input.name ?? base.name ?? "Novo agente").slice(0, 80),
    icon: String(input.icon ?? base.icon ?? "🤖").slice(0, 8),
    description: String(input.description ?? base.description ?? "").slice(0, 400),
    role: String(input.role ?? base.role ?? "").slice(0, 2000),
    instructions: String(input.instructions ?? base.instructions ?? "").slice(0, 20000),
    playbook: (input.playbook ?? base.playbook ?? []).map((s) => String(s).slice(0, 800)).slice(0, 40),
    knowledge: (input.knowledge ?? base.knowledge ?? [])
      .map((k) => ({ title: String(k.title || "sem título").slice(0, 160), content: String(k.content || "").slice(0, 200000) }))
      .slice(0, 100),
    connectors: {
      web: Boolean(c.web),
      office: c.office !== undefined ? Boolean(c.office) : true,
      image: Boolean(c.image),
      folder: c.folder || null,          // projectId de uma pasta conectada
      skills: (c.skills || []).map(String).slice(0, 20),
      autoApply: c.autoApply !== undefined ? Boolean(c.autoApply) : true,
    },
    model: {
      mode: (input.model?.mode ?? base.model?.mode) === "manual" ? "manual" : "auto",
      chain: input.model?.chain ?? base.model?.chain ?? [],
    },
    activity: {
      task: String(a.task || "").slice(0, 200),
      minutesManual: Math.max(0, Number(a.minutesManual) || 0),
      frequency: FREQ_PER_MONTH[a.frequency] ? a.frequency : "sob demanda",
      perPeriod: Math.max(0, Number(a.perPeriod) || 1),
    },
    owner: {
      user: String(o.user || "").slice(0, 120),
      email: String(o.email || "").slice(0, 160),
      department: String(o.department || "").slice(0, 120),
      vp: String(o.vp || "").slice(0, 120),
      company: String(o.company || "").slice(0, 120),
    },
    created: base.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

function list() {
  ensure();
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((x, y) => (y.updated || "").localeCompare(x.updated || ""));
}

function get(id) {
  ensure();
  try { return JSON.parse(fs.readFileSync(pathFor(id), "utf8")); } catch { return null; }
}

function save(input) {
  ensure();
  const base = input.id ? get(input.id) || {} : {};
  const agent = normalize(input, base);
  fs.writeFileSync(pathFor(agent.id), JSON.stringify(agent, null, 2), "utf8");
  return agent;
}

function remove(id) {
  ensure();
  try { fs.unlinkSync(pathFor(id)); return true; } catch { return false; }
}

// Potencial mensal de economia (minutos) declarado no mapeamento de atividade.
function monthlyPotentialMinutes(agent) {
  const a = agent.activity || {};
  return (a.minutesManual || 0) * (a.perPeriod || 0) * (FREQ_PER_MONTH[a.frequency] || 0);
}

// ---------------------------------------------------------------
// EXECUÇÕES — cada uso do agente vira uma linha no log (base do ROI)
// ---------------------------------------------------------------
function logRun(agent, { minutesSaved, conversationId, note } = {}) {
  const mins = minutesSaved !== undefined && minutesSaved !== null
    ? Number(minutesSaved)
    : Number(agent.activity?.minutesManual || 0);
  const entry = {
    at: new Date().toISOString(),
    agentId: agent.id,
    agentName: agent.name,
    task: agent.activity?.task || "",
    minutesSaved: Math.max(0, mins),
    owner: agent.owner || {},
    conversationId: conversationId || null,
    note: note || null,
  };
  fs.mkdirSync(path.dirname(RUNS), { recursive: true });
  fs.appendFileSync(RUNS, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

function runs({ since = null } = {}) {
  try {
    return fs
      .readFileSync(RUNS, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter((r) => (since ? r.at >= since : true));
  } catch {
    return [];
  }
}

// Importa runs de outra pessoa (export de outro Prisma), sem duplicar.
function importRuns(list) {
  const existing = new Set(runs().map((r) => r.at + "|" + r.agentId));
  let added = 0;
  fs.mkdirSync(path.dirname(RUNS), { recursive: true });
  for (const r of list || []) {
    const k = r.at + "|" + r.agentId;
    if (!r.at || existing.has(k)) continue;
    fs.appendFileSync(RUNS, JSON.stringify(r) + "\n", "utf8");
    existing.add(k);
    added++;
  }
  return added;
}

// ---------------------------------------------------------------
// IMPORTAR DO CLAUDE — prompt que o usuário cola no agente/Projeto do
// Claude para que ele descreva a SI MESMO no formato do Prisma. A saída
// (JSON) é colada de volta no Prisma, que recria o agente aqui.
// ---------------------------------------------------------------
function claudeExtractionPrompt() {
  return `Preciso replicar você (este agente) em outra plataforma chamada Prisma. Faça uma AUTODESCRIÇÃO COMPLETA e responda APENAS com um bloco de código JSON válido, sem texto antes ou depois.

Leia com atenção suas próprias instruções/configuração e preencha o JSON abaixo descrevendo COMO VOCÊ FUNCIONA — de forma que outro sistema consiga reproduzir seu comportamento com fidelidade.

Regras:
- "role": quem você é (persona, cargo, tom de voz, especialidade) em 2ª pessoa ("Você é...").
- "instructions": TODAS as suas diretrizes operacionais, regras, restrições, formato de saída e critérios de qualidade. Seja EXAUSTIVO — copie o essencial das suas instruções originais, reescrito de forma autocontida. Não resuma demais.
- "playbook": os passos ordenados que você segue ao executar uma tarefa típica (um passo por item).
- "knowledge": blocos de conhecimento fixo que você carrega (definições, políticas, exemplos, terminologia, dados de referência). Cada item com "title" e "content". Se você tem documentos anexados, resuma o conteúdo essencial deles aqui. Se não tiver conhecimento fixo, use [].
- "connectors": marque true no que você realmente precisa: "web" (pesquisar na internet), "office" (gerar planilha/documento/apresentação), "image" (gerar imagens).
- "activity": a atividade humana que você substitui — "task" (nome da atividade), "minutesManual" (quantos MINUTOS um humano levaria para fazer isso manualmente, sua melhor estimativa), "frequency" (um de: diaria, semanal, quinzenal, mensal, sob demanda), "perPeriod" (quantas vezes por período).
- "suggestedName" e "icon": um nome curto e um emoji que te representem.

Formato exato:

\`\`\`json
{
  "schema": "prisma-agent/1",
  "suggestedName": "",
  "icon": "🤖",
  "description": "",
  "role": "",
  "instructions": "",
  "playbook": [],
  "knowledge": [{ "title": "", "content": "" }],
  "connectors": { "web": false, "office": true, "image": false },
  "activity": { "task": "", "minutesManual": 30, "frequency": "sob demanda", "perPeriod": 1 }
}
\`\`\``;
}

// Aceita o JSON devolvido pelo Claude (ou um export do Prisma) e devolve
// um agente normalizado, pronto para salvar.
function fromImport(raw, extra = {}) {
  let obj = raw;
  if (typeof raw === "string") {
    const m = raw.match(/\{[\s\S]*\}/); // tolera ```json ... ``` e texto ao redor
    if (!m) throw new Error("Não encontrei um JSON válido no texto colado.");
    obj = JSON.parse(m[0]);
  }
  if (!obj || typeof obj !== "object") throw new Error("Conteúdo inválido.");
  const input = {
    ...obj,
    id: undefined,                                  // sempre cria novo
    name: obj.name || obj.suggestedName || "Agente importado",
    owner: extra.owner || obj.owner || {},
  };
  return normalize(input, {});
}

module.exports = {
  ensure, list, get, save, remove, normalize, newId,
  logRun, runs, importRuns, monthlyPotentialMinutes,
  claudeExtractionPrompt, fromImport,
  FREQ_PER_MONTH, DIR, RUNS,
};
