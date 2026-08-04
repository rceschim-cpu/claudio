// worker/src/ledger.js
// Contabilidade de uso: rate limit por IP e por sessão, orçamento global do
// dia/minuto e contador de tokens.
//
// Por que um Durable Object: o free tier da Groq é um teto GLOBAL (30 rpm,
// 1.000 req/dia, 12k tpm), não por usuário. Contar isso exige um lugar só,
// serializado. KV não serve — é eventualmente consistente e o free tier de
// KV tem 1.000 escritas/dia, exatamente a ordem de grandeza do que
// precisamos contar.
//
// Se o binding não existir (dev rápido, ou conta sem DO), cai para um ledger
// em memória por isolate: funciona, mas não é global. O /health denuncia.

const SP = "America/Sao_Paulo";

// O "dia" do Claudio é o dia de Brasília — a cota que acaba precisa acabar
// junto com o dia de quem está usando, não às 21h por causa de UTC.
export function dayKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

const minuteKey = (now = Date.now()) => Math.floor(now / 60000);

function emptyState(now) {
  return {
    day: dayKey(now),
    minute: minuteKey(now),
    dayCount: 0,
    minCount: 0,
    minTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    blocked: {},
    callers: new Map(), // hash -> { day, dayCount, minute, minCount }
  };
}

// -----------------------------------------------------------------
// Núcleo puro — sem I/O, testável, compartilhado pelo DO e pelo fallback.
// -----------------------------------------------------------------
export class LedgerCore {
  constructor(now = Date.now()) {
    this.s = emptyState(now);
  }

  #roll(now) {
    const s = this.s;
    const d = dayKey(now);
    if (s.day !== d) {
      const fresh = emptyState(now);
      this.s = fresh;
      return;
    }
    const m = minuteKey(now);
    if (s.minute !== m) {
      s.minute = m;
      s.minCount = 0;
      s.minTokens = 0;
    }
    // Poda preguiçosa: o mapa de chamadores não pode crescer sem limite.
    if (s.callers.size > 5000) {
      for (const [k, v] of s.callers) {
        if (v.day !== d) s.callers.delete(k);
        if (s.callers.size <= 2500) break;
      }
    }
  }

  #caller(hash, now) {
    const s = this.s;
    const d = dayKey(now);
    const m = minuteKey(now);
    let c = s.callers.get(hash);
    if (!c || c.day !== d) c = { day: d, dayCount: 0, minute: m, minCount: 0 };
    if (c.minute !== m) {
      c.minute = m;
      c.minCount = 0;
    }
    s.callers.set(hash, c);
    return c;
  }

  /**
   * Reserva uma vaga. Ordem dos testes = ordem da mensagem que o usuário vê:
   * o limite dele primeiro (culpa dele), o global depois (culpa da cota).
   * @returns {{ok:true} | {ok:false, reason:string, retryAfter:number}}
   */
  check({ ipHash, sessionHash, estTokens = 0, cfg, now = Date.now() }) {
    this.#roll(now);
    const s = this.s;
    const secsLeftInMinute = 60 - Math.floor((now % 60000) / 1000);

    const ip = this.#caller("ip:" + ipHash, now);
    if (ip.minCount >= cfg.ipPerMin)
      return { ok: false, reason: "user_min", retryAfter: secsLeftInMinute };
    if (ip.dayCount >= cfg.ipPerDay)
      return { ok: false, reason: "user_day", retryAfter: 3600 };

    const sess = sessionHash ? this.#caller("s:" + sessionHash, now) : null;
    if (sess && sess.dayCount >= cfg.sessionPerDay)
      return { ok: false, reason: "user_day", retryAfter: 3600 };

    if (s.dayCount >= cfg.dailyBudget)
      return { ok: false, reason: "global_day", retryAfter: 3600 };
    if (s.minCount >= cfg.rpmBudget)
      return { ok: false, reason: "global_min", retryAfter: secsLeftInMinute };
    if (s.minTokens + estTokens > cfg.tpmBudget)
      return { ok: false, reason: "global_min", retryAfter: secsLeftInMinute };

    ip.minCount++;
    ip.dayCount++;
    if (sess) sess.dayCount++;
    s.minCount++;
    s.dayCount++;
    s.minTokens += estTokens;
    s.reserved = estTokens;
    return { ok: true };
  }

  /** Troca a estimativa pelo consumo real informado pela API. */
  commit({ tokensIn = 0, tokensOut = 0, estTokens = 0, now = Date.now() }) {
    this.#roll(now);
    const s = this.s;
    s.tokensIn += tokensIn;
    s.tokensOut += tokensOut;
    s.minTokens = Math.max(0, s.minTokens - estTokens + tokensIn + tokensOut);
  }

  /** Devolve a vaga quando a chamada nem chegou a acontecer. */
  refund({ ipHash, sessionHash, estTokens = 0, now = Date.now() }) {
    this.#roll(now);
    const s = this.s;
    const ip = s.callers.get("ip:" + ipHash);
    if (ip) {
      ip.minCount = Math.max(0, ip.minCount - 1);
      ip.dayCount = Math.max(0, ip.dayCount - 1);
    }
    const sess = sessionHash && s.callers.get("s:" + sessionHash);
    if (sess) sess.dayCount = Math.max(0, sess.dayCount - 1);
    s.minCount = Math.max(0, s.minCount - 1);
    s.dayCount = Math.max(0, s.dayCount - 1);
    s.minTokens = Math.max(0, s.minTokens - estTokens);
  }

  /** Registra um bloqueio da moderação. Só a categoria — nunca o texto. */
  block({ category, now = Date.now() }) {
    this.#roll(now);
    this.s.blocked[category] = (this.s.blocked[category] || 0) + 1;
  }

  stats(cfg, now = Date.now()) {
    this.#roll(now);
    const s = this.s;
    return {
      day: s.day,
      requests: { used: s.dayCount, budget: cfg.dailyBudget, remaining: Math.max(0, cfg.dailyBudget - s.dayCount) },
      minute: { used: s.minCount, budget: cfg.rpmBudget, tokens: s.minTokens, tokenBudget: cfg.tpmBudget },
      tokens: { in: s.tokensIn, out: s.tokensOut, total: s.tokensIn + s.tokensOut },
      blocked: { ...s.blocked, total: Object.values(s.blocked).reduce((a, b) => a + b, 0) },
      callers: s.callers.size,
    };
  }
}

// -----------------------------------------------------------------
// Durable Object — instância única, contagem global de verdade.
// -----------------------------------------------------------------
export class Ledger {
  constructor(state) {
    this.state = state;
    this.core = new LedgerCore();
    // Sobrevive à hibernação do DO: o que importa é o acumulado do dia.
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get("day-state");
      if (saved && saved.day === dayKey()) Object.assign(this.core.s, saved, { callers: new Map(saved.callers || []) });
    });
  }

  async #persist() {
    const s = this.core.s;
    await this.state.storage.put("day-state", {
      day: s.day,
      dayCount: s.dayCount,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      blocked: s.blocked,
      callers: [...s.callers].slice(-2000),
    });
  }

  async fetch(req) {
    const { op, ...args } = await req.json();
    let out;
    switch (op) {
      case "check":   out = this.core.check(args); break;
      case "commit":  this.core.commit(args); out = { ok: true }; break;
      case "refund":  this.core.refund(args); out = { ok: true }; break;
      case "block":   this.core.block(args); out = { ok: true }; break;
      case "stats":   out = this.core.stats(args.cfg); break;
      default:        return new Response("op desconhecida", { status: 400 });
    }
    if (op !== "stats") this.state.waitUntil?.(this.#persist());
    else await this.#persist().catch(() => {});
    return Response.json(out);
  }
}

// -----------------------------------------------------------------
// Cliente. Usa o DO se houver binding; senão, memória local (degradado).
// -----------------------------------------------------------------
let fallback = null;

export function getLedger(env) {
  if (env.LEDGER) {
    const stub = env.LEDGER.get(env.LEDGER.idFromName("global"));
    const call = async (op, args = {}) => {
      const r = await stub.fetch("https://ledger/", {
        method: "POST",
        body: JSON.stringify({ op, ...args }),
      });
      return r.json();
    };
    return {
      durable: true,
      check: (a) => call("check", a),
      commit: (a) => call("commit", a),
      refund: (a) => call("refund", a),
      block: (a) => call("block", a),
      stats: (cfg) => call("stats", { cfg }),
    };
  }

  if (!fallback) fallback = new LedgerCore();
  return {
    durable: false,
    check: async (a) => fallback.check(a),
    commit: async (a) => fallback.commit(a),
    refund: async (a) => fallback.refund(a),
    block: async (a) => fallback.block(a),
    stats: async (cfg) => fallback.stats(cfg),
  };
}

// Identificador estável e anônimo. O IP nunca é armazenado nem logado —
// só este hash, que não volta a ser IP.
export async function anonHash(value, salt = "claudio") {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
