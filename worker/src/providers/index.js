// worker/src/providers/index.js
// Registro de providers.
//
// CONTRATO — um provider é um objeto:
//   { id: string,
//     label: string,
//     chat({ system, messages, config, signal }) -> Promise<Result> }
//
// Result (sucesso):  { ok: true, text, model, usedFallback, usage: {in, out} }
// Result (falha):    { ok: false, error: ErrorCode, retryAfter?, detail? }
// ErrorCode:         "rate_limited" | "unauthorized" | "unavailable"
//                  | "bad_request" | "timeout"
//
// Hoje só a Groq está registrada — é o único provider do produto. A camada
// existe porque plugar a xAI depois precisa ser "escrever ./xai.js e adicionar
// uma linha aqui", não uma refatoração.

import { groq } from "./groq.js";

const REGISTRY = new Map([[groq.id, groq]]);

export function getProvider(id) {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`provider desconhecido: ${id}`);
  return p;
}
