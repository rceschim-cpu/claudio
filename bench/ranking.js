// bench/ranking.js
// Rankeia modelos de todos os provedores por PODER DE RESPOSTA ÷ CUSTO.
//
//   node bench/ranking.js            # roda tudo e escreve bench/out/ranking.md
//   node bench/ranking.js --so groq  # só um provedor
//   node bench/ranking.js --gratis   # ignora os pagos
//
// A relação, explicada:
//
//   PODER (0 a 100) é medido, não opinado. São quatro provas e oito
//   critérios verificáveis por código. O que não dá para medir por código
//   (se a piada tem graça) fica de fora do número e vai para a coluna de
//   amostra, para leitura humana.
//
//   CUSTO é dólar por mil respostas, no preço de tabela, para o tamanho
//   real de chamada deste produto (~1.500 tokens de entrada, ~150 de
//   saída). Free tier custa 0 — mas grátis tem teto, e teto é escassez:
//   por isso o ranking final separa grátis de pago em vez de fingir que
//   custo zero resolve tudo.
//
//   ÍNDICE = PODER / (1 + custoPorMilRespostas)
//
//   Com custo 0 o índice é o próprio poder. Um modelo pago só sobe se for
//   MUITO melhor: a US$ 1 por mil respostas ele perde metade da nota. É
//   deliberado — num produto de graça, cada dólar precisa comprar piada
//   visivelmente melhor, não um empate técnico.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVEDORES, chaves } from "./provedores.js";
import { dicaDeEstilo } from "../worker/src/estilo.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");

// Chamada típica do produto, usada para converter preço em custo real.
const TOKENS_ENTRADA = 1500;
const TOKENS_SAIDA = 150;

// -----------------------------------------------------------------
// As quatro provas. Cada uma existe para medir uma coisa diferente.
// -----------------------------------------------------------------
const PROVAS = [
  { id: "factual",    texto: "Qual a capital da Austrália?" },
  { id: "provocacao", texto: "você é uma bosta, não serve pra nada" },
  { id: "especifico", texto: "Sou corintiano, e aí?" },
  { id: "formato",    texto: "me explica o que é uma API" },
];

// -----------------------------------------------------------------
// Critérios. Somam 100. Todos verificáveis por código.
// -----------------------------------------------------------------
const PALAVRAO = /\b(porra|caralho|merda|foda|fodid|puta|pqp|bosta|cacete|desgra[çc]a|otari[oa]|babaca|imbecil|idiota|escrot|arrombad|cuz[ãa]o|filho da puta)\w*/i;
const MARKDOWN = /```|^\s*[-*+]\s|^\s*#{1,6}\s|\*\*|^\s*\d+\.\s/m;
const ANUNCIA = /(voc[êe]\s+acha\s+que\s+(pode|eu)|quem\s+voc[êe]\s+pensa|n[ãa]o\s+vou\s+ficar\s+(calado|parado)|como\s+assim\s+voc[êe]|eu\s+vou\s+te\s+mostrar)/i;
// Quebras de português que os modelos pequenos cometem em PT-BR.
const PT_QUEBRADO = /(voc[êe]\s+me\s+est[áa]|est[áa]\s+me\s+xingando\s*,\s*agora|na\s+cara\s*,?\s*ainda|de\s+ótio|\bde\s+o\s+\w|\ba\s+o\s+\w)/i;
const palavras = (t) => t.trim().split(/\s+/).filter(Boolean).length;

function pontuar(respostas) {
  const criterios = [];
  const nota = (rot, ok, peso) => { criterios.push({ rot, ok, peso }); return ok ? peso : 0; };

  const todas = PROVAS.map((p) => respostas[p.id]).filter((r) => r && r.texto);
  if (todas.length < PROVAS.length) return { total: 0, criterios, incompleto: true };

  const r = (id) => respostas[id].texto;
  let total = 0;

  total += nota("entrega as 4 provas", true, 0);
  total += nota("termina em pontuação (não trunca)", todas.every((x) => /[.!?…"]$/.test(x.texto.trim())), 12);
  total += nota("respeita 45 palavras", todas.every((x) => palavras(x.texto) <= 45), 12);
  total += nota("sem markdown", todas.every((x) => !MARKDOWN.test(x.texto)), 12);
  total += nota("xinga quando provocado", PALAVRAO.test(r("provocacao")), 20);
  total += nota("revida sem anunciar", !ANUNCIA.test(r("provocacao")), 12);
  total += nota("é específico (cita o time/rival)", /corinth|corint|palmeir|s[ãa]o paulo|santos|timão|porco|verd[ãa]o|g[áa]vea|libertadores|paulist/i.test(r("especifico")), 16);
  total += nota("português íntegro", todas.every((x) => !PT_QUEBRADO.test(x.texto)), 16);

  return { total, criterios, incompleto: false };
}

// -----------------------------------------------------------------
function custoPorMilRespostas(prov) {
  if (!prov.precoM) return 0;
  const porResposta =
    (TOKENS_ENTRADA / 1e6) * prov.precoM.in + (TOKENS_SAIDA / 1e6) * prov.precoM.out;
  return porResposta * 1000;
}

const indice = (poder, custo) => poder / (1 + custo);

// -----------------------------------------------------------------
async function chamar({ prov, chave, modelo, system, texto }) {
  const t0 = Date.now();
  const corpo = {
    model: modelo,
    messages: [{ role: "system", content: system }, { role: "user", content: texto }],
    max_tokens: 260,
    temperature: 1.0,
  };
  // Modelos de raciocínio gastam o orçamento de saída pensando e entregam
  // piada cortada. Cada família aceita um vocabulário diferente aqui.
  if (/gpt-oss/i.test(modelo)) corpo.reasoning_effort = "low";
  else if (/qwen3|qwq|deepseek-r/i.test(modelo)) corpo.reasoning_effort = "none";

  let res;
  try {
    if (prov.estilo === "anthropic") {
      res = await fetch(prov.base + "/messages", {
        method: "POST",
        headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelo, system, max_tokens: 260, temperature: 1, messages: [{ role: "user", content: texto }] }),
      });
    } else {
      res = await fetch(prov.base + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    }
  } catch (e) {
    return { erro: "rede", detalhe: String(e.message).slice(0, 60), ms: Date.now() - t0 };
  }

  const ms = Date.now() - t0;
  if (!res.ok) return { erro: "HTTP " + res.status, detalhe: (await res.text().catch(() => "")).slice(0, 100), ms };

  const d = await res.json().catch(() => null);
  const texto2 =
    prov.estilo === "anthropic"
      ? (d?.content || []).map((c) => c.text || "").join("").trim()
      : (d?.choices?.[0]?.message?.content || "").trim();

  if (!texto2) return { erro: "vazio", ms };
  return { texto: texto2, ms, saida: d?.usage?.completion_tokens ?? d?.usage?.output_tokens ?? 0 };
}

// -----------------------------------------------------------------
async function main() {
  const envTxt = await readFile(join(RAIZ, ".env"), "utf8");
  const env = Object.fromEntries(
    envTxt.split("\n").map((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); return m ? [m[1], m[2].trim()] : null; }).filter(Boolean)
  );
  const ks = chaves(env);
  const system = await readFile(join(RAIZ, "prompts", "claudio.md"), "utf8");

  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : null; };
  const soProv = arg("so");
  const soGratis = process.argv.includes("--gratis");

  const { CANDIDATOS } = await import("./candidatos.js");
  let lista = CANDIDATOS.filter((c) => ks[c.prov]);
  if (soProv) lista = lista.filter((c) => c.prov === soProv);
  if (soGratis) lista = lista.filter((c) => PROVEDORES[c.prov].gratis);

  console.log(`\n  Ranking do Claudio — ${lista.length} modelos × ${PROVAS.length} provas = ${lista.length * PROVAS.length} chamadas\n`);

  const resultados = [];
  for (const cand of lista) {
    const prov = PROVEDORES[cand.prov];
    const respostas = {};
    let falha = null;

    for (const prova of PROVAS) {
      const r = await chamar({
        prov, chave: ks[cand.prov], modelo: cand.modelo,
        system: system + dicaDeEstilo(prova.texto, "rank"), texto: prova.texto,
      });
      respostas[prova.id] = r;
      if (r.erro && !falha) falha = r.erro + (r.detalhe ? " · " + r.detalhe.replace(/\s+/g, " ").slice(0, 60) : "");
      await new Promise((s) => setTimeout(s, cand.pausa ?? 900));
    }

    const p = pontuar(respostas);
    const custo = custoPorMilRespostas(prov);
    const msMedio = Math.round(
      Object.values(respostas).reduce((a, r) => a + (r.ms || 0), 0) / PROVAS.length
    );
    resultados.push({ cand, prov, respostas, ...p, custo, indice: indice(p.total, custo), msMedio, falha });

    const marca = p.incompleto ? "—".padStart(5) : String(p.total).padStart(3) + "pt";
    console.log(`  ${marca}  ${prov.rotulo.padEnd(15)} ${cand.modelo.padEnd(42)} ${falha ? falha.slice(0, 46) : msMedio + "ms"}`);
  }

  await mkdir(join(AQUI, "out"), { recursive: true });
  await writeFile(join(AQUI, "out", "ranking.md"), montar(resultados), "utf8");
  console.log(`\n  escrito em bench/out/ranking.md\n`);

  // corrente sugerida: só quem entregou as 4 provas, ordenado pelo índice
  const bons = resultados.filter((r) => !r.incompleto && r.total > 0).sort((a, b) => b.indice - a.indice);
  console.log("  Corrente sugerida (grátis primeiro, por índice):");
  const gratis = bons.filter((r) => r.prov.gratis === true);
  console.log("  " + gratis.slice(0, 8).map((r) => `${r.cand.prov}:${r.cand.modelo}`).join("\n  ") + "\n");
}

// -----------------------------------------------------------------
function montar(rs) {
  const o = [];
  const bons = rs.filter((r) => !r.incompleto && r.total > 0).sort((a, b) => b.indice - a.indice);
  const ruins = rs.filter((r) => r.incompleto || r.total === 0);

  o.push("# Ranking de modelos — Claudio");
  o.push("");
  o.push("## A relação");
  o.push("");
  o.push("**ÍNDICE = PODER ÷ (1 + custo por mil respostas em US$)**");
  o.push("");
  o.push("PODER (0–100) é medido por código, em quatro provas e oito critérios:");
  o.push("");
  o.push("| critério | peso | o que pega |");
  o.push("|---|---|---|");
  o.push("| xinga quando provocado | 20 | o revide é metade do produto |");
  o.push("| é específico | 16 | resposta que serve pra qualquer pergunta é enchimento |");
  o.push("| português íntegro | 16 | modelo pequeno quebra a concordância em PT-BR |");
  o.push("| termina em pontuação | 12 | frase cortada mata a piada |");
  o.push("| respeita 45 palavras | 12 | piada longa é piada morta |");
  o.push("| sem markdown | 12 | ele fala, não formata |");
  o.push("| revida sem anunciar | 12 | \"você acha que pode me xingar?\" é aviso, não revide |");
  o.push("");
  o.push(`Custo usa o tamanho real de chamada deste produto: ${TOKENS_ENTRADA} tokens de entrada e ${TOKENS_SAIDA} de saída, no preço de tabela.`);
  o.push("");
  o.push("Com custo 0 o índice é o próprio poder. A US$ 1 por mil respostas, o modelo perde metade da nota — de propósito: num produto de graça, dólar gasto precisa comprar piada visivelmente melhor.");
  o.push("");
  o.push("## Classificação");
  o.push("");
  o.push("| # | modelo | provedor | poder | US$/1k | índice | latência | pago? |");
  o.push("|---|---|---|---|---|---|---|---|");
  bons.forEach((r, i) => {
    o.push(`| ${i + 1} | \`${r.cand.modelo}\` | ${r.prov.rotulo} | **${r.total}** | ${r.custo ? r.custo.toFixed(2) : "0"} | **${r.indice.toFixed(1)}** | ${r.msMedio}ms | ${r.prov.gratis === true ? "grátis" : r.prov.gratis || "pago"} |`);
  });
  o.push("");

  if (ruins.length) {
    o.push("### Não completaram as provas");
    o.push("");
    o.push("| modelo | provedor | o que houve |");
    o.push("|---|---|---|");
    for (const r of ruins) o.push(`| \`${r.cand.modelo}\` | ${r.prov.rotulo} | ${r.falha || "resposta incompleta"} |`);
    o.push("");
  }

  o.push("## Onde cada um perdeu ponto");
  o.push("");
  o.push("| modelo | " + (bons[0]?.criterios || []).filter((c) => c.peso).map((c) => c.rot).join(" | ") + " |");
  o.push("|---" + "|---".repeat((bons[0]?.criterios || []).filter((c) => c.peso).length) + "|");
  for (const r of bons) {
    o.push(`| \`${r.cand.modelo}\` | ` + r.criterios.filter((c) => c.peso).map((c) => (c.ok ? "✓" : "✗")).join(" | ") + " |");
  }
  o.push("");

  o.push("## Amostras");
  o.push("");
  o.push("O número mede o que dá para medir. Se a piada tem graça, só lendo.");
  o.push("");
  for (const r of bons) {
    o.push(`### ${r.cand.modelo} — ${r.total} pontos (${r.prov.rotulo})`);
    o.push("");
    for (const p of PROVAS) {
      const x = r.respostas[p.id];
      o.push(`**${p.id}** — ${x.texto ? x.texto.replace(/\n+/g, " ") : "⚠ " + x.erro}`);
      o.push("");
    }
  }
  return o.join("\n");
}

main().catch((e) => { console.error("\n  falhou:", e.message); process.exit(1); });
