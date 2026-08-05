// worker/src/index.js
// Claudio — backend.
//
// Ele existe por um motivo só: a GROQ_API_KEY não pode chegar ao navegador.
// O front é estático no GitHub Pages e não guarda segredo nenhum; tudo que
// precisa de chave, de contagem ou de bloqueio acontece aqui.
//
// Pipeline de uma mensagem:
//   CORS → kill switch → validação → moderação → orçamento → Groq → resposta
// A moderação vem ANTES do orçamento de propósito: bloquear não gasta cota.

import CLAUDIO_PROMPT from "../../prompts/claudio.md";
import { readConfig, estimateTokens } from "./config.js";
import { chamarCorrente, ENV_CHAVE } from "./providers/index.js";
import { moderate } from "./moderation.js";
import { getLedger, anonHash, dayKey } from "./ledger.js";
import { blockReply, quotaReply, offlineReply, brokenReply, GREETINGS } from "./replies.js";
import { dicaDeEstilo } from "./estilo.js";

export { Ledger } from "./ledger.js";

const MAX_CHARS = 1200; // pergunta maior que isso é abuso de contexto, não pergunta

export default {
  async fetch(request, env, ctx) {
    const cfg = readConfig(env);
    const url = new URL(request.url);
    const cors = corsHeaders(request, cfg);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/health") return health(env, cfg, cors);
      if (url.pathname === "/api/chat" && request.method === "POST") return chat(request, env, ctx, cfg, cors);
      if (url.pathname === "/api/greeting") {
        const seed = url.searchParams.get("s") || String(Date.now());
        return json({ text: GREETINGS[Math.abs(hashCode(seed)) % GREETINGS.length] }, 200, cors);
      }
      return json({ error: "rota inexistente" }, 404, cors);
    } catch (e) {
      // Nada de stack trace para o cliente — e mesmo o erro sai em personagem.
      console.error("erro:", e && e.message);
      return json({ text: brokenReply(String(Date.now())), kind: "error" }, 200, cors);
    }
  },
};

// -----------------------------------------------------------------
// POST /api/chat
// -----------------------------------------------------------------
async function chat(request, env, ctx, cfg, cors) {
  if (cfg.killSwitch) {
    return json({ text: offlineReply(String(Date.now())), kind: "offline" }, 200, cors);
  }

  const body = await request.json().catch(() => null);
  const message = String(body?.message || "").trim();
  const history = Array.isArray(body?.history) ? body.history : [];
  const sessionId = String(body?.sessionId || "").slice(0, 64);
  // [original, trocada] quando o teclado bêbado mexeu na frase
  // 0 a 1 — o termômetro de agressividade do front
  const agressao = Math.max(0, Math.min(1, Number(body?.agressao) || 0));
  const semFreio = body?.semFreio === true;
  const trocado = Array.isArray(body?.trocado) && body.trocado.length === 2
    ? body.trocado.map((t) => String(t).slice(0, 40))
    : null;

  if (!message) return json({ error: "mensagem vazia" }, 400, cors);
  if (message.length > MAX_CHARS) {
    return json(
      { text: "Isso aí é um TCC, chefia, não é uma pergunta. Resume em duas linhas que eu respondo errado bem mais rápido.", kind: "too_long" },
      200,
      cors
    );
  }

  const ledger = getLedger(env);
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const ipHash = await anonHash(ip);
  const sessionHash = sessionId ? await anonHash(sessionId, "sess") : null;

  // ---- moderação (não gasta cota) --------------------------------
  const verdict = moderate(message);
  if (verdict.blocked) {
    ctx.waitUntil(ledger.block({ category: verdict.category }));
    // Log sem PII: categoria, sinal que disparou e tamanho em faixa.
    // Nunca o texto, nunca o IP, nunca o id de sessão em claro.
    console.log(
      JSON.stringify({
        evt: "block",
        cat: verdict.category,
        sig: verdict.signal,
        len: lenBucket(message.length),
        day: dayKey(),
      })
    );
    return json({ text: blockReply(verdict.category, message), kind: "blocked", category: verdict.category }, 200, cors);
  }

  // ---- orçamento --------------------------------------------------
  const trimmed = trimHistory(history, cfg.historyTurns);
  const estIn = estimateTokens(CLAUDIO_PROMPT) + estimateTokens(message) + trimmed.reduce((a, m) => a + estimateTokens(m.content), 0);
  const estTokens = estIn + cfg.maxTokens;

  const slot = await ledger.check({ ipHash, sessionHash, estTokens, cfg });
  if (!slot.ok) {
    const kind = slot.reason.startsWith("user") ? "user" : slot.reason;
    return json(
      { text: quotaReply(kind === "user" ? "user" : kind, ipHash + slot.reason), kind: "quota", reason: slot.reason, retryAfter: slot.retryAfter },
      200,
      { ...cors, "Retry-After": String(slot.retryAfter || 60) }
    );
  }

  // ---- corrente de provedores -------------------------------------
  const result = await chamarCorrente({
    corrente: cfg.provider.corrente,
    env,
    maxTokens: cfg.maxTokens,
    // O recurso cômico da vez entra aqui, não no arquivo do prompt: o modelo
    // não lembra da resposta anterior, então quem garante a variedade é a
    // rotação de fora.
    system: CLAUDIO_PROMPT + dicaDeEstilo(message, sessionId, trocado, agressao, semFreio),
    messages: [...trimmed, { role: "user", content: message }],
    // 20s: o grok-4.5 leva 26s e por isso ficou fora da corrente. Esperar
    // mais que isso num brinquedo de chat é pior que cair para o próximo.
    signal: AbortSignal.timeout(20000),
  });

  if (!result.ok) {
    ctx.waitUntil(ledger.refund({ ipHash, sessionHash, estTokens }));
    console.log(JSON.stringify({ evt: "provider_error", err: result.error, day: dayKey() }));

    if (result.error === "rate_limited") {
      return json(
        { text: quotaReply("provider", ipHash), kind: "quota", reason: "provider", retryAfter: result.retryAfter || 30 },
        200,
        { ...cors, "Retry-After": String(result.retryAfter || 30) }
      );
    }
    if (result.error === "unauthorized") {
      // Problema de configuração — o usuário não tem culpa e nem precisa saber.
      return json({ text: offlineReply(ipHash), kind: "offline" }, 200, cors);
    }
    return json({ text: brokenReply(ipHash + Date.now()), kind: "error" }, 200, cors);
  }

  ctx.waitUntil(ledger.commit({ tokensIn: result.usage?.in || 0, tokensOut: result.usage?.out || 0, estTokens }));

  return json(
    {
      text: enxugar(result.text),
      kind: "ok",
      model: result.model,
      provedor: result.provedor,
      usedFallback: Boolean(result.usedFallback),
      tentativas: result.tentativas || 1,
    },
    200,
    cors
  );
}

// -----------------------------------------------------------------
// GET /health — o painel de custo do dia (fase 5).
// -----------------------------------------------------------------
async function health(env, cfg, cors) {
  const ledger = getLedger(env);
  const stats = await ledger.stats(cfg);
  return json(
    {
      ok: !cfg.killSwitch,
      killSwitch: cfg.killSwitch,
      corrente: cfg.provider.texto,
      // Quais elos realmente podem responder. Elo sem chave é pulado em
      // silêncio, então sem isto dá para achar que a corrente tem 11
      // opções quando na prática tem 3.
      provedoresComChave: [...new Set(cfg.provider.corrente.map((e) => e.provedor))].filter((p) => env[ENV_CHAVE[p]]),
      accounting: ledger.durable ? "durable-object" : "in-memory (degradado: contagem por isolate)",
      ...stats,
    },
    200,
    cors
  );
}

// -----------------------------------------------------------------
// Rede de segurança de formato.
//
// O prompt manda texto corrido, curto, sem markdown. O modelo obedece quase
// sempre — e "quase" não serve, porque a resposta que escapa é justamente a
// que vira print: já saiu resposta com bloco de código, linha de "Fonte:" e
// três parágrafos, num produto cuja regra é "duas a quatro frases".
//
// Então o formato é garantido aqui, deterministicamente. O corte de tamanho
// acontece SEMPRE em fim de frase: frase cortada no meio mata mais a piada
// do que resposta comprida.
const MAX_FRASES = 4;

function enxugar(texto) {
  let t = String(texto || "");

  t = t.replace(/```[a-z]*\n?/gi, " ");           // cercas de bloco de código
  t = t.replace(/`([^`]+)`/g, "$1");              // crase inline
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");       // títulos
  t = t.replace(/^\s*[-*+]\s+/gm, "");            // marcadores de lista
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");          // listas numeradas
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");        // negrito
  t = t.replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2");  // itálico
  t = t.replace(/^\s*(fonte|refer[êe]ncia|obs)\s*:.*$/gim, ""); // rodapé falso
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // corta em fim de frase, nunca no meio
  const frases = t.match(/[^.!?…]+[.!?…]+(?:\s|$)|[^.!?…]+$/g);
  if (frases && frases.length > MAX_FRASES) {
    t = frases.slice(0, MAX_FRASES).join("").trim();
  }
  return t;
}

// -----------------------------------------------------------------
// utilitários
// -----------------------------------------------------------------
function trimHistory(history, turns) {
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-turns)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

function corsHeaders(request, cfg) {
  const origin = request.headers.get("Origin") || "";
  const allowed = cfg.allowedOrigins.length === 0 || cfg.allowedOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : cfg.allowedOrigins[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

// Tamanho em faixa, para o log não virar impressão digital da mensagem.
const lenBucket = (n) => (n < 40 ? "xs" : n < 120 ? "s" : n < 400 ? "m" : "l");

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
