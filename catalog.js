// catalog.js
// Catálogo de provedores e modelos disponíveis.
// Preços em USD por 1.000.000 de tokens (entrada / saída).
// Dados levantados via busca em jun/2026 — confira sempre o site oficial
// do provedor antes de assumir compromissos de custo em produção.
// Modelos ordenados do mais recente para o mais antigo dentro de cada provedor.

const CATALOG = {
  anthropic: {
    label: "Anthropic",
    color: "#d97757",
    envKey: "ANTHROPIC_API_KEY",
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: [
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        released: "2026-04-16",
        tier: "mais avançado",
        input: 5.0,
        output: 25.0,
        context: "1M",
        outputs: ["texto", "código"],
        notes: "Modelo mais capaz da Anthropic para raciocínio longo e agentes."
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        released: "2026-02-17",
        tier: "equilibrado",
        input: 3.0,
        output: 15.0,
        context: "1M",
        outputs: ["texto", "código"],
        notes: "Bom equilíbrio entre custo e qualidade para uso geral."
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        released: "2025-10-15",
        tier: "mais barato",
        input: 1.0,
        output: 5.0,
        context: "200K",
        outputs: ["texto", "código"],
        notes: "Mais rápido e mais barato da Anthropic. Ótimo para fallback."
      }
    ]
  },

  openai: {
    label: "OpenAI",
    color: "#74aa9c",
    envKey: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/api-keys",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        released: "2026-04-23",
        tier: "mais avançado",
        input: 5.0,
        output: 30.0,
        context: "1M",
        outputs: ["texto", "imagem (input)", "código"],
        notes: "Modelo flagship da OpenAI para raciocínio complexo e coding."
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        released: "2026-03-17",
        tier: "equilibrado",
        input: 0.75,
        output: 4.50,
        context: "400K",
        outputs: ["texto", "código"],
        notes: "Bom custo-benefício para chat de produção."
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        released: "2026-03-17",
        tier: "mais barato",
        input: 0.20,
        output: 1.25,
        context: "400K",
        outputs: ["texto", "código"],
        notes: "Opção mais barata da OpenAI. Ideal para classificação e tarefas simples."
      }
    ]
  },

  gemini: {
    label: "Google Gemini",
    color: "#4796e3",
    envKey: "GEMINI_API_KEY",
    docsUrl: "https://aistudio.google.com/apikey",
    models: [
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        released: "2026-05-19",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "1M",
        outputs: ["texto", "imagem (input)", "áudio (input)"],
        notes: "Free tier sem cartão de crédito via Google AI Studio. Supera o Gemini 3 Flash em qualidade, dentro da mesma cota gratuita. Acima do free tier, $0,50/$3,50 por 1M tokens."
      },
      {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        released: "2026-04-01",
        tier: "mais avançado (pago)",
        input: 2.0,
        output: 12.0,
        context: "2M",
        outputs: ["texto", "imagem (input)", "áudio (input)", "vídeo (input)"],
        notes: "Flagship do Google, contexto de até 2M tokens. Sem free tier — exige conta paga desde abr/2026."
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash-Lite",
        released: "2026-03-03",
        tier: "grátis (free tier, cota menor)",
        input: 0,
        output: 0,
        context: "1M",
        outputs: ["texto", "imagem (input)", "áudio (input)"],
        notes: "Free tier via Google AI Studio com cota menor que o 3.5 Flash. Acima da cota, $0,10/$0,40 por 1M tokens — um dos mais baratos do mercado."
      }
    ]
  },

  groq: {
    label: "Groq (Llama / open-source)",
    color: "#f55036",
    envKey: "GROQ_API_KEY",
    docsUrl: "https://console.groq.com/keys",
    models: [
      {
        id: "moonshotai/kimi-k2-instruct",
        name: "Kimi K2 (via Groq)",
        released: "2025-11-01",
        tier: "mais avançado (pago)",
        input: 1.0,
        output: 3.0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Modelo mais robusto disponível no Groq, focado em uso agentic. Fora do free tier."
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B (via Groq)",
        released: "2025-08-05",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Free tier no Groq: ~30 req/min. Mesmo modelo disponível na Cerebras — boa opção de fallback cruzado. Inferência em hardware LPU da Groq (500+ tokens/s)."
      }
    ]
  },

  cerebras: {
    label: "Cerebras",
    color: "#f5821f",
    envKey: "CEREBRAS_API_KEY",
    docsUrl: "https://cloud.cerebras.ai",
    knownIssue: "O catálogo gratuito da Cerebras é instável: o número de modelos disponíveis caiu de uma dúzia para apenas 2 (gpt-oss-120b e zai-glm-4.7) sem aviso prévio (caso registrado em 31/05/2026). Se um modelo falhar com 404, confira o catálogo atual em cloud.cerebras.ai antes de assumir que é problema da sua chave.",
    models: [
      {
        id: "zai-glm-4.7",
        name: "ZAI GLM-4.7",
        released: "2026-05-01",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Free tier da Cerebras: 1.000.000 tokens/dia, 30 req/min. Modelo estável no catálogo desde mai/2026 mesmo após a redução de oferta."
      },
      {
        id: "gpt-oss-120b",
        name: "GPT-OSS 120B (via Cerebras)",
        released: "2025-08-05",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Free tier: 1.000.000 tokens/dia, ~2.600 tokens/s em chip wafer-scale. Mesmo modelo disponível no Groq — bom fallback cruzado entre os dois provedores."
      }
    ]
  },

  mistral: {
    label: "Mistral AI",
    color: "#fa520f",
    envKey: "MISTRAL_API_KEY",
    docsUrl: "https://console.mistral.ai/api-keys",
    models: [
      {
        id: "mistral-medium-3.5",
        name: "Mistral Medium 3.5",
        released: "2026-04-29",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Coberto pelo tier Experiment gratuito da Mistral (exige verificação de telefone). Qualidade superior ao Small 4 para tarefas mais elaboradas."
      },
      {
        id: "mistral-small-4",
        name: "Mistral Small 4",
        released: "2026-03-16",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "256K",
        outputs: ["texto", "código"],
        notes: "Tier Experiment gratuito: ~1 requisição/segundo, até 1 bilhão de tokens/mês. Acima disso, $0,10/$0,30 por 1M tokens aprox."
      },
      {
        id: "codestral-latest",
        name: "Codestral",
        released: "2025-05-29",
        tier: "grátis (free tier)",
        input: 0,
        output: 0,
        context: "256K",
        outputs: ["código"],
        notes: "Modelo especializado em código, também dentro do tier gratuito. Bom fallback se sua cadeia for voltada a programação."
      }
    ]
  },

  nvidia: {
    label: "NVIDIA NIM",
    color: "#76b900",
    envKey: "NVIDIA_API_KEY",
    docsUrl: "https://build.nvidia.com",
    knownIssue: "Desde mar/2026, muitas contas \"Personal\" novas recebem chave nvapi- válida mas sem a permissão \"Public API Endpoints\" habilitada — toda chamada retorna 403 \"Authorization failed\" (às vezes 404), mesmo com a chave correta. Não há solução self-service no momento. Abra tópico em forums.developer.nvidia.com (categoria Access/Accounts) pedindo habilitação manual, e use outro provedor como fallback até lá.",
    models: [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        released: "2025-04-05",
        tier: "grátis (catálogo NIM)",
        input: 0,
        output: 0,
        context: "1M",
        outputs: ["texto", "imagem (input)", "código"],
        notes: "Gratuito no catálogo hospedado da NVIDIA (limite de ~40 req/min). Sem cartão de crédito."
      },
      {
        id: "deepseek-ai/deepseek-v3.2",
        name: "DeepSeek 3.2",
        released: "2025-04-01",
        tier: "grátis (catálogo NIM)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Gratuito no catálogo NIM, forte em código e raciocínio."
      },
      {
        id: "meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B Instruct",
        released: "2024-07-23",
        tier: "grátis (catálogo NIM)",
        input: 0,
        output: 0,
        context: "128K",
        outputs: ["texto", "código"],
        notes: "Gratuito no catálogo NIM. ID clássico e estável — bom como último elo de fallback, já que o catálogo NIM troca modelos recentes com pouco aviso."
      }
    ]
  },

  openrouter: {
    label: "OpenRouter (agregador)",
    color: "#8b5cf6",
    envKey: "OPENROUTER_API_KEY",
    docsUrl: "https://openrouter.ai/keys",
    models: [
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6 (via OpenRouter)",
        released: "2026-02-17",
        tier: "avançado",
        input: 3.0,
        output: 15.0,
        context: "1M",
        outputs: ["texto", "código"],
        notes: "Acesso a Claude sem precisar de conta direta na Anthropic."
      },
      {
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash (via OpenRouter)",
        released: "2026-05-19",
        tier: "mais barato",
        input: 0.10,
        output: 0.40,
        context: "1M",
        outputs: ["texto", "imagem (input)"],
        notes: "Mesmo modelo do Google, roteado pelo OpenRouter com leve markup."
      },
      {
        id: "meta-llama/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B Instruct",
        released: "2024-07-23",
        tier: "mais barato",
        input: 0.02,
        output: 0.03,
        context: "128K",
        outputs: ["texto"],
        notes: "A variante \":free\" deste modelo foi descontinuada pelo OpenRouter; este é o slug pago atual, ainda assim muito barato. Confira openrouter.ai/models?order=pricing-low-to-high para opções :free vivas no momento."
      }
    ]
  }
};

module.exports = { CATALOG };
