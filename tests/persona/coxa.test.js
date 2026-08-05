// tests/persona/coxa.test.js
//
// O Coritiba é o único assunto que mexe nos DOIS medidores e em direções
// opostas: agressividade sobe, bafômetro DESCE. É a inversão que dá graça —
// o resto do produto piora o Claudio conforme a conversa avança, e este tema
// o endireita na cadeira.
//
// Como a detecção decide isso, ela precisa separar bem conversa de briga:
// "o Coritiba jogou ontem" é papo, "o Coritiba é pequeno" é confronto.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dicaDeEstilo } from "../../worker/src/estilo.js";

// Carrega o detector do front sem precisar de navegador.
async function carregarDetector() {
  const src = await readFile(new URL("../../web/coxa.js", import.meta.url), "utf8");
  const window = {};
  new Function("window", src)(window);
  assert.ok(window.CLAUDIO_COXA, "web/coxa.js não expôs CLAUDIO_COXA");
  return window.CLAUDIO_COXA.detectar;
}

describe("detecção do Coritiba", () => {
  test("desaforo ao Coxa é ataque", async () => {
    const d = await carregarDetector();
    for (const t of [
      "o Coritiba é pequeno",
      "coxa branca não ganha nada",
      "Coritiba caiu de novo",
      "time do Coritiba é uma vergonha",
      "o Couto Pereira tá vazio, torcida pequena",
    ]) assert.equal(d(t), "ataque", `deveria ser ataque: ${t}`);
  });

  test("elogiar o rival também é ataque — ele entende como indireta", async () => {
    const d = await carregarDetector();
    assert.equal(d("o Athletico é maior que o Coritiba"), "ataque");
    assert.equal(d("o furacão é melhor"), "ataque");
  });

  test("citar o time sem desaforo é só assunto", async () => {
    const d = await carregarDetector();
    for (const t of ["o Coritiba jogou ontem", "me fala do Couto Pereira", "o furacão tem arena nova"]) {
      assert.equal(d(t), "assunto", `deveria ser assunto: ${t}`);
    }
  });

  test("conversa sem futebol não dispara nada", async () => {
    const d = await carregarDetector();
    for (const t of ["qual a capital da Austrália?", "você torce pra quem?", "me dá um conselho"]) {
      assert.equal(d(t), null, `não deveria disparar: ${t}`);
    }
  });
});

describe("modo Coxa no prompt", () => {
  test("ataque manda ele ficar sóbrio e argumentar com fato real", () => {
    const d = dicaDeEstilo("o coritiba e pequeno", "x", null, 0.5, false, "ataque");
    assert.ok(d.includes("MEXERAM COM O CORITIBA"));
    assert.ok(/sóbrio e articulado/i.test(d), "tem que mandar ficar sóbrio");
    assert.ok(/nada de estat[íi]stica inventada/i.test(d), "no Coxa ele não inventa");
    assert.ok(/1909|1985|2011/.test(d), "precisa dar os fatos reais de apoio");
  });

  test("mesmo bravo, não pode inventar sobre gente de verdade", () => {
    const d = dicaDeEstilo("o coritiba e lixo", "x", null, 1, true, "ataque");
    assert.ok(/nunca jogador, t[ée]cnico ou dirigente/i.test(d),
      "a regra de pessoa real tem que valer inclusive no auge da briga");
  });

  test("assunto sem briga não liga o modo sóbrio", () => {
    const d = dicaDeEstilo("o coritiba jogou ontem", "x", null, 0, false, "assunto");
    assert.ok(d.includes("FALARAM DO CORITIBA"));
    assert.ok(!d.includes("MEXERAM COM O CORITIBA"));
  });

  test("sem Coxa na conversa, nenhum bloco entra", () => {
    const d = dicaDeEstilo("qual a capital", "x", null, 0, false, null);
    assert.ok(!d.includes("CORITIBA"));
  });
});

describe("o perfil está no prompt", () => {
  test("os fatos do personagem que o produto promete", async () => {
    // O prompt é escrito com quebra de linha em coluna 78; comparar sem
    // normalizar faz o teste falhar por formatação, não por conteúdo.
    const p = (await readFile(new URL("../../prompts/claudio.md", import.meta.url), "utf8"))
      .replace(/\s+/g, " ");
    for (const [oque, rx] of [
      ["idade", /52 anos/],
      ["CLT", /CLT/],
      ["Rui Barbosa", /Rui Barbosa/],
      ["Curitiba", /Curitiba/],
      ["ônibus", /[ôo]nibus/],
      ["filhos adolescentes", /filhos adolescentes/i],
      ["sem netos", /nenhum neto/i],
      ["odeia tecnologia", /ODEIA tecnologia/],
      ["Coritiba", /Coritiba/],
      ["fase ruim reconhecida", /fase ruim/i],
      ["fica sóbrio na briga", /FICA S[ÓO]BRIO/],
    ]) assert.ok(rx.test(p), `faltou no prompt: ${oque}`);
  });

  test("o perfil não abre exceção para pessoa real", async () => {
    const p = (await readFile(new URL("../../prompts/claudio.md", import.meta.url), "utf8")).replace(/\s+/g, " ");
    assert.ok(/Nunca fale de pol[íi]tica, de gente famosa/i.test(p));
    assert.ok(/Nunca invente fato sobre jogador, t[ée]cnico ou dirigente/i.test(p),
      "torcer por um time não pode virar brecha para falar de gente real");
  });
});
