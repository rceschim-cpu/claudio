// test/smoke.js
// Testes de fumaça determinísticos (sem rede, sem chaves de API).
// Roda com: npm test   (ou: node test/smoke.js)
// Valida que os módulos carregam e que a lógica pura está correta.

const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}
async function section(name, fn) {
  console.log("\n# " + name);
  try { await fn(); } catch (e) { fail++; console.log("  ✗ exceção: " + e.message); }
}

(async () => {
  // 1. todos os módulos carregam
  await section("módulos carregam", () => {
    for (const m of ["providers", "memory", "skills", "conversations", "router", "discovery", "projects", "analyzer", "pdfreport", "rag", "websearch", "office"]) {
      require("../lib/" + m);
      check("require lib/" + m, true);
    }
    require("../catalog");
    check("require catalog", true);
  });

  // 2. roteamento (o ponto que já deu falso positivo de imagem)
  await section("router.classify", () => {
    const r = require("../lib/router");
    check("pedido de análise+PDF NÃO é image_gen", r.classify("verifica os arquivos duplicados e cria um PDF, é foto ou video") !== "image_gen");
    check("'crie uma imagem de um gato' é image_gen", r.classify("crie uma imagem de um gato") === "image_gen");
    check("código é 'code'", r.classify("tem um bug na minha função python") === "code");
    check("saudação é 'fast'", r.classify("bom dia, tudo bem?") === "fast");
    check("pickAutoChain devolve reason", typeof r.pickAutoChain(require("../catalog").CATALOG, () => true, "oi").reason === "string");
  });

  // 3. memória: extração de tags + roundtrip
  await section("memory", () => {
    const mem = require("../lib/memory");
    const out = mem.processModelOutput('visível <memory name="t-smoke" type="user" desc="x">corpo</memory> fim');
    check("tag <memory> some do texto", !/<memory/.test(out.cleanText) && /visível/.test(out.cleanText));
    check("memória foi salva", out.saved.includes("t-smoke"));
    check("recall encontra a memória", mem.recall("corpo").some((m) => m.name === "t-smoke"));
    check("remove limpa", mem.remove("t-smoke") === true);
  });

  // 4. rag.chunkText
  await section("rag.chunkText", () => {
    const rag = require("../lib/rag");
    const chunks = rag.chunkText("a".repeat(3000), 1100, 160);
    check("divide texto longo em vários pedaços", chunks.length >= 3);
  });

  // 5. office: gera xlsx e docx válidos (ZIP 'PK')
  await section("office", async () => {
    const office = require("../lib/office");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-smoke-"));
    const xlsx = path.join(dir, "t.xlsx"), docx = path.join(dir, "t.docx");
    await office.csvToXlsx("A,B\n1,2", xlsx);
    await office.markdownToDocx("# T\n\n**bold** e lista:\n- x", docx);
    check("xlsx é arquivo ZIP (PK)", fs.readFileSync(xlsx).slice(0, 2).toString() === "PK");
    check("docx é arquivo ZIP (PK)", fs.readFileSync(docx).slice(0, 2).toString() === "PK");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 6. analyzer: detecta duplicados reais por conteúdo
  await section("analyzer", async () => {
    const an = require("../lib/analyzer");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-an-"));
    fs.mkdirSync(path.join(dir, "bkp"));
    fs.writeFileSync(path.join(dir, "a.txt"), "conteudo identico");
    fs.writeFileSync(path.join(dir, "bkp", "a.txt"), "conteudo identico");
    fs.writeFileSync(path.join(dir, "u.txt"), "unico");
    const rep = await an.analyze(dir);
    check("encontra 3 arquivos", rep.totalFiles === 3);
    check("detecta 1 grupo de duplicados", rep.duplicateGroups.length === 1);
    check("ranking por tamanho preenchido", rep.largest.length === 3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 7. discovery.applyOverrides não quebra com catálogo base
  await section("discovery.applyOverrides", () => {
    const disc = require("../lib/discovery");
    const eff = disc.applyOverrides(require("../catalog").CATALOG, { providers: {} });
    check("catálogo efetivo tem provedores", Object.keys(eff).length > 0);
  });

  console.log(`\n${fail === 0 ? "✅" : "❌"} resultado: ${pass} ok, ${fail} falha(s)\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
