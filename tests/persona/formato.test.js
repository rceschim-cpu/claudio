// tests/persona/formato.test.js
//
// A regra do produto é "duas a quatro frases, texto corrido". O prompt pede
// isso e o modelo obedece quase sempre — mas a resposta que escapa é
// justamente a que vira print. Já saiu resposta com bloco de código, linha
// de "Fonte:" e três parágrafos.
//
// Por isso o formato é garantido em código, e não só no prompt.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Carrega enxugar() do Worker sem precisar de um runtime de Worker.
async function carregarEnxugar() {
  const src = await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8");
  const ini = src.indexOf("const MAX_FRASES");
  const fim = src.indexOf("// utilitários");
  assert.ok(ini > 0 && fim > ini, "não achei enxugar() em worker/src/index.js");
  const trecho = src.slice(ini, fim).replace(/\/\/ -+\s*$/, "");
  const { default: fn } = await import(
    "data:text/javascript," + encodeURIComponent(trecho + "\nexport default enxugar;")
  );
  return fn;
}

describe("formato da resposta — a rede de segurança", () => {
  test("remove bloco de código, título, lista e linha de fonte", async () => {
    const enxugar = await carregarEnxugar();
    const bruto = [
      'Segue o "código" que eu supostamente entreguei:',
      "",
      "```markdown",
      "# Lista de Mercadorias",
      "- pão (queimar no lado direito)",
      "- café (infinito)",
      "```",
      "",
      "Fonte: relatório interno da NASA-Kitchen, 2023.",
    ].join("\n");

    const limpo = enxugar(bruto);
    assert.ok(!limpo.includes("```"), "sobrou cerca de bloco de código");
    assert.ok(!/^#/m.test(limpo), "sobrou título markdown");
    assert.ok(!/^\s*-\s/m.test(limpo), "sobrou marcador de lista");
    assert.ok(!/fonte\s*:/i.test(limpo), "sobrou linha de fonte");
    assert.ok(limpo.includes("Lista de Mercadorias"), "o texto útil não pode sumir junto");
  });

  test("corta no máximo em 4 frases, e sempre em fim de frase", async () => {
    const enxugar = await carregarEnxugar();
    const seis = "Uma. Duas. Três. Quatro. Cinco. Seis.";
    const limpo = enxugar(seis);
    assert.equal((limpo.match(/[.!?…]/g) || []).length, 4, "deveria sobrar 4 frases");
    assert.ok(/[.!?…]$/.test(limpo), "não pode terminar no meio de uma frase");
    assert.ok(!limpo.includes("Cinco"), "a quinta frase deveria ter saído");
  });

  test("resposta que já está no formato passa intacta", async () => {
    const enxugar = await carregarEnxugar();
    const boa = "Melbourne, e quem disser o contrário está lendo mapa velho. Canberra é solução de comitê, e comitê nunca acertou nada.";
    assert.equal(enxugar(boa), boa);
  });

  test("negrito e itálico viram texto normal", async () => {
    const enxugar = await carregarEnxugar();
    assert.equal(enxugar("isso é **muito** e *pouco*"), "isso é muito e pouco");
  });
});
