// lib/router.js
// Roteamento autônomo: classifica a tarefa + considera a saúde do provedor
// para montar a cadeia (principal + fallbacks) usando SOMENTE modelos grátis.
//
// Duas dimensões:
//   1. Tarefa  → qual modelo grátis é melhor para o tipo de pedido.
//   2. Saúde   → provedores que falharam recentemente caem para o fim da fila
//                (cooldown), evitando insistir em quem está fora do ar/sem cota.

const fs = require("fs");
const path = require("path");

const HEALTH_FILE = path.join(__dirname, "..", "data", "health.json");
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min de penalidade após falha "dura"

// ---------------------------------------------------------------
// Classificação de tarefa (heurística determinística, sem custo de LLM)
// ---------------------------------------------------------------
const CATEGORIES = ["image_gen", "code", "vision", "reasoning", "fast"];

// Texto curto que explica POR QUE aquela categoria/modelo foi escolhido.
const CATEGORY_REASON = {
  image_gen: "geração de imagem — usei modelo de imagem grátis",
  code: "tarefa de código — priorizei modelo forte em programação",
  vision: "imagem no contexto — priorizei modelo com visão",
  reasoning: "demanda analítica — priorizei contexto longo e raciocínio",
  fast: "demanda simples — priorizei velocidade",
};

function classify(text, { hasImage = false } = {}) {
  const t = String(text || "").toLowerCase();

  // Geração de imagem: SÓ quando é claramente o entregável.
  // Conservador de propósito — falsos positivos (ex.: "cria um PDF... é foto/vídeo")
  // mandavam pedidos de análise para o gerador de imagem. Por isso:
  //  (a) exige um verbo de geração colado a um substantivo de imagem;
  //  (b) desiste se houver QUALQUER outro entregável/ação (pdf, arquivo, código…);
  //  (c) só vale para mensagens curtas (prompts de imagem costumam ser curtos).
  // Para o caso explícito, o usuário tem o botão 🎨 (forceImage), que ignora isto.
  const outroEntregavel = /\b(pdf|csv|xlsx?|excel|planilha|documento|relat[óo]rio|c[óo]digo|script|programa|arquivos?|pastas?|diret[óo]rio|ranking|lista|liste|tabela|duplicad|backup|analis|verific|organiz|renomei|mov[ae]|delet|exclui|apag|baix|download)\b/;
  const gerarImagem = /\b(ger(?:e|ar)|cri(?:e|ar)|desenh(?:e|ar)|ilustr(?:e|ar)|fa[çc]a|me\s+d[êe])\b[^.!?\n]{0,40}?\b(imagem|imagens|figura|ilustra[çc][ãa]o|desenho|logo|logotipo|[íi]cone|wallpaper|banner|arte|pintura|avatar|capa|poster|p[ôo]ster)\b/;
  if (!outroEntregavel.test(t) && gerarImagem.test(t) && t.length < 240) {
    return "image_gen";
  }

  if (hasImage || /\b(analis.*imagem|descreva.*imagem|o que há na imagem|screenshot|print)\b/.test(t)) {
    return "vision";
  }

  const codeSignals =
    /```|\b(função|funcao|function|classe|class|bug|erro de|stack trace|refator|compil|npm|pip|docker|sql|regex|api|endpoint|código|codigo|script|python|javascript|typescript|java|rust|golang|css|html)\b/;
  if (codeSignals.test(t)) return "code";

  const reasoningSignals =
    /\b(analis|compare|estratégia|estrategia|explique por que|prove|demonstre|passo a passo|raciocine|planeje|arquitetura|trade-?off|justifique|matematic|teorema|otimiz)\b/;
  if (reasoningSignals.test(t) || t.length > 1200) return "reasoning";

  return "fast";
}

// ---------------------------------------------------------------
// Pool de modelos grátis a partir do catálogo (já com overrides aplicados)
// ---------------------------------------------------------------
function buildFreePool(catalog, hasKeyFn) {
  const pool = [];
  for (const [providerId, provider] of Object.entries(catalog)) {
    if (hasKeyFn && !hasKeyFn(providerId)) continue; // sem chave → fora
    for (const model of provider.models || []) {
      const isFree = model.input === 0 && model.output === 0;
      if (!isFree) continue;
      pool.push({
        provider: providerId,
        providerLabel: provider.label,
        color: provider.color,
        modelId: model.id,
        name: model.name,
        released: model.released || "2000-01-01",
        outputs: model.outputs || [],
        context: model.context || "",
        tier: model.tier || "",
      });
    }
  }
  return pool;
}

// Pontuação de aptidão de um modelo para uma categoria.
function scoreForCategory(model, category) {
  const id = (model.modelId + " " + model.name).toLowerCase();
  const outputs = model.outputs.map((o) => o.toLowerCase());
  let score = 0;

  const handlesCode = outputs.some((o) => o.includes("código") || o.includes("codigo"));
  const handlesImage = outputs.some((o) => o.includes("imagem"));
  const fastProvider = ["groq", "cerebras"].includes(model.provider);
  const strongCode = /codestral|gpt-oss|deepseek|glm|qwen|coder/.test(id);
  const bigContext = /\d+\s*m/i.test(model.context); // "1M", "2M"

  if (category === "code") {
    if (handlesCode) score += 3;
    if (strongCode) score += 3;
  } else if (category === "vision") {
    if (handlesImage) score += 6;
    else score -= 5; // sem visão, péssimo para a tarefa
  } else if (category === "reasoning") {
    if (bigContext) score += 2;
    if (/maverick|glm|deepseek|medium|gpt-oss-120b|kimi/.test(id)) score += 2;
  } else if (category === "fast") {
    if (fastProvider) score += 3;
  }

  // recência: modelos mais novos ganham um leve empurrão (prioriza novidade)
  const year = parseInt((model.released || "2000").slice(0, 4), 10) || 2000;
  score += Math.max(0, year - 2024) * 0.5;

  return score;
}

// ---------------------------------------------------------------
// Saúde do provedor
// ---------------------------------------------------------------
function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveHealth(h) {
  fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(h, null, 2), "utf8");
}

function recordSuccess(provider) {
  const h = loadHealth();
  h[provider] = { status: "ok", lastSuccess: Date.now(), cooldownUntil: 0, fails: 0 };
  saveHealth(h);
}

// errorMessage usado para decidir gravidade: 429/403/401 → cooldown.
function recordFailure(provider, errorMessage = "") {
  const h = loadHealth();
  const prev = h[provider] || { fails: 0 };
  const hard = /\b(401|403|429|503)\b/.test(errorMessage);
  h[provider] = {
    status: "fail",
    lastError: String(errorMessage).slice(0, 300),
    lastFail: Date.now(),
    fails: (prev.fails || 0) + 1,
    cooldownUntil: hard ? Date.now() + COOLDOWN_MS : prev.cooldownUntil || 0,
  };
  saveHealth(h);
}

function isInCooldown(provider) {
  const h = loadHealth();
  const rec = h[provider];
  return Boolean(rec && rec.cooldownUntil && rec.cooldownUntil > Date.now());
}

function healthSnapshot() {
  const h = loadHealth();
  const out = {};
  for (const [p, rec] of Object.entries(h)) {
    out[p] = {
      status: rec.cooldownUntil > Date.now() ? "cooldown" : rec.status || "unknown",
      cooldownRemainingMs: Math.max(0, (rec.cooldownUntil || 0) - Date.now()),
      lastError: rec.lastError || null,
      fails: rec.fails || 0,
    };
  }
  return out;
}

// ---------------------------------------------------------------
// Montagem da cadeia automática
// Ordena o pool por (saúde, aptidão à tarefa, recência) e diversifica
// provedores nos primeiros elos para um fallback mais resiliente.
// ---------------------------------------------------------------
function pickAutoChain(catalog, hasKeyFn, text, opts = {}) {
  const category = classify(text, opts);
  const pool = buildFreePool(catalog, hasKeyFn);

  const ranked = pool
    .map((m) => ({
      ...m,
      _fit: scoreForCategory(m, category),
      _cooldown: isInCooldown(m.provider),
    }))
    // visão: descarta quem não tem visão quando a tarefa é visual
    .filter((m) => !(category === "vision" && m._fit < 0))
    .sort((a, b) => {
      if (a._cooldown !== b._cooldown) return a._cooldown ? 1 : -1; // saudável primeiro
      if (b._fit !== a._fit) return b._fit - a._fit; // melhor aptidão
      return (b.released || "").localeCompare(a.released || ""); // mais novo
    });

  // Diversifica provedores: pega o melhor de cada provedor primeiro,
  // depois completa com os demais. Limita a 4 elos.
  const chain = [];
  const usedProviders = new Set();
  for (const m of ranked) {
    if (usedProviders.has(m.provider)) continue;
    chain.push(m);
    usedProviders.add(m.provider);
    if (chain.length >= 4) break;
  }
  for (const m of ranked) {
    if (chain.length >= 4) break;
    if (!chain.includes(m)) chain.push(m);
  }

  // monta a justificativa, mencionando se houve provedor em cooldown evitado
  let reason = CATEGORY_REASON[category] || category;
  const skipped = pool.filter((m) => isInCooldown(m.provider));
  if (skipped.length) reason += " · evitei provedor(es) em cooldown";

  return { category, reason, chain: chain.map(stripInternal) };
}

function stripInternal(m) {
  const { _fit, _cooldown, ...rest } = m;
  return rest;
}

module.exports = {
  CATEGORIES,
  CATEGORY_REASON,
  classify,
  buildFreePool,
  pickAutoChain,
  recordSuccess,
  recordFailure,
  isInCooldown,
  healthSnapshot,
};
