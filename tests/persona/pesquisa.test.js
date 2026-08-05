// tests/persona/pesquisa.test.js
//
// A busca ao vivo abriu um vetor novo para a regra 1: até então a moderação
// só precisava vigiar o que o USUÁRIO escrevia. Agora o resultado da busca
// entra no prompt, e resultado de busca esportiva vem cheio de nome de
// gente real — no primeiro teste manual veio "a presidente Marianna Libano
// afirmou que...".
//
// Se isso chega cru ao modelo, ele tem nome de pessoa real no contexto e
// instrução de inventar. É exatamente a combinação que a regra 1 existe
// para impedir, e não pode depender do bom senso do modelo.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { higienizar, precisaBuscar } from "../../worker/src/pesquisa.js";

describe("busca — quando vale a pena", () => {
  test("só busca em pergunta sobre o AGORA", () => {
    for (const m of [
      "como o coritiba tá esse ano",
      "qual a posição do coxa na tabela",
      "em que série o coritiba está",
      "último jogo do coxa",
    ]) assert.equal(precisaBuscar(m, "assunto"), true, `deveria buscar: ${m}`);
  });

  test("fato histórico não gasta busca — já está na munição", () => {
    for (const m of [
      "o coritiba é pequeno",
      "me fala do couto pereira",
      "quando o coxa foi fundado",
    ]) assert.equal(precisaBuscar(m, "ataque"), false, `não deveria buscar: ${m}`);
  });

  test("fora do assunto Coxa, nunca busca", () => {
    assert.equal(precisaBuscar("como está o tempo hoje", null), false);
    assert.equal(precisaBuscar("qual a tabela do brasileirão agora", null), false);
  });
});

describe("busca — higienização de pessoa real", () => {
  test("cargo + nome vira cargo genérico", () => {
    const bruto =
      "A presidente Marianna Libano afirmou que o clube não vende. " +
      "O técnico Mozart escalou o goleiro Pedro Rangel. " +
      "Segundo o diretor João Carlos Belotti, o elenco está pronto.";
    const limpo = higienizar(bruto);
    for (const nome of ["Marianna", "Libano", "Mozart", "Pedro", "Rangel", "Belotti"]) {
      assert.ok(!limpo.includes(nome), `sobrou nome real na ficha: ${nome}`);
    }
    // o fato tem que sobreviver à limpeza, senão a busca perde a serventia
    assert.ok(/presidente do clube/.test(limpo));
    assert.ok(/n[ãa]o vende/.test(limpo));
  });

  test("fato sobre o clube passa intacto", () => {
    const bruto = "Série A, 11º colocado. Último jogo: Coritiba 0 x 1 Cruzeiro em 31 de julho.";
    assert.equal(higienizar(bruto), bruto);
  });

  test("a ficha tem teto de tamanho", () => {
    assert.ok(higienizar("a".repeat(5000)).length <= 700, "ficha grande demais estoura o orçamento de tokens");
  });
});
