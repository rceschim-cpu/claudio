// worker/src/providers/openai-compat.js
// Fábrica de providers para as APIs no formato da OpenAI.
//
// Quase todo mundo hoje fala esse dialeto: Groq, Mistral, Cerebras, Cohere,
// xAI, DeepSeek, OpenRouter, NVIDIA e até o Google (via endpoint de
// compatibilidade). Um adaptador serve para todos; o que muda é a URL, a
// chave e uns poucos parâmetros por família de modelo.
//
// Ter vários provedores importa por um motivo concreto: o teto do free tier
// é por MODELO e por CONTA. Cinco modelos da Groq compartilham o teto da
// conta Groq; um modelo da Groq e um da Mistral não compartilham nada. Cada
// provedor a mais é um balde novo, não um copo do mesmo balde.

const BASES = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  cohere: "https://api.cohere.com/compatibility/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openai: "https://api.openai.com/v1",
};

// Nome da variável de ambiente com a chave de cada provedor.
export const ENV_CHAVE = {
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  cohere: "COHERE_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};

// Ajustes por família de modelo. Modelo de raciocínio gasta o orçamento de
// SAÍDA pensando e entrega a piada cortada — e cada família aceita um
// vocabulário diferente para desligar isso. Mandar o valor errado devolve
// 400 e derruba o modelo da corrente à toa.
function ajustes(modelo, provedor) {
  if (/gpt-oss/i.test(modelo)) return { reasoning_effort: "low" };
  if (/qwen3|qwq|deepseek-r|magistral/i.test(modelo)) return { reasoning_effort: "none" };
  // O Gemini 2.5+ pensa por padrão e come o max_tokens inteiro: na bancada
  // ele entregou "Puta que pariu, se esse era seu melhor" e parou no meio.
  if (provedor === "gemini") return { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } };
  return {};
}

export function criarProvider(id) {
  const base = BASES[id];
  if (!base) throw new Error(`provedor sem base conhecida: ${id}`);

  return {
    id,
    async chat({ system, messages, modelo, chave, maxTokens, signal }) {
      let res;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelo,
            messages: [{ role: "system", content: system }, ...messages],
            max_tokens: maxTokens,
            temperature: 1.05,
            top_p: 0.95,
            ...ajustes(modelo, id),
          }),
          signal,
        });
      } catch (e) {
        const timeout = e && (e.name === "AbortError" || e.name === "TimeoutError");
        return { ok: false, error: timeout ? "timeout" : "unavailable", detail: String(e && e.message) };
      }

      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        return { ok: false, error: "rate_limited", retryAfter: Number.isFinite(ra) ? ra : undefined };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
      if (res.status === 400 || res.status === 404) return { ok: false, error: "bad_request", detail: await texto(res) };
      if (!res.ok) return { ok: false, error: "unavailable", detail: await texto(res) };

      const d = await res.json().catch(() => null);
      const t = d?.choices?.[0]?.message?.content;
      // Vazio acontece de verdade — o zai-glm e o deepseek devolveram vazio
      // na bancada. Vale como falha, para a corrente seguir em vez de
      // entregar uma bolha em branco.
      if (!t || !t.trim()) return { ok: false, error: "unavailable", detail: "resposta vazia" };

      return {
        ok: true,
        text: t.trim(),
        usage: { in: d?.usage?.prompt_tokens ?? 0, out: d?.usage?.completion_tokens ?? 0 },
      };
    },
  };
}

async function texto(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ""; }
}
