// worker/src/providers/groq.js
// Adaptador da Groq (API compatível com OpenAI).
//
// Implementa a interface de provider definida em ./index.js. Nada específico
// da Groq vaza daqui para fora — plugar a xAI depois é escrever um arquivo
// irmão com o mesmo formato e registrá-lo, sem tocar no resto.

/** @typedef {{role:"user"|"assistant", content:string}} Turn */

// Modelos de raciocínio gastam o orçamento de SAÍDA pensando, e a piada sai
// cortada no meio. Cada família aceita um vocabulário diferente para baixar
// isso: mandar o valor errado devolve 400 e derruba o modelo da corrente à
// toa (o qwen3 rejeita "low" e só aceita "none"/"default").
function esforcoDeRaciocinio(modelId) {
  if (/gpt-oss/i.test(modelId)) return { reasoning_effort: "low" };
  if (/qwen3|qwq|deepseek-r/i.test(modelId)) return { reasoning_effort: "none" };
  return {};
}

export const groq = {
  id: "groq",
  label: "Groq",

  /**
   * Percorre a corrente de modelos até um responder.
   *
   * A corrente existe porque o teto do free tier da Groq é POR MODELO, não
   * por conta: quando o llama-3.3 esgota a cota do dia, os outros continuam
   * inteiros. Com um modelo só, o produto morria no meio da tarde.
   *
   * @returns {Promise<{
   *   ok: boolean, text?: string, model?: string, usedFallback?: boolean,
   *   tentativas?: number, usage?: {in:number,out:number},
   *   error?: "rate_limited"|"unauthorized"|"unavailable"|"bad_request"|"timeout",
   *   retryAfter?: number, detail?: string
   * }>}
   */
  async chat({ system, messages, config, signal }) {
    const { apiKey, baseUrl, models } = config.provider;
    if (!apiKey) return { ok: false, error: "unauthorized", detail: "GROQ_API_KEY ausente" };
    if (!models.length) return { ok: false, error: "bad_request", detail: "nenhum modelo configurado" };

    const attempt = async (modelId) => {
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "system", content: system }, ...messages],
            max_tokens: config.maxTokens,
            ...esforcoDeRaciocinio(modelId),
            // Temperatura alta de propósito: o produto é humor, e resposta
            // previsível não é engraçada duas vezes.
            temperature: 1.05,
            top_p: 0.95,
            presence_penalty: 0.4,
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
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "unauthorized", detail: await safeText(res) };
      }
      if (res.status === 400 || res.status === 404) {
        // Modelo desativado, renomeado ou com parâmetro que ele não aceita.
        return { ok: false, error: "bad_request", detail: await safeText(res) };
      }
      if (!res.ok) {
        return { ok: false, error: "unavailable", detail: await safeText(res) };
      }

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content;
      // Resposta vazia acontece de verdade (o gpt-oss-20b devolveu vazio num
      // teste). Vale como falha, para a corrente seguir em vez de entregar
      // uma bolha em branco.
      if (!text || !text.trim()) {
        return { ok: false, error: "unavailable", detail: "resposta vazia" };
      }
      return {
        ok: true,
        text: text.trim(),
        model: modelId,
        usage: {
          in: data?.usage?.prompt_tokens ?? 0,
          out: data?.usage?.completion_tokens ?? 0,
        },
      };
    };

    let ultimoRate = null;
    let ultimo = null;

    for (let i = 0; i < models.length; i++) {
      const r = await attempt(models[i]);
      if (r.ok) return { ...r, usedFallback: i > 0, tentativas: i + 1 };

      // 401 é credencial: os outros modelos vão falhar igual, não insista.
      if (r.error === "unauthorized") return r;

      if (r.error === "rate_limited") ultimoRate = r;
      ultimo = r;
    }

    // Corrente inteira caída. Se algum foi 429, essa é a explicação honesta
    // e é o que vira a mensagem de cota em personagem.
    return ultimoRate || ultimo || { ok: false, error: "unavailable" };
  },
};

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}
