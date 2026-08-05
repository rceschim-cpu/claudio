// bench/candidatos.js
// Triagem: 738 modelos disponíveis nas 11 contas, ~25 que fazem sentido testar.
//
// Critério de corte: precisa ser de texto, de conversa, e plausível em
// português. Fora embedding, rerank, áudio, imagem, tradução e código.
// Modelo de raciocínio entra quando dá para baixar o esforço — senão ele
// gasta o orçamento de saída pensando e entrega a piada cortada.

export const CANDIDATOS = [
  // ---- Groq (grátis, teto por modelo) ----
  { prov: "groq", modelo: "llama-3.3-70b-versatile" },
  { prov: "groq", modelo: "openai/gpt-oss-120b" },
  { prov: "groq", modelo: "qwen/qwen3.6-27b" },
  { prov: "groq", modelo: "openai/gpt-oss-20b" },
  { prov: "groq", modelo: "llama-3.1-8b-instant" },

  // ---- Cerebras (grátis, cota separada e generosa) ----
  { prov: "cerebras", modelo: "zai-glm-4.7" },
  { prov: "cerebras", modelo: "gpt-oss-120b" },
  { prov: "cerebras", modelo: "gemma-4-31b" },

  // ---- Mistral (free tier alto, e é o menos pudico dos grátis) ----
  { prov: "mistral", modelo: "mistral-large-latest" },
  { prov: "mistral", modelo: "mistral-medium-2508" },
  { prov: "mistral", modelo: "mistral-small-latest" },
  { prov: "mistral", modelo: "ministral-8b-latest" },

  // ---- Google (free tier generoso no Flash) ----
  { prov: "gemini", modelo: "gemini-2.5-flash", pausa: 1500 },
  { prov: "gemini", modelo: "gemini-2.0-flash", pausa: 1500 },
  { prov: "gemini", modelo: "gemini-3-flash-preview", pausa: 1500 },

  // ---- OpenRouter (os :free são de graça de verdade) ----
  { prov: "openrouter", modelo: "meta-llama/llama-3.3-70b-instruct:free", pausa: 1500 },
  { prov: "openrouter", modelo: "deepseek/deepseek-chat-v3-0324:free", pausa: 1500 },

  // ---- NVIDIA (créditos de avaliação) ----
  { prov: "nvidia", modelo: "meta/llama-3.3-70b-instruct", pausa: 1200 },

  // ---- Cohere (trial) ----
  { prov: "cohere", modelo: "command-a-03-2025", pausa: 1200 },

  // ---- Pagos: entram para comparação, e o preço pesa no índice ----
  { prov: "xai", modelo: "grok-4.5" },
  { prov: "xai", modelo: "grok-4.20-0309-non-reasoning" },
  { prov: "deepseek", modelo: "deepseek-v4-flash" },
  { prov: "openai", modelo: "gpt-4o-mini" },

  // Anthropic fica FORA da lista de propósito. Ver nota no README: usar a
  // API da Anthropic para mover um produto que parodia justamente esse tipo
  // de assistente é o único item aqui com risco de termos de uso, e o
  // ganho não compensa — há grátis de sobra com nota parecida.
];
