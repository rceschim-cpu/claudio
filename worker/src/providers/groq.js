// worker/src/providers/groq.js
// Adaptador da Groq (API compatível com OpenAI).
//
// Implementa a interface de provider definida em ./index.js. Nada específico
// da Groq vaza daqui para fora — plugar a xAI depois é escrever um arquivo
// irmão com o mesmo formato e registrá-lo, sem tocar no resto.

/** @typedef {{role:"user"|"assistant", content:string}} Turn */

export const groq = {
  id: "groq",
  label: "Groq",

  /**
   * @returns {Promise<{
   *   ok: boolean, text?: string, model?: string, usedFallback?: boolean,
   *   usage?: {in:number,out:number},
   *   error?: "rate_limited"|"unauthorized"|"unavailable"|"bad_request"|"timeout",
   *   retryAfter?: number, detail?: string
   * }>}
   */
  async chat({ system, messages, config, signal }) {
    const { apiKey, baseUrl, model, fallbackModel } = config.provider;
    if (!apiKey) return { ok: false, error: "unauthorized", detail: "GROQ_API_KEY ausente" };

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
            // gpt-oss é modelo de raciocínio: os tokens de reasoning saem do
            // MESMO orçamento de saída. Sem isto ele gasta os 220 pensando e
            // a piada sai cortada no meio — 30 de 30 respostas truncadas na
            // bancada. A piada não precisa de raciocínio; precisa de timing.
            ...(/gpt-oss|reasoning|qwq|deepseek-r/i.test(modelId) ? { reasoning_effort: "low" } : {}),
            // Temperatura alta de propósito: o produto é humor, e resposta
            // previsível não é engraçada duas vezes.
            temperature: 1.0,
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
        return {
          ok: false,
          error: "rate_limited",
          retryAfter: Number.isFinite(ra) ? ra : undefined,
          detail: await safeText(res),
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "unauthorized", detail: await safeText(res) };
      }
      if (res.status === 400 || res.status === 404) {
        // Modelo desativado/renomeado cai aqui — vale tentar o fallback.
        return { ok: false, error: "bad_request", detail: await safeText(res) };
      }
      if (!res.ok) {
        return { ok: false, error: "unavailable", detail: await safeText(res) };
      }

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content;
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

    const primary = await attempt(model);
    if (primary.ok) return { ...primary, usedFallback: false };

    // 429 e 401 não melhoram trocando de modelo — são da conta, não do modelo.
    if (primary.error === "rate_limited" || primary.error === "unauthorized") return primary;
    if (!fallbackModel || fallbackModel === model) return primary;

    const backup = await attempt(fallbackModel);
    return backup.ok ? { ...backup, usedFallback: true } : primary;
  },
};

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}
