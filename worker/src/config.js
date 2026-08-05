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

// Corrente padrão, ordenada por QUALIDADE DE RESPOSTA medida, não por
// palpite. A ordem anterior punha o 8b em segundo por causa de uma amostra
// boa — que depois se revelou copiada palavra por palavra de um exemplo do
// prompt. Modelo pequeno entrega português quebrado e pergunta retórica no
// lugar da piada, e resposta ruim num produto de humor é pior que resposta
// nenhuma.
const CORRENTE_PADRAO = [
  "llama-3.3-70b-versatile", // melhor voz, solto no palavrão
  "openai/gpt-oss-120b",     // escreve bem e xinga quando mandado
  "qwen/qwen3.6-27b",        // surpreendeu: referência brasileira e timing
  "openai/gpt-oss-20b",      // já trunca e divaga
  "llama-3.1-8b-instant",    // último recurso: barato, disponível, fraco
];

function modelos(env) {
  // GROQ_MODELS é a forma nova. GROQ_MODEL/GROQ_MODEL_FALLBACK continuam
  // valendo para não quebrar quem já tinha configurado assim.
  const lista = list(env.GROQ_MODELS);
  if (lista.length) return dedup(lista);

  const antigos = [env.GROQ_MODEL, env.GROQ_MODEL_FALLBACK].filter(Boolean);
  if (antigos.length) return dedup([...antigos, ...CORRENTE_PADRAO]);

  return CORRENTE_PADRAO.slice();
}

const dedup = (arr) => [...new Set(arr)];

export function readConfig(env) {
  return {
    // ---- provider -------------------------------------------------
    provider: {
      id: "groq",
      apiKey: env.GROQ_API_KEY || "",
      baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      // Corrente de modelos, em ordem de preferência. O teto do free tier da
      // Groq é POR MODELO: quando o primeiro esgota a cota do dia, o
      // seguinte ainda está inteiro. Com um modelo só, o produto morria no
      // meio da tarde — foi o que aconteceu na bancada.
      //
      // A ordem é por VOZ, não por tamanho: num produto de humor, o modelo
      // que aceita ser grosseiro em português vale mais que o modelo maior.
      models: modelos(env),
    },

    // ---- orçamento ------------------------------------------------
    // Tetos reais do free tier da Groq: 30 rpm · 1.000 req/dia · 12k tpm.
    // Tudo abaixo fica com margem de propósito: estourar o teto do provider
    // devolve 429 pra Groq inteira, não só pra este usuário.
    maxTokens: num(env.CLAUDIO_MAX_TOKENS, 220),
    dailyBudget: num(env.CLAUDIO_DAILY_BUDGET, 850),
    rpmBudget: num(env.CLAUDIO_RPM_BUDGET, 24),
    tpmBudget: num(env.CLAUDIO_TPM_BUDGET, 10000),
    ipPerMin: num(env.CLAUDIO_IP_PER_MIN, 4),
    ipPerDay: num(env.CLAUDIO_IP_PER_DAY, 40),
    sessionPerDay: num(env.CLAUDIO_SESSION_PER_DAY, 60),
    historyTurns: num(env.CLAUDIO_HISTORY_TURNS, 6),

    // ---- operação -------------------------------------------------
    killSwitch: String(env.CLAUDIO_KILL_SWITCH || "off").toLowerCase() !== "off",
    allowedOrigins: list(env.ALLOWED_ORIGINS),
  };
}

// Estimativa grosseira de tokens para texto em português.
// ~3,6 caracteres por token é conservador o bastante para o orçamento de TPM;
// o número exato vem depois, do `usage` que a Groq devolve.
export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 3.6);
}
