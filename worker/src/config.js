// worker/src/config.js
// Toda variável de ambiente é lida AQUI, uma vez, com default e coerção.
// Nenhum outro módulo toca em `env` diretamente — assim o orçamento do free
// tier fica num lugar só, que é onde ele precisa estar para ser respeitado.

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Corrente padrão. Saiu da bancada (`node bench/ranking.js`), não de palpite
// — já erramos isso uma vez pondo um 8B em segundo lugar por causa de uma
// amostra que depois se revelou copiada de um exemplo do prompt.
//
// A ordem ALTERNA PROVEDOR de propósito. O teto do free tier é por conta:
// enfileirar cinco modelos da Groq esgota a Groq inteira e para tudo;
// alternar Groq → Mistral → Groq → Cohere estica o dia várias vezes.
//
// Notas da bancada de 23 modelos:
//   · grok-4.5 tirou a melhor nota (100) e ficou de FORA: 26 segundos por
//     resposta. Num brinquedo de chat isso é pior que resposta mediana.
//   · grok-4.20-non-reasoning tirou 88 em 1 segundo, é o melhor pago, e
//     entra no fim — só funciona se houver XAI_API_KEY.
//   · gemini-2.5-flash pontuou bem mas vinha truncando ("Puta que pariu, se
//     esse era seu melhor" e parava). O modelo pensa por padrão e come o
//     max_tokens; corrigido no adaptador.
//   · ministral-8b (32) e zai-glm (vazio) ficaram de fora.
const CORRENTE_PADRAO = [
  "groq:llama-3.3-70b-versatile",
  "mistral:mistral-large-latest",
  "groq:openai/gpt-oss-120b",
  "cohere:command-a-03-2025",
  "mistral:mistral-small-latest",
  "groq:openai/gpt-oss-20b",
  "gemini:gemini-2.5-flash",
  "groq:qwen/qwen3.6-27b",
  "mistral:mistral-medium-2508",
  "cerebras:gpt-oss-120b",
  "xai:grok-4.20-0309-non-reasoning",
];

// "provedor:modelo" -> { provedor, modelo }.
// Sem prefixo assume groq, para não quebrar configuração antiga.
function parseElo(s) {
  const i = s.indexOf(":");
  if (i < 0) return { provedor: "groq", modelo: s };
  return { provedor: s.slice(0, i).trim(), modelo: s.slice(i + 1).trim() };
}

const dedup = (arr) => [...new Set(arr)];

function corrente(env) {
  // CLAUDIO_CORRENTE é a forma nova. GROQ_MODELS e GROQ_MODEL continuam
  // valendo para não quebrar quem já tinha configurado assim.
  const nova = list(env.CLAUDIO_CORRENTE);
  if (nova.length) return dedup(nova);

  const antiga = list(env.GROQ_MODELS);
  if (antiga.length) return dedup(antiga);

  const legado = [env.GROQ_MODEL, env.GROQ_MODEL_FALLBACK].filter(Boolean);
  if (legado.length) return dedup([...legado, ...CORRENTE_PADRAO]);

  return CORRENTE_PADRAO.slice();
}

export function readConfig(env) {
  const eloTexto = corrente(env);

  return {
    // ---- providers --------------------------------------------------
    provider: {
      corrente: eloTexto.map(parseElo),
      texto: eloTexto,
    },

    // ---- orçamento --------------------------------------------------
    // O gargalo real do free tier não é requisição por dia e sim TOKEN por
    // dia (~100k por modelo na Groq). Com ~1.400 tokens de prompt por
    // chamada, cada modelo aguenta ~70 mensagens/dia. A corrente
    // multi-provedor multiplica isso, mas o orçamento local segue
    // conservador de propósito.
    maxTokens: num(env.CLAUDIO_MAX_TOKENS, 220),
    dailyBudget: num(env.CLAUDIO_DAILY_BUDGET, 320),
    rpmBudget: num(env.CLAUDIO_RPM_BUDGET, 24),
    tpmBudget: num(env.CLAUDIO_TPM_BUDGET, 10000),
    ipPerMin: num(env.CLAUDIO_IP_PER_MIN, 4),
    ipPerDay: num(env.CLAUDIO_IP_PER_DAY, 40),
    sessionPerDay: num(env.CLAUDIO_SESSION_PER_DAY, 60),
    historyTurns: num(env.CLAUDIO_HISTORY_TURNS, 6),

    // ---- operação ---------------------------------------------------
    killSwitch: String(env.CLAUDIO_KILL_SWITCH || "off").toLowerCase() !== "off",
    allowedOrigins: list(env.ALLOWED_ORIGINS),
  };
}

// Estimativa grosseira de tokens para texto em português.
// ~3,6 caracteres por token é conservador o bastante para o orçamento de TPM;
// o número exato vem depois, do `usage` que a API devolve.
export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 3.6);
}
