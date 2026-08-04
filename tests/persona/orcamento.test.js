// tests/persona/orcamento.test.js
//
// O free tier da Groq é o gargalo do produto. Estes testes garantem que o
// teto é respeitado ANTES de a chamada sair, e que estourar produz uma
// mensagem em personagem, não um erro.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LedgerCore, dayKey } from "../../worker/src/ledger.js";
import { readConfig, estimateTokens } from "../../worker/src/config.js";

const cfg = readConfig({});
const T0 = Date.parse("2026-08-04T15:00:00Z");

const novo = () => new LedgerCore(T0);
const pedir = (l, extra = {}) =>
  l.check({ ipHash: "ip1", sessionHash: "s1", estTokens: 100, cfg, now: T0, ...extra });

describe("orçamento — limites por usuário", () => {
  test("corta o IP no teto por minuto", () => {
    const l = novo();
    for (let i = 0; i < cfg.ipPerMin; i++) assert.equal(pedir(l).ok, true, `chamada ${i} deveria passar`);
    const bloqueado = pedir(l);
    assert.equal(bloqueado.ok, false);
    assert.equal(bloqueado.reason, "user_min");
    assert.ok(bloqueado.retryAfter > 0);
  });

  test("IPs diferentes não se atrapalham", () => {
    const l = novo();
    for (let i = 0; i < cfg.ipPerMin; i++) pedir(l);
    assert.equal(pedir(l, { ipHash: "ip2", sessionHash: "s2" }).ok, true);
  });

  test("a janela do minuto abre de novo", () => {
    const l = novo();
    for (let i = 0; i < cfg.ipPerMin; i++) pedir(l);
    assert.equal(pedir(l).ok, false);
    assert.equal(pedir(l, { now: T0 + 61000 }).ok, true);
  });
});

describe("orçamento — limites globais", () => {
  test("o teto de tokens por minuto segura antes do teto de chamadas", () => {
    const l = novo();
    // tokens altos: o TPM tem que barrar antes de bater o RPM
    let i = 0;
    for (; i < cfg.rpmBudget; i++) {
      const r = l.check({ ipHash: "ip" + i, sessionHash: null, estTokens: 3000, cfg, now: T0 });
      if (!r.ok) {
        assert.equal(r.reason, "global_min");
        break;
      }
    }
    assert.ok(i < cfg.rpmBudget, "o TPM deveria ter barrado antes do RPM");
  });

  test("o teto do dia devolve global_day", () => {
    const l = novo();
    // avança um minuto a cada lote de rpmBudget, senão o teto por minuto
    // barra antes e o teste mede a coisa errada
    let t = T0;
    for (let i = 0; i < cfg.dailyBudget; i++) {
      if (i % cfg.rpmBudget === 0) t += 61000;
      l.check({ ipHash: "ip" + i, sessionHash: null, estTokens: 1, cfg, now: t });
    }
    const r = l.check({ ipHash: "novo", sessionHash: null, estTokens: 1, cfg, now: t + 61000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "global_day");
  });

  test("o orçamento fica abaixo do teto real da Groq", () => {
    assert.ok(cfg.dailyBudget < 1000, "cota diária tem que ficar abaixo de 1.000");
    assert.ok(cfg.rpmBudget < 30, "RPM tem que ficar abaixo de 30");
    assert.ok(cfg.tpmBudget < 12000, "TPM tem que ficar abaixo de 12.000");
  });
});

describe("orçamento — contabilidade", () => {
  test("refund devolve a vaga quando a chamada não aconteceu", () => {
    const l = novo();
    pedir(l);
    const antes = l.stats(cfg, T0).requests.used;
    l.refund({ ipHash: "ip1", sessionHash: "s1", estTokens: 100, now: T0 });
    assert.equal(l.stats(cfg, T0).requests.used, antes - 1);
  });

  test("commit troca a estimativa pelo consumo real", () => {
    const l = novo();
    pedir(l);
    l.commit({ tokensIn: 300, tokensOut: 120, estTokens: 100, now: T0 });
    const s = l.stats(cfg, T0);
    assert.equal(s.tokens.in, 300);
    assert.equal(s.tokens.out, 120);
    assert.equal(s.tokens.total, 420);
  });

  test("bloqueios são contados por categoria, sem texto", () => {
    const l = novo();
    l.block({ category: "real_person", now: T0 });
    l.block({ category: "real_person", now: T0 });
    l.block({ category: "injection", now: T0 });
    const s = l.stats(cfg, T0);
    assert.equal(s.blocked.real_person, 2);
    assert.equal(s.blocked.injection, 1);
    assert.equal(s.blocked.total, 3);
  });

  test("o dia vira no fuso de Brasília, não em UTC", () => {
    // 04/08 23h em Brasília = 05/08 02h UTC. O dia do Claudio ainda é 04.
    assert.equal(dayKey(Date.parse("2026-08-05T02:00:00Z")), "2026-08-04");
    assert.equal(dayKey(Date.parse("2026-08-05T04:00:00Z")), "2026-08-05");
  });
});

describe("kill switch e estimativa", () => {
  test("kill switch liga com qualquer valor diferente de off", () => {
    assert.equal(readConfig({ CLAUDIO_KILL_SWITCH: "off" }).killSwitch, false);
    assert.equal(readConfig({}).killSwitch, false);
    assert.equal(readConfig({ CLAUDIO_KILL_SWITCH: "on" }).killSwitch, true);
    assert.equal(readConfig({ CLAUDIO_KILL_SWITCH: "sim" }).killSwitch, true);
  });

  test("a estimativa de tokens não subestima o português", () => {
    const frase = "Qual a capital da Austrália? Me responde rápido que eu tenho pressa.";
    assert.ok(estimateTokens(frase) >= frase.split(/\s+/).length, "estimativa baixa demais");
  });
});
