// tests/persona/corrente.test.js
//
// O teto do free tier da Groq é POR MODELO, não por conta. A bancada provou
// isso na marra: o llama-3.3 devolveu 429 em 27 chamadas seguidas enquanto o
// gpt-oss respondeu as 30 sem falhar.
//
// A corrente de modelos é o que mantém o produto de pé quando o primeiro
// esgota. Estes testes garantem que ela percorre até achar quem responda, e
// que não desiste no meio à toa.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../../worker/src/config.js";
import { groq } from "../../worker/src/providers/groq.js";

const cfgCom = (models) => ({
  ...readConfig({ GROQ_API_KEY: "k", GROQ_MODELS: models.join(",") }),
});

// fetch falso: decide a resposta por modelo, e anota a ordem das tentativas
function fetchFalso(porModelo, registro) {
  return async (_url, opts) => {
    const { model } = JSON.parse(opts.body);
    registro.push(model);
    const r = porModelo[model] ?? { status: 500 };
    if (r.status !== 200) {
      return { ok: false, status: r.status, headers: new Map(), text: async () => "erro", json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        choices: [{ message: { content: r.texto ?? "resposta" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };
}

async function chamar(porModelo, models) {
  const registro = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso(porModelo, registro);
  try {
    const r = await groq.chat({ system: "s", messages: [{ role: "user", content: "oi" }], config: cfgCom(models) });
    return { r, registro };
  } finally {
    globalThis.fetch = original;
  }
}

describe("corrente de modelos", () => {
  const TRES = ["a", "b", "c"];

  test("usa o primeiro quando ele responde, e não chama os outros", async () => {
    const { r, registro } = await chamar({ a: { status: 200, texto: "oi" } }, TRES);
    assert.equal(r.ok, true);
    assert.equal(r.model, "a");
    assert.equal(r.usedFallback, false);
    assert.deepEqual(registro, ["a"], "não podia ter chamado o resto");
  });

  test("pula para o próximo quando o primeiro estoura a cota", async () => {
    const { r, registro } = await chamar({ a: { status: 429 }, b: { status: 200, texto: "eu" } }, TRES);
    assert.equal(r.ok, true);
    assert.equal(r.model, "b");
    assert.equal(r.usedFallback, true);
    assert.deepEqual(registro, ["a", "b"]);
  });

  test("percorre a corrente inteira até achar quem responda", async () => {
    const { r, registro } = await chamar({ a: { status: 429 }, b: { status: 500 }, c: { status: 200, texto: "eu" } }, TRES);
    assert.equal(r.ok, true);
    assert.equal(r.model, "c");
    assert.equal(r.tentativas, 3);
    assert.deepEqual(registro, ["a", "b", "c"]);
  });

  test("resposta vazia conta como falha e a corrente segue", async () => {
    // o gpt-oss-20b devolveu vazio num teste real; entregar bolha em branco
    // é pior do que tentar o próximo
    const { r } = await chamar({ a: { status: 200, texto: "   " }, b: { status: 200, texto: "valeu" } }, TRES);
    assert.equal(r.ok, true);
    assert.equal(r.model, "b");
  });

  test("com a corrente toda no teto, devolve rate_limited para virar piada de cota", async () => {
    const { r, registro } = await chamar({ a: { status: 429 }, b: { status: 429 }, c: { status: 429 } }, TRES);
    assert.equal(r.ok, false);
    assert.equal(r.error, "rate_limited");
    assert.equal(registro.length, 3);
  });

  test("401 aborta na hora — chave errada não melhora trocando de modelo", async () => {
    const { r, registro } = await chamar({ a: { status: 401 }, b: { status: 200, texto: "eu" } }, TRES);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unauthorized");
    assert.deepEqual(registro, ["a"], "não podia ter insistido nos outros");
  });
});

describe("configuração da corrente", () => {
  test("o padrão tem folga de sobra", () => {
    const models = readConfig({}).provider.models;
    assert.ok(models.length >= 3, `corrente curta demais: ${models.length}`);
    assert.equal(new Set(models).size, models.length, "modelo repetido não acrescenta cota nenhuma");
  });

  test("GROQ_MODELS manda, e GROQ_MODEL antigo continua valendo", () => {
    assert.deepEqual(readConfig({ GROQ_MODELS: "x , y" }).provider.models, ["x", "y"]);
    const legado = readConfig({ GROQ_MODEL: "x" }).provider.models;
    assert.equal(legado[0], "x", "o modelo do formato antigo tem que continuar em primeiro");
    assert.ok(legado.length > 1, "e ainda ganhar a corrente padrão como reserva");
  });
});
