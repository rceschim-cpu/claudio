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

export function readConfig(env) {
  return {
    // ---- provider -------------------------------------------------
    provider: {
      id: "groq",
      apiKey: env.GROQ_API_KEY || "",
      baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      fallbackModel: env.GROQ_MODEL_FALLBACK || "openai/gpt-oss-120b",
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
