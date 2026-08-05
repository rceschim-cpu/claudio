// worker/src/providers/index.js
// A corrente. Percorre `provedor:modelo` até alguém responder.
//
// Por que multi-provedor e não só multi-modelo: o teto do free tier é por
// MODELO e por CONTA. Cinco modelos da Groq dividem o teto da conta Groq;
// um modelo da Groq e um da Mistral não dividem nada. Cada provedor a mais
// é um balde novo, não outro copo do mesmo balde.
//
// A ordem sai da bancada (`node bench/ranking.js`), não de palpite. Já
// erramos isso uma vez: um modelo de 8B ficou em segundo lugar por causa
// de uma amostra que depois se revelou copiada de um exemplo do prompt.

import { criarProvider, ENV_CHAVE } from "./openai-compat.js";

const CACHE = new Map();

function provider(id) {
  if (!CACHE.has(id)) CACHE.set(id, criarProvider(id));
  return CACHE.get(id);
}

/**
 * @param {Array<{provedor:string, modelo:string}>} corrente
 * @returns {Promise<{ok:boolean, text?, model?, provedor?, tentativas?, usedFallback?, usage?, error?, retryAfter?}>}
 */
export async function chamarCorrente({ corrente, env, system, messages, maxTokens, signal }) {
  let ultimoRate = null;
  let ultimo = null;
  let tentativas = 0;

  for (const elo of corrente) {
    const chave = env[ENV_CHAVE[elo.provedor]];
    // Elo sem chave é pulado em silêncio: dá para configurar a corrente
    // inteira e ir adicionando chave conforme cria conta, sem quebrar nada.
    if (!chave || !chave.trim()) continue;

    tentativas++;
    let r;
    try {
      r = await provider(elo.provedor).chat({
        system, messages, modelo: elo.modelo, chave: chave.trim(), maxTokens, signal,
      });
    } catch (e) {
      r = { ok: false, error: "unavailable", detail: String(e && e.message) };
    }

    if (r.ok) {
      return { ...r, model: elo.modelo, provedor: elo.provedor, tentativas, usedFallback: tentativas > 1 };
    }

    // 401 é credencial DAQUELE provedor — os outros podem estar bons, então
    // a corrente continua. (Diferente de quando havia um provedor só.)
    if (r.error === "rate_limited") ultimoRate = r;
    ultimo = r;
  }

  if (!tentativas) return { ok: false, error: "unauthorized", detail: "nenhum elo da corrente tem chave" };
  return ultimoRate || ultimo || { ok: false, error: "unavailable" };
}

export { ENV_CHAVE };
