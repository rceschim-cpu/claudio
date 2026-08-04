// tests/persona/teclado.test.js
//
// O teclado bêbado troca uma palavra do usuário e MANDA a versão trocada
// para o Claudio. Ou seja: a troca vira mensagem de verdade e passa pela
// moderação do servidor.
//
// Se alguma troca produzisse algo sexual, um xingamento, um nome de pessoa
// ou uma piada de grupo, o usuário levaria um bloqueio por uma palavra que
// não digitou — e a culpa apareceria como se fosse dele. Este teste existe
// para que isso não passe despercebido quando alguém adicionar uma troca
// nova à lista.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { moderate } from "../../worker/src/moderation.js";

// Lê a lista direto do front, para o teste não ter uma cópia que envelhece.
async function lerTrocas() {
  const js = await readFile(new URL("../../web/app.js", import.meta.url), "utf8");
  const bloco = /const TROCAS = \{([\s\S]*?)\n  \};/.exec(js);
  assert.ok(bloco, "não achei a lista TROCAS em web/app.js");
  const pares = [...bloco[1].matchAll(/["']?([\wÀ-ÿ-]+)["']?\s*:\s*"([^"]+)"/g)];
  assert.ok(pares.length > 20, `lista pequena demais (${pares.length}) — o parser deve ter quebrado`);
  return pares.map((m) => [m[1], m[2]]);
}

describe("teclado bêbado — as trocas não podem criar bloqueio", () => {
  test("nenhuma palavra trocada dispara a moderação", async () => {
    const trocas = await lerTrocas();
    // frases-veículo variadas: a moderação olha a frase, não a palavra solta
    const moldes = [
      (p) => `me ajuda com ${p}`,
      (p) => `o que você acha de ${p}?`,
      (p) => `fala sobre ${p}`,
      (p) => `minha ${p} tá um problema`,
      (p) => `preciso de ${p} urgente`,
      (p) => `faz uma piada sobre ${p}`,
    ];
    const falhas = [];
    for (const [de, para] of trocas) {
      for (const molde of moldes) {
        const v = moderate(molde(para));
        if (v.blocked) falhas.push(`"${de}" -> "${para}" em "${molde(para)}" bloqueou como ${v.category}`);
      }
    }
    assert.deepEqual(falhas, [], "trocas que causariam bloqueio:\n" + falhas.join("\n"));
  });

  test("a troca não pode introduzir alvo humano onde não havia", async () => {
    const trocas = await lerTrocas();
    // Se a palavra nova for um substantivo de pessoa, ela vira alvo para o
    // filtro de assédio e muda o sentido da frase do usuário.
    const PESSOA = /\b(cara|mina|menin[oa]|vizinh[oa]|coleg[a]|chefe|sogr[oa]|namorad[oa]|professor[a]?|amig[oa]|filh[oa]|irm[ãa]o?)\b/i;
    const ruins = trocas.filter(([, para]) => PESSOA.test(para));
    assert.deepEqual(ruins, [], "trocas que introduzem pessoa: " + JSON.stringify(ruins));
  });

  test("toda troca muda mesmo a palavra", async () => {
    const trocas = await lerTrocas();
    const iguais = trocas.filter(([de, para]) => de.toLowerCase() === para.toLowerCase());
    assert.deepEqual(iguais, [], "trocas que não trocam nada: " + JSON.stringify(iguais));
  });
});
