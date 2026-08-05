// tests/persona/corrente.test.js
//
// O teto do free tier é por MODELO e por CONTA. A bancada provou na marra:
// o llama-3.3 devolveu 429 em 27 chamadas seguidas enquanto o gpt-oss
// respondeu as 30 sem falhar; e mais tarde a Groq inteira secou enquanto
// Mistral e Cohere seguiam intactos.
//
// A corrente multi-provedor é o que mantém o produto de pé. Estes testes
// garantem que ela percorre até achar quem responda, pula elo sem chave, e
// não desiste no meio à toa.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../../worker/src/config.js";
import { chamarCorrente, ENV_CHAVE } from "../../worker/src/providers/index.js";

// fetch falso: decide a resposta pelo modelo pedido e anota a ordem
function comFetchFalso(porModelo, fn) {
  const registro = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const { model } = JSON.parse(opts.body);
    registro.push(model);
    const r = porModelo[model] ?? { status: 500 };
    if (r.status !== 200) {
      return { ok: false, status: r.status, headers: new Map(), text: async () => "erro", json: async () => ({}) };
    }
    return {
      ok: true, status: 200, headers: new Map(),
      json: async () => ({
        choices: [{ message: { content: r.texto ?? "resposta" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };
  return fn(registro).finally(() => { globalThis.fetch = original; });
}

const CHAVES = { GROQ_API_KEY: "k", MISTRAL_API_KEY: "k", COHERE_API_KEY: "k" };
const TRES = [
  { provedor: "groq", modelo: "a" },
  { provedor: "mistral", modelo: "b" },
  { provedor: "cohere", modelo: "c" },
];

const chamar = (porModelo, corrente = TRES, env = CHAVES) =>
  comFetchFalso(porModelo, async (registro) => {
    const r = await chamarCorrente({
      corrente, env, system: "s", maxTokens: 100,
      messages: [{ role: "user", content: "oi" }],
    });
    return { r, registro };
  });

describe("corrente multi-provedor", () => {
  test("usa o primeiro que responde e não chama o resto", async () => {
    const { r, registro } = await chamar({ a: { status: 200, texto: "oi" } });
    assert.equal(r.ok, true);
    assert.equal(r.model, "a");
    assert.equal(r.provedor, "groq");
    assert.equal(r.usedFallback, false);
    assert.deepEqual(registro, ["a"]);
  });

  test("429 de um provedor cai para o PRÓXIMO PROVEDOR, não só próximo modelo", async () => {
    const { r, registro } = await chamar({ a: { status: 429 }, b: { status: 200, texto: "eu" } });
    assert.equal(r.ok, true);
    assert.equal(r.provedor, "mistral", "tinha que ter trocado de conta, não só de modelo");
    assert.equal(r.usedFallback, true);
    assert.deepEqual(registro, ["a", "b"]);
  });

  test("percorre a corrente inteira até achar quem responda", async () => {
    const { r } = await chamar({ a: { status: 429 }, b: { status: 500 }, c: { status: 200, texto: "eu" } });
    assert.equal(r.ok, true);
    assert.equal(r.model, "c");
    assert.equal(r.tentativas, 3);
  });

  test("resposta vazia conta como falha e a corrente segue", async () => {
    // o zai-glm e o deepseek devolveram vazio na bancada; bolha em branco é
    // pior do que tentar o próximo
    const { r } = await chamar({ a: { status: 200, texto: "   " }, b: { status: 200, texto: "valeu" } });
    assert.equal(r.ok, true);
    assert.equal(r.model, "b");
  });

  test("401 num provedor NÃO derruba os outros", async () => {
    // diferente de quando havia um provedor só: chave errada da Mistral não
    // diz nada sobre a chave da Cohere
    const { r, registro } = await chamar({ a: { status: 401 }, b: { status: 401 }, c: { status: 200, texto: "eu" } });
    assert.equal(r.ok, true);
    assert.equal(r.provedor, "cohere");
    assert.deepEqual(registro, ["a", "b", "c"]);
  });

  test("elo sem chave é pulado em silêncio", async () => {
    const { r, registro } = await chamar(
      { b: { status: 200, texto: "eu" } },
      TRES,
      { MISTRAL_API_KEY: "k" } // só a Mistral tem chave
    );
    assert.equal(r.ok, true);
    assert.equal(r.provedor, "mistral");
    assert.deepEqual(registro, ["b"], "não podia ter tentado provedor sem chave");
  });

  test("corrente inteira no teto devolve rate_limited, para virar piada de cota", async () => {
    const { r } = await chamar({ a: { status: 429 }, b: { status: 429 }, c: { status: 429 } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "rate_limited");
  });

  test("sem nenhuma chave, avisa em vez de fingir que tentou", async () => {
    const { r, registro } = await chamar({}, TRES, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "unauthorized");
    assert.deepEqual(registro, []);
  });
});

describe("configuração da corrente", () => {
  test("o padrão tem folga e alterna provedores", () => {
    const c = readConfig({}).provider.corrente;
    assert.ok(c.length >= 6, `corrente curta demais: ${c.length}`);
    const provs = new Set(c.map((e) => e.provedor));
    assert.ok(provs.size >= 3, "com um provedor só, a conta secar derruba tudo");
    // os três primeiros não podem ser todos do mesmo provedor
    assert.ok(new Set(c.slice(0, 3).map((e) => e.provedor)).size > 1, "o topo da corrente tem que alternar conta");
  });

  test("todo provedor da corrente tem variável de chave conhecida", () => {
    for (const e of readConfig({}).provider.corrente) {
      assert.ok(ENV_CHAVE[e.provedor], `provedor sem chave mapeada: ${e.provedor}`);
    }
  });

  test("CLAUDIO_CORRENTE manda, e o formato antigo continua valendo", () => {
    assert.deepEqual(
      readConfig({ CLAUDIO_CORRENTE: "mistral:x , groq:y" }).provider.corrente,
      [{ provedor: "mistral", modelo: "x" }, { provedor: "groq", modelo: "y" }]
    );
    // sem prefixo assume groq
    assert.deepEqual(readConfig({ GROQ_MODELS: "z" }).provider.corrente, [{ provedor: "groq", modelo: "z" }]);
  });
});
