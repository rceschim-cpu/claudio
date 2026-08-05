// bench/provedores.js
// Catálogo de provedores para a descoberta e o ranking.
//
// Quase todo mundo hoje expõe a API no formato da OpenAI, então o adaptador
// é o mesmo. Os que fogem (Anthropic, Gemini) ficam marcados e a chamada é
// montada de outro jeito.
//
// `precoM` é USD por MILHÃO de tokens {in, out}, preço de tabela. Free tier
// entra como 0 — mas grátis não é de graça: tem teto diário, e é isso que
// o campo `tetoDia` registra. Os dois entram na conta do ranking.

export const PROVEDORES = {
  groq: {
    rotulo: "Groq",
    env: "GROQ_API_KEY",
    base: "https://api.groq.com/openai/v1",
    estilo: "openai",
    gratis: true,
    tetoDia: "~100k tokens/dia por modelo",
  },
  cerebras: {
    rotulo: "Cerebras",
    env: "CEREBRAS_API_KEY",
    base: "https://api.cerebras.ai/v1",
    estilo: "openai",
    gratis: true,
    tetoDia: "~1M tokens/dia",
  },
  mistral: {
    rotulo: "Mistral",
    env: "MISTRAL_API_KEY",
    base: "https://api.mistral.ai/v1",
    estilo: "openai",
    gratis: true,
    tetoDia: "~1B tokens/mês (tier Experiment)",
  },
  openrouter: {
    rotulo: "OpenRouter",
    env: "OPENROUTER_API_KEY",
    base: "https://openrouter.ai/api/v1",
    estilo: "openai",
    gratis: "parcial", // os modelos com sufixo :free
    tetoDia: "50/dia sem crédito, 1000/dia com US$10",
  },
  nvidia: {
    rotulo: "NVIDIA NIM",
    env: "NVIDIA_API_KEY",
    base: "https://integrate.api.nvidia.com/v1",
    estilo: "openai",
    gratis: true,
    tetoDia: "créditos de avaliação",
  },
  cohere: {
    rotulo: "Cohere",
    env: "COHERE_API_KEY",
    base: "https://api.cohere.com/compatibility/v1",
    estilo: "openai",
    gratis: "trial",
    tetoDia: "1.000 chamadas/mês no trial",
  },
  deepseek: {
    rotulo: "DeepSeek",
    env: "DEEPSEEK_API_KEY",
    base: "https://api.deepseek.com",
    estilo: "openai",
    gratis: false,
    precoM: { in: 0.28, out: 0.42 },
  },
  xai: {
    rotulo: "xAI (Grok)",
    env: "XAI_API_KEY",
    base: "https://api.x.ai/v1",
    estilo: "openai",
    gratis: false,
    precoM: { in: 0.2, out: 0.5 },
  },
  openai: {
    rotulo: "OpenAI",
    env: "OPENAI_API_KEY",
    base: "https://api.openai.com/v1",
    estilo: "openai",
    gratis: false,
    precoM: { in: 0.15, out: 0.6 },
  },
  gemini: {
    rotulo: "Google Gemini",
    env: "GEMINI_API_KEY",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    estilo: "openai", // o Google expõe um endpoint compatível
    gratis: true,
    tetoDia: "generoso no Flash (~1.500 req/dia)",
  },
  anthropic: {
    rotulo: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    base: "https://api.anthropic.com/v1",
    estilo: "anthropic",
    gratis: false,
    precoM: { in: 0.8, out: 4 },
  },
};

export function chaves(env) {
  const out = {};
  for (const [id, p] of Object.entries(PROVEDORES)) {
    const k = env[p.env];
    if (k && k.trim()) out[id] = k.trim();
  }
  return out;
}
