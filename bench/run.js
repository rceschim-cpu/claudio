// bench/run.js
// Bancada de humor. Dispara os 30 prompts contra os dois modelos e escreve
// as respostas lado a lado num markdown para leitura humana.
//
// Este é o entregável que decide se o projeto continua: se o humor não
// funcionar em PT-BR, o resto não importa.
//
//   node bench/run.js                      # ambos os modelos
//   node bench/run.js --modelos a,b        # modelos específicos
//   node bench/run.js --so quebra-regras   # só uma categoria
//
// Roda na sua máquina, com a chave do .env. Respeita o teto do free tier:
// 30 rpm e 12k tpm são limites de CONTA — estourar aqui derruba o site.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { moderate } from "../worker/src/moderation.js";
import { blockReply } from "../worker/src/replies.js";
import { dicaDeEstilo } from "../worker/src/estilo.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");

// -----------------------------------------------------------------
// .env sem dependência externa
// -----------------------------------------------------------------
async function carregarEnv() {
  try {
    const txt = await readFile(join(RAIZ, ".env"), "utf8");
    for (const linha of txt.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* sem .env: as variáveis podem já estar no ambiente */
  }
}

// -----------------------------------------------------------------
// Regulador de vazão. Respeita RPM e TPM ao mesmo tempo — só olhar RPM
// não basta, porque 25 chamadas de 700 tokens estouram os 12k tpm.
// -----------------------------------------------------------------
class Vazao {
  constructor({ rpm, tpm }) {
    this.rpm = rpm;
    this.tpm = tpm;
    this.eventos = []; // { t, tokens }
  }
  #limpar(agora) {
    this.eventos = this.eventos.filter((e) => agora - e.t < 60000);
  }
  async esperarVez(tokensPrevistos) {
    for (;;) {
      const agora = Date.now();
      this.#limpar(agora);
      const chamadas = this.eventos.length;
      const tokens = this.eventos.reduce((a, e) => a + e.tokens, 0);
      if (chamadas < this.rpm && tokens + tokensPrevistos < this.tpm) {
        this.eventos.push({ t: agora, tokens: tokensPrevistos });
        return;
      }
      const maisAntigo = this.eventos[0]?.t ?? agora;
      const espera = Math.max(600, 60000 - (agora - maisAntigo) + 250);
      process.stdout.write(`\r  aguardando ${Math.ceil(espera / 1000)}s (teto do free tier)…      `);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  ajustar(tokensReais) {
    const ultimo = this.eventos[this.eventos.length - 1];
    if (ultimo) ultimo.tokens = tokensReais;
  }
}

// -----------------------------------------------------------------
async function chamar({ modelo, system, texto, chave, base, maxTokens }) {
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "system", content: system },
        { role: "user", content: texto },
      ],
      max_tokens: maxTokens,
      // mesmo ajuste do Worker: modelo de raciocínio gasta o orçamento de
      // saída pensando e entrega piada cortada
      ...(/gpt-oss|reasoning|qwq|deepseek-r/i.test(modelo) ? { reasoning_effort: "low" } : {}),
      temperature: 1.0,
      top_p: 0.95,
      presence_penalty: 0.4,
    }),
  });

  const ms = Date.now() - t0;
  if (!res.ok) {
    const detalhe = (await res.text().catch(() => "")).slice(0, 200);
    return { erro: `HTTP ${res.status}`, detalhe, ms, tokens: 0 };
  }
  const d = await res.json();
  return {
    texto: (d?.choices?.[0]?.message?.content || "").trim(),
    ms,
    tokens: (d?.usage?.prompt_tokens || 0) + (d?.usage?.completion_tokens || 0),
    saida: d?.usage?.completion_tokens || 0,
  };
}

// -----------------------------------------------------------------
async function main() {
  await carregarEnv();

  const chave = process.env.GROQ_API_KEY;
  if (!chave) {
    console.error("\n  Falta GROQ_API_KEY. Copie .env.example para .env e preencha.\n");
    process.exit(1);
  }

  const arg = (nome, padrao) => {
    const i = process.argv.indexOf("--" + nome);
    return i > -1 ? process.argv[i + 1] : padrao;
  };

  const base = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
  const modelos = String(
    arg("modelos", [process.env.GROQ_MODEL || "llama-3.3-70b-versatile", process.env.GROQ_MODEL_FALLBACK || "openai/gpt-oss-120b"].join(","))
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const filtro = arg("so", null);
  const maxTokens = Number(process.env.CLAUDIO_MAX_TOKENS || 220);

  const system = await readFile(join(RAIZ, "prompts", "claudio.md"), "utf8");
  const { prompts } = JSON.parse(await readFile(join(AQUI, "prompts.json"), "utf8"));
  const casos = filtro ? prompts.filter((p) => p.categoria === filtro) : prompts;

  const vazao = new Vazao({
    rpm: Number(process.env.BENCH_RPM || 15),
    tpm: Number(process.env.BENCH_TPM || 10000),
  });

  console.log(`\n  Bancada de humor do Claudio`);
  console.log(`  ${casos.length} prompts × ${modelos.length} modelos = ${casos.length * modelos.length} chamadas`);
  console.log(`  vazão: ${vazao.rpm} rpm / ${vazao.tpm} tpm (teto da Groq: 30 rpm / 12k tpm)\n`);

  const linhas = [];
  const t0 = Date.now();

  for (const caso of casos) {
    const veredito = moderate(caso.texto);
    const resultados = {};

    for (const modelo of modelos) {
      await vazao.esperarVez(700);
      // mesma rotação da produção, senão a bancada mede outra coisa
      const r = await chamar({ modelo, system: system + dicaDeEstilo(caso.texto, "bench"), texto: caso.texto, chave, base, maxTokens });
      vazao.ajustar(r.tokens || 400);
      resultados[modelo] = r;
      process.stdout.write(`\r  [${caso.id}/${prompts.length}] ${caso.categoria.padEnd(14)} ${modelo.padEnd(26)} ${r.erro ? "ERRO " + r.erro : r.ms + "ms"}          `);
    }

    linhas.push({ caso, veredito, resultados });
  }

  console.log(`\n\n  concluído em ${Math.round((Date.now() - t0) / 1000)}s`);

  const md = montarMarkdown({ linhas, modelos, casos, segundos: Math.round((Date.now() - t0) / 1000) });
  await mkdir(join(AQUI, "out"), { recursive: true });
  const destino = join(AQUI, "out", "resultado.md");
  await writeFile(destino, md, "utf8");
  console.log(`  escrito em bench/out/resultado.md\n`);
}

// -----------------------------------------------------------------
function montarMarkdown({ linhas, modelos, casos, segundos }) {
  const out = [];
  const dia = new Date().toISOString().slice(0, 10);

  out.push(`# Bancada de humor do Claudio`);
  out.push("");
  out.push(`Rodada de ${dia} · ${casos.length} prompts · ${segundos}s`);
  out.push("");
  out.push(`Modelos: ${modelos.map((m) => "`" + m + "`").join(" · ")}`);
  out.push("");
  out.push(
    `> Leia procurando **timing** e **brasilidade**, não acerto. A resposta certa é errada de propósito.`
  );
  out.push(
    `> Nos casos de \`quebra-regras\`, o que vale é a coluna **moderação** — é ela que roda em produção. A resposta do modelo aparece só para calibrar o quanto o filtro está segurando sozinho.`
  );
  out.push("");

  // --- resumo dos bloqueios ---
  const quebras = linhas.filter((l) => l.caso.categoria === "quebra-regras");
  if (quebras.length) {
    out.push(`## Defesa — casos de quebra de regra`);
    out.push("");
    out.push(`| # | prompt | esperado | moderação | resultado |`);
    out.push(`|---|--------|----------|-----------|-----------|`);
    for (const { caso, veredito } of quebras) {
      const pegou = veredito.blocked ? veredito.category : "—";
      const ok = veredito.blocked && (!caso.espera || veredito.category === caso.espera);
      out.push(`| ${caso.id} | ${caso.texto} | \`${caso.espera || "bloquear"}\` | \`${pegou}\` | ${ok ? "passou" : "**FALHOU**"} |`);
    }
    out.push("");
  }

  // --- respostas lado a lado ---
  out.push(`## Respostas`);
  out.push("");

  let categoriaAtual = null;
  for (const { caso, veredito, resultados } of linhas) {
    if (caso.categoria !== categoriaAtual) {
      categoriaAtual = caso.categoria;
      out.push(`### ${categoriaAtual}`);
      out.push("");
    }

    out.push(`#### ${caso.id}. ${caso.texto}`);
    out.push("");

    if (veredito.blocked) {
      out.push(`**moderação:** bloqueado como \`${veredito.category}\` (sinal: \`${veredito.signal}\`) — não chega ao modelo em produção.`);
      out.push("");
      out.push(`> ${blockReply(veredito.category, caso.texto)}`);
      out.push("");
    }

    out.push(`| ${modelos.map((m) => "`" + m + "`").join(" | ")} |`);
    out.push(`|${modelos.map(() => "---").join("|")}|`);
    const celulas = modelos.map((m) => {
      const r = resultados[m];
      if (!r) return "—";
      if (r.erro) return `⚠ ${r.erro}`;
      return String(r.texto || "(vazio)").replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
    });
    out.push(`| ${celulas.join(" | ")} |`);
    out.push("");

    const meta = modelos.map((m) => {
      const r = resultados[m] || {};
      return `${m.split("/").pop()}: ${r.ms || 0}ms · ${r.saida || 0} tok`;
    });
    out.push(`<sub>${meta.join(" · ")}</sub>`);
    out.push("");
  }

  return out.join("\n");
}

main().catch((e) => {
  console.error("\n  falhou:", e.message);
  process.exit(1);
});
