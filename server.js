// server.js
// Cowork LLM local — servidor Node/Express.
// Orquestra: roteamento autônomo/manual entre modelos GRÁTIS, memória
// persistente estilo Claude, skills, artefatos e descoberta semanal de modelos.
// Toda chave de API vive só no .env e nunca é enviada ao navegador.

require("dotenv").config();
const express = require("express");
const path = require("path");

const fsmod = require("fs");
const { CATALOG } = require("./catalog");
const providers = require("./lib/providers");
const memory = require("./lib/memory");
const skills = require("./lib/skills");
const conversations = require("./lib/conversations");
const router = require("./lib/router");
const discovery = require("./lib/discovery");
const projects = require("./lib/projects");
const analyzer = require("./lib/analyzer");
const pdfreport = require("./lib/pdfreport");
const rag = require("./lib/rag");
const websearch = require("./lib/websearch");
const office = require("./lib/office");
const git = require("./lib/git");

const app = express();
const PORT = process.env.PORT || 3344;

app.use(express.json({ limit: "16mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Garante as pastas de dados na inicialização.
memory.ensure();
skills.ensure();
conversations.ensure();

// Imagens geradas servidas estaticamente em /generated.
const IMG_DIR = path.join(__dirname, "data", "images");
fsmod.mkdirSync(IMG_DIR, { recursive: true });
app.use("/generated", express.static(IMG_DIR));

// Relatórios (PDF do analisador de pasta) servidos em /reports.
const REPORT_DIR = path.join(__dirname, "data", "reports");
fsmod.mkdirSync(REPORT_DIR, { recursive: true });
app.use("/reports", express.static(REPORT_DIR));

// Arquivos gerados (xlsx/docx) servidos em /files.
const FILES_DIR = path.join(__dirname, "data", "files");
fsmod.mkdirSync(FILES_DIR, { recursive: true });
app.use("/files", express.static(FILES_DIR));

// Extrai <xlsx>/<docx> da resposta e gera os arquivos reais (download).
async function processOfficeTags(text) {
  const files = [];
  let clean = text;
  const tasks = [];
  clean = clean.replace(/<xlsx(?:\s+name="([^"]*)")?\s*>([\s\S]*?)<\/xlsx>/gi, (_m, name, body) => {
    tasks.push({ kind: "xlsx", name: (name || "planilha").replace(/[^a-z0-9._-]/gi, "_"), body });
    return "";
  });
  clean = clean.replace(/<docx(?:\s+name="([^"]*)")?\s*>([\s\S]*?)<\/docx>/gi, (_m, name, body) => {
    tasks.push({ kind: "docx", name: (name || "documento").replace(/[^a-z0-9._-]/gi, "_"), body });
    return "";
  });
  clean = clean.replace(/<pptx(?:\s+name="([^"]*)")?\s*>([\s\S]*?)<\/pptx>/gi, (_m, name, body) => {
    tasks.push({ kind: "pptx", name: (name || "apresentacao").replace(/[^a-z0-9._-]/gi, "_"), body });
    return "";
  });
  for (const t of tasks) {
    const base = t.name.replace(/\.(xlsx|docx|pptx|csv|md|txt|doc|xls|ppt)$/i, "");
    const file = `${base}-${Date.now().toString(36)}.${t.kind}`;
    const out = path.join(FILES_DIR, file);
    try {
      if (t.kind === "xlsx") await office.csvToXlsx(t.body.trim(), out, { sheetName: base });
      else if (t.kind === "docx") await office.markdownToDocx(t.body.trim(), out, { title: base });
      else await office.markdownToPptx(t.body.trim(), out, { title: base });
      files.push({ name: `${base}.${t.kind}`, url: `/files/${file}`, kind: t.kind });
    } catch (e) { /* ignora arquivo malformado */ }
  }
  return { cleanText: clean.trim(), files };
}

// Catálogo efetivo = base + overrides da descoberta.
function effectiveCatalog() {
  return discovery.applyOverrides(CATALOG);
}

// -----------------------------------------------------------------
// GET /api/catalog — catálogo efetivo + se cada provedor tem chave + saúde
// -----------------------------------------------------------------
app.get("/api/catalog", (req, res) => {
  const cat = effectiveCatalog();
  const health = router.healthSnapshot();
  const out = {};
  for (const [providerId, provider] of Object.entries(cat)) {
    out[providerId] = {
      label: provider.label,
      color: provider.color,
      docsUrl: provider.docsUrl,
      hasKey: providers.hasKey(providerId),
      knownIssue: provider.knownIssue || null,
      health: health[providerId] || { status: "unknown" },
      models: provider.models,
    };
  }
  res.json(out);
});

// -----------------------------------------------------------------
// Construção do system prompt — injeta persona + memória + skills.
// -----------------------------------------------------------------
function buildSystemPrompt(lastUserText, { skillBodies = [], project = null, context = null, sources = null, web = false, autoApply = false } = {}) {
  const recalled = memory.recall(lastUserText, 6);
  const memoryBlock = recalled.length
    ? recalled
        .map((m) => `### memória: ${m.name} (${m.type})\n${m.body}`)
        .join("\n\n")
    : "(nenhuma memória relevante para esta mensagem)";

  const parts = [
    "Você é um cowork de IA local, direto, honesto e prático. Responde em português do Brasil por padrão.",
    "",
    "## Como entregar arquivos (REGRA IMPORTANTE)",
  ];

  if (project) {
    // pasta conectada → SEMPRE salvar nela, nunca gerar bloco para download
    parts.push(
      `Há uma pasta de projeto conectada ("${project.name}"). Ao criar ou editar QUALQUER arquivo, você DEVE salvá-lo na pasta usando a tag <writefile path="...">…</writefile> (detalhada na seção do projeto). NÃO devolva o arquivo como bloco de código para download — salve direto na pasta. Para um trecho curto só para ilustrar, blocos de código normais estão ok.`
    );
  } else {
    // sem pasta → artefato para download/preview
    parts.push(
      "Não há pasta conectada. Quando produzir um arquivo (código, HTML, documento), entregue-o como um bloco de código markdown com a linguagem e o nome do arquivo na primeira linha, ex: ```html index.html. Ele vira um artefato com pré-visualização e download. NÃO tente escrever em disco (não há pasta)."
    );
  }

  parts.push(
    "",
    "## Planilhas e documentos Office",
    "Quando o usuário pedir uma PLANILHA, gere <xlsx name=\"nome\">conteúdo em CSV (primeira linha = cabeçalho)</xlsx>. Quando pedir um documento WORD/.docx, gere <docx name=\"nome\">conteúdo em markdown (títulos #, **negrito**, listas, tabelas)</docx>. Quando pedir uma APRESENTAÇÃO/.pptx, gere <pptx name=\"nome\">slides em markdown, separados por uma linha com --- ; cada slide tem # Título e bullets com -</pptx>. O sistema converte para o arquivo real e oferece download. Não descreva o arquivo em código — emita a tag."
  );

  if (context) {
    parts.push(
      "",
      "## Memória deste chat (OBRIGATÓRIO atualizar)",
      "Esta conversa tem uma memória persistente que você relê a cada turno. REGRA: ao FINAL de TODA resposta, emita obrigatoriamente um bloco <context>…</context> contendo as notas COMPLETAS e atualizadas desta conversa (nome e dados do usuário, decisões, preferências, estado da tarefa, fatos importantes). Reescreva o texto inteiro, não só o que mudou. O bloco é invisível ao usuário. Exemplo: <context>Usuário: Rodrigo. Projeto: cowork local. Preferências: respostas curtas.</context>",
      "",
      "Notas atuais desta conversa:",
      context || "(vazias — comece a preencher agora)",
    );
  }

  parts.push(
    "",
    "## Memória persistente",
    "Você tem memória em disco. Para LEMBRAR de um fato durável (preferência do usuário, contexto de projeto, feedback), emita no final da resposta um bloco:",
    '<memory name="slug-curto" type="user|feedback|project|reference" desc="resumo em uma linha">corpo do fato em markdown</memory>',
    "Para ESQUECER: <forget name=\"slug\"/>. Esses blocos são invisíveis ao usuário. Não repita memórias já existentes abaixo.",
    "",
    "### Índice de memórias (MEMORY.md)",
    memory.indexText().slice(0, 4000),
    "",
    "### Memórias relevantes a esta mensagem",
    memoryBlock,
    "",
    "## Skills disponíveis",
    "Para usar uma skill, escreva <skill name=\"nome\"/> e o sistema injetará as instruções dela. Lista:",
    skills.listText()
  );

  if (project) {
    parts.push(
      "",
      "## Projeto conectado (pasta de trabalho)",
      `Você está trabalhando na pasta "${project.name}". Você PODE ler e escrever arquivos dentro dela usando estas tags (são executadas pelo sistema, invisíveis ao usuário):`,
      '- Listar arquivos: <listfiles/>',
      '- Ler um arquivo: <readfile path="caminho/relativo.ext"/>',
      '- Criar/editar um arquivo: <writefile path="caminho/relativo.ext">CONTEÚDO COMPLETO DO ARQUIVO</writefile>',
      '- Rodar um comando de terminal: <runcommand>comando aqui</runcommand>',
      "Regras de caminho: use SEMPRE caminhos relativos à raiz do projeto. Leituras/listagens voltam para você continuar a tarefa.",
      "",
      "## EDIÇÃO CIRÚRGICA (regra crítica para não destruir arquivos)",
      "O <writefile> grava o ARQUIVO INTEIRO. Por isso, para mudar UM detalhe você DEVE: (1) LER o arquivo atual com <readfile> primeiro; (2) reescrevê-lo IDÊNTICO, alterando APENAS o trecho pedido. PRESERVE todo o resto exatamente como está — não 'melhore', não reescreva, não reformate, não troque o estilo/framework, não apague funções/CSS/HTML que não têm relação com o pedido. Se o usuário pede uma mudança pequena, a saída deve diferir do original em pouquíssimas linhas. NUNCA recrie um arquivo do zero por causa de uma alteração pontual. Edite só um arquivo por vez quando possível.",
      autoApply
        ? "Modo AUTÔNOMO: suas escritas e comandos são aplicados/executados na hora, sem aprovação. Aja com cuidado — releia o arquivo antes de sobrescrever. Após escrever/rodar, você recebe o resultado para verificar e continuar até concluir; ao final, explique o que fez."
        : "Modo REVISÃO: escritas e comandos NÃO são aplicados automaticamente — o usuário revisa o diff e aprova. Proponha a escrita/comando e dê uma resposta final explicando o que fez e por quê.",
      ...(project.git ? ["", `### Git: ${project.git}`, "Para versionar, use <runcommand>git ...</runcommand>. O commit também pode ser feito pelo painel Git."] : []),
      "",
      "### Árvore de arquivos do projeto",
      (project.files || []).join("\n").slice(0, 6000) || "(vazia)",
    );
  }

  if (web) {
    parts.push(
      "",
      "## Acesso à web (use quando precisar de informação atual ou externa)",
      "Você pode pesquisar e ler a web com estas tags (o sistema executa e te devolve o resultado):",
      "- Pesquisar: <websearch>sua consulta</websearch>",
      "- Ler uma página: <webfetch>https://url-completa</webfetch>",
      "Fluxo: pesquise, leia as páginas mais promissoras e então responda CITANDO as fontes com o link (ex.: [título](url)). Não invente URLs nem fatos — se não encontrar, diga.",
    );
  }

  if (sources && sources.length) {
    parts.push(
      "",
      "## Documentos relevantes da pasta (use como fonte e CITE)",
      "Trechos recuperados da pasta conectada por busca semântica. Responda com base neles quando pertinente e cite a fonte assim: [arquivo.ext]. Se a resposta não estiver nos trechos, diga que não encontrou.",
      ...sources.map((s, i) => `--- fonte ${i + 1}: ${s.file} (relevância ${s.score.toFixed(2)}) ---\n${s.text}`)
    );
  }

  if (skillBodies.length) {
    parts.push("", "## Instruções de skills ativadas");
    for (const s of skillBodies) {
      parts.push(`### ${s.name}\n${s.body}`);
    }
  }

  return parts.join("\n");
}

// Extrai "tool calls" baseadas em tags da resposta do modelo.
function extractToolCalls(text) {
  const writes = [];
  const reads = [];
  let lists = false;
  let clean = text;

  clean = clean.replace(/<writefile\s+path\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/writefile>/gi, (_m, p, body) => {
    writes.push({ path: p, content: body.replace(/^\n/, "") });
    return "";
  });
  clean = clean.replace(/<readfile\s+path\s*=\s*"([^"]+)"\s*\/?>(?:<\/readfile>)?/gi, (_m, p) => {
    reads.push(p);
    return "";
  });
  clean = clean.replace(/<listfiles\s*\/?>(?:<\/listfiles>)?/gi, () => {
    lists = true;
    return "";
  });
  const commands = [];
  clean = clean.replace(/<runcommand\s*>([\s\S]*?)<\/runcommand>/gi, (_m, c) => {
    commands.push(c.trim());
    return "";
  });
  const searches = [];
  clean = clean.replace(/<websearch\s*>([\s\S]*?)<\/websearch>/gi, (_m, q) => {
    searches.push(q.trim());
    return "";
  });
  const fetches = [];
  clean = clean.replace(/<webfetch\s*>([\s\S]*?)<\/webfetch>/gi, (_m, u) => {
    fetches.push(u.trim());
    return "";
  });

  return { writes, reads, lists, commands, searches, fetches, cleanText: clean.trim() };
}

// diff simples por linha (para a tela de aprovação)
function lineDiff(oldText, newText) {
  const a = String(oldText || "").split("\n");
  const b = String(newText || "").split("\n");
  // LCS clássico
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: " ", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", line: a[i] }); i++; }
    else { out.push({ t: "+", line: b[j] }); j++; }
  }
  while (i < n) out.push({ t: "-", line: a[i++] });
  while (j < m) out.push({ t: "+", line: b[j++] });
  return out;
}

// Tenta a cadeia com retry em erro transitório, caindo para o próximo elo.
function isTransient(message) {
  return /\b(429|503)\b/.test(message) || /UNAVAILABLE|rate.?limit/i.test(message);
}

async function runChain(chain, messages, systemPrompt) {
  const attempts = [];
  for (let i = 0; i < chain.length; i++) {
    const { provider, modelId } = chain[i];
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await providers.callProvider(provider, modelId, messages, systemPrompt);
        router.recordSuccess(provider);
        return { ok: true, result, level: i, provider, modelId, attempts };
      } catch (err) {
        lastErr = String(err.message || err);
        if (attempt < 2 && isTransient(lastErr)) {
          await new Promise((r) => setTimeout(r, 700 * attempt));
          continue;
        }
        break;
      }
    }
    router.recordFailure(provider, lastErr);
    attempts.push({ provider, modelId, error: lastErr });
  }
  return { ok: false, attempts };
}

// Atualiza as notas de memória do chat de forma INDEPENDENTE do modelo:
// uma passada curta de resumo (modelos grátis nem sempre emitem <context>).
async function summarizeContext(chain, prevContext, userText, assistantText) {
  const sys =
    "Você mantém as NOTAS de memória de uma conversa. Devolva as notas COMPLETAS e atualizadas, " +
    "curtas e em tópicos, capturando: nome/dados do usuário, decisões, preferências e estado da tarefa. " +
    "Responda APENAS com as notas, sem comentários, sem saudação, sem markdown de cabeçalho.";
  const user =
    `NOTAS ATUAIS:\n${prevContext || "(vazias)"}\n\n` +
    `ÚLTIMA TROCA:\nUsuário: ${userText}\nAssistente: ${assistantText}\n\nNotas atualizadas:`;
  const r = await runChain(chain, [{ role: "user", content: user }], sys);
  if (r.ok && r.result.text) return r.result.text.trim().slice(0, 4000);
  return null;
}

// COMPACTAÇÃO DE CONTEXTO: conversas longas estouram o contexto dos modelos
// grátis. Resume as mensagens antigas e mantém as recentes verbatim.
async function compactMessages(messages, chain) {
  const totalChars = messages.reduce((s, m) => s + String(m.content || "").length, 0);
  if (messages.length <= 8 || totalChars < 16000) return { messages, compacted: false };
  const keep = 6;
  const head = messages.slice(0, messages.length - keep);
  const tail = messages.slice(messages.length - keep);
  const toSum = head.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 24000);
  const sys =
    "Resuma a conversa abaixo em tópicos concisos, preservando fatos, decisões, nomes, números, " +
    "arquivos e o que foi pedido. Responda APENAS com o resumo.";
  let summary = "(resumo indisponível)";
  try {
    const r = await runChain(chain, [{ role: "user", content: toSum }], sys);
    if (r.ok && r.result.text) summary = r.result.text.trim();
  } catch {}
  return {
    messages: [{ role: "user", content: `[RESUMO DA CONVERSA ANTERIOR]\n${summary}` }, ...tail],
    compacted: true,
  };
}

// Remove tags de controle de um texto em STREAMING, segurando tags incompletas
// (não mostra <memory>/<context>/<skill>/<think> nem fragmentos parciais).
const STREAM_PAIR = ["memory", "context", "think", "thinking", "writefile", "runcommand", "xlsx", "docx"];
const STREAM_SELF = ["forget", "skill", "readfile", "listfiles"];
function stripForStream(raw) {
  let t = raw;
  // remove blocos pareados completos
  for (const tag of STREAM_PAIR) t = t.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "");
  // remove self-closing completas
  for (const tag of STREAM_SELF) t = t.replace(new RegExp(`<${tag}[^>]*/?>(?:</${tag}>)?`, "gi"), "");
  // segura tag pareada ABERTA mas ainda não fechada → corta a partir dela
  const openPair = t.search(new RegExp(`<(?:${STREAM_PAIR.join("|")})\\b[^>]*>`, "i"));
  if (openPair >= 0) t = t.slice(0, openPair);
  // segura um "<" final que pode ser início de tag de controle
  const lt = t.lastIndexOf("<");
  if (lt >= 0 && /^<[a-z/]*$/i.test(t.slice(lt))) t = t.slice(0, lt);
  return t;
}

// Salva uma imagem (dataUrl base64) em disco e devolve a URL pública.
function saveGeneratedImage(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const ext = m[1].split("/")[1].replace("jpeg", "jpg");
  const name = `img-${Date.now().toString(36)}-${Buffer.byteLength(m[2]) % 9973}.${ext}`;
  fsmod.writeFileSync(path.join(IMG_DIR, name), Buffer.from(m[2], "base64"));
  return `/generated/${name}`;
}

// -----------------------------------------------------------------
// POST /api/chat
// body: { conversationId?, messages, mode, manualChain?, hasImage?,
//         projectId?, forceImage? }
// -----------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { conversationId, messages, mode = "auto", manualChain, projectId, forceImage, autoApply = false, web = false } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages vazio." });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? String(lastUser.content) : "";
  const hasImage = Boolean(lastUser && lastUser.images && lastUser.images.length);
  let convId = conversationId;

  // memória de contexto deste chat (sempre lida), se ligada na conversa
  let contextEnabled = false;
  let convContext = "";
  if (convId) {
    const c = conversations.load(convId);
    if (c && c.contextMemory) { contextEnabled = true; convContext = c.context || ""; }
  }

  // ========== GERAÇÃO DE IMAGEM ==========
  const wantsImage = forceImage || (mode === "auto" && router.classify(lastUserText) === "image_gen");
  if (wantsImage) {
    try {
      const img = await providers.generateImage(lastUserText);
      const url = saveGeneratedImage(img.dataUrl) || img.dataUrl;
      const caption = `🎨 Imagem gerada com ${img.model}.`;
      try {
        if (!convId) convId = conversations.create().id;
        conversations.appendMessages(convId, [
          { role: "user", content: lastUserText },
          { role: "assistant", content: caption, meta: { image: url, imageModel: img.model, category: "image_gen", mode } },
        ]);
      } catch {}
      return res.json({
        ok: true, text: caption, image: url, conversationId: convId,
        usedProviderLabel: "Imagem", usedName: img.model, usedFallbackLevel: 0,
        category: "image_gen", reason: router.CATEGORY_REASON.image_gen, mode, chain: [], attempts: [],
        savedMemories: [], forgotten: [], invokedSkills: [], fileOps: [],
      });
    } catch (err) {
      return res.status(502).json({ ok: false, error: String(err.message || err) });
    }
  }

  // ========== CHAT (com loop agêntico se houver projeto) ==========
  const cat = effectiveCatalog();
  let chain = [];
  let category = null;
  let reason = null;
  if (mode === "manual" && Array.isArray(manualChain) && manualChain.length) {
    chain = manualChain.map((c) => {
      const prov = cat[c.provider];
      const model = prov?.models.find((m) => m.id === c.modelId);
      return { provider: c.provider, modelId: c.modelId, name: model?.name || c.modelId, providerLabel: prov?.label || c.provider, color: prov?.color || "#888" };
    });
    reason = "escolha manual";
  } else {
    const picked = router.pickAutoChain(cat, providers.hasKey, lastUserText, { hasImage });
    category = picked.category;
    reason = picked.reason;
    chain = picked.chain;
  }

  if (!chain.length) {
    return res.status(400).json({ ok: false, error: "Nenhum modelo grátis disponível. Configure ao menos uma chave de API no .env e reinicie." });
  }

  // Contexto de projeto (pasta conectada)
  let project = null;
  if (projectId) {
    try {
      const p = projects.get(projectId);
      if (p) {
        project = { id: p.id, name: p.name, ...projects.tree(p.id) };
        try {
          const gs = await git.status(p.folder);
          if (gs.repo) project.git = `branch ${gs.branch}, ${gs.clean ? "árvore limpa" : gs.files.length + " arquivo(s) com mudanças"}`;
        } catch {}
      }
    } catch {}
  }

  // RAG: se a pasta foi indexada, recupera trechos relevantes (com fonte).
  let sources = null;
  if (projectId && rag.has(projectId)) {
    try { sources = await rag.search(projectId, lastUserText, 6); } catch {}
  }

  // Compactação de contexto (conversas longas).
  const comp = await compactMessages(messages, chain);
  let working = comp.messages.slice();

  // Loop agêntico: o modelo pode ler/listar/escrever arquivos, rodar comandos e skills.
  // Em modo REVISÃO (padrão), escritas e comandos viram AÇÕES PENDENTES (com diff)
  // para o usuário aprovar; em autoApply, escritas são aplicadas direto.
  const reviewMode = project && !autoApply;
  const loadedSkills = [];
  const fileOps = [];
  const pendingActions = [];
  const webRefs = [];
  let run = null;
  let rawText = "";
  // No modo auto-aplicar (auto-programação), permitimos mais iterações para o
  // modelo escrever → rodar comando → ver resultado → corrigir, em loop.
  const MAX_ITERS = (project && autoApply) ? 12 : (project || web ? 5 : 2);

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const systemPrompt = buildSystemPrompt(lastUserText, { skillBodies: loadedSkills, project, context: contextEnabled ? convContext : null, sources, web, autoApply });
    run = await runChain(chain, working, systemPrompt);
    if (!run.ok) {
      return res.status(502).json({ ok: false, error: "Todos os modelos falharam.", attempts: run.attempts, chain });
    }
    rawText = run.result.text;

    // tool calls (arquivos só com projeto; web só com web habilitado)
    const tc = (project || web) ? extractToolCalls(rawText) : { writes: [], reads: [], lists: false, commands: [], searches: [], fetches: [], cleanText: rawText };
    if (!project) { tc.writes = []; tc.reads = []; tc.lists = false; tc.commands = []; }
    if (!web) { tc.searches = []; tc.fetches = []; }

    // escritas: revisão → pendente (com diff); autoApply → aplica
    for (const w of tc.writes) {
      if (reviewMode) {
        let oldContent = "";
        try { oldContent = projects.readFile(project.id, w.path).content; } catch {}
        pendingActions.push({ type: "write", path: w.path, oldContent, newContent: w.content, diff: lineDiff(oldContent, w.content) });
      } else {
        try { const r = projects.writeFile(project.id, w.path, w.content); fileOps.push({ ...r }); }
        catch (e) { fileOps.push({ path: w.path, action: "erro", error: String(e.message || e) }); }
      }
    }
    let cmdFeedback = "";
    // comandos: revisão → pendente; autoApply → executa
    for (const c of tc.commands || []) {
      if (reviewMode) {
        pendingActions.push({ type: "command", command: c });
      } else {
        const r = await new Promise((resolve) => {
          const { exec } = require("child_process");
          exec(c, { cwd: project.folder, timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
          });
        });
        fileOps.push({ command: c, action: "executado", ok: r.ok, code: r.code });
        cmdFeedback += `\n[comando executado: ${c}]\nCódigo de saída: ${r.code}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}\n`;
      }
    }

    // skills
    const skillScan = skills.detectInvocations(tc.cleanText);
    let newSkillBodies = [];
    for (const n of skillScan.invoked) {
      if (!loadedSkills.find((s) => s.name === n)) {
        const s = skills.get(n);
        if (s) { loadedSkills.push(s); newSkillBodies.push(s); }
      }
    }

    rawText = skillScan.cleanText;

    // feedback de leituras/listagens para a próxima iteração
    let feedback = cmdFeedback;
    for (const rp of tc.reads) {
      try { const r = projects.readFile(project.id, rp); fileOps.push({ path: rp, action: "lido" }); feedback += `\n[arquivo: ${rp}]\n\`\`\`\n${r.content}\n\`\`\`\n`; }
      catch (e) { feedback += `\n[erro ao ler ${rp}: ${e.message}]\n`; }
    }
    if (tc.lists) {
      const t = projects.tree(project.id);
      feedback += `\n[arquivos do projeto]\n${t.files.join("\n")}\n`;
    }
    if (newSkillBodies.length) feedback += `\n[skills carregadas: ${newSkillBodies.map((s) => s.name).join(", ")}]\n`;

    // web: pesquisas e leituras de página
    for (const q of tc.searches || []) {
      try {
        const hits = await websearch.search(q, { limit: 6 });
        feedback += `\n[busca: ${q}]\n` + hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n") + "\n";
        hits.slice(0, 3).forEach((h) => webRefs.push({ title: h.title, url: h.url }));
      } catch (e) { feedback += `\n[erro na busca "${q}": ${e.message}]\n`; }
    }
    for (const u of tc.fetches || []) {
      try {
        const page = await websearch.fetchPage(u);
        feedback += `\n[página: ${u}]\n${page.text}\n`;
        webRefs.push({ title: page.title, url: u });
      } catch (e) { feedback += `\n[erro ao ler ${u}: ${e.message}]\n`; }
    }

    // se há ações pendentes (escrita/comando), pausa para o usuário aprovar
    if (pendingActions.length) break;

    // No auto-aplicar, escritas/comandos JÁ executados também pedem nova passada
    // para o modelo verificar o resultado e continuar a auto-programação.
    const didAutoWork = !reviewMode && (tc.writes.length || (tc.commands || []).length);
    const needsAnotherPass = tc.reads.length || tc.lists || newSkillBodies.length || (tc.searches || []).length || (tc.fetches || []).length || didAutoWork;
    if (!needsAnotherPass) break;

    working = working.concat([
      { role: "assistant", content: run.result.text },
      { role: "user", content: "Resultados das operações solicitadas:" + feedback + "\nContinue a tarefa." },
    ]);
  }

  // memória de contexto deste chat: extrai <context>…</context> se o modelo emitiu
  let updatedContext = false;
  rawText = rawText.replace(/<context>([\s\S]*?)<\/context>/i, (_m, body) => {
    if (contextEnabled) { convContext = body.trim(); updatedContext = true; }
    return "";
  }).trim();

  // memórias + arquivos office + limpeza final
  const memProc = memory.processModelOutput(rawText);
  const officeProc = await processOfficeTags(memProc.cleanText);
  const finalText = officeProc.cleanText;
  const officeFiles = officeProc.files;

  // se a memória do chat está ligada e o modelo NÃO emitiu <context>,
  // gera as notas via passada de resumo (garantia independente do modelo)
  if (contextEnabled && !updatedContext) {
    try {
      const notes = await summarizeContext(chain, convContext, lastUserText, finalText);
      if (notes) { convContext = notes; updatedContext = true; }
    } catch {}
  }
  const usedStep = chain[run.level];

  try {
    if (!convId) convId = conversations.create().id;
    conversations.appendMessages(convId, [
      { role: "user", content: lastUserText },
      { role: "assistant", content: finalText, meta: { provider: run.provider, modelId: run.modelId, fallbackLevel: run.level, category, reason, mode, attempts: run.attempts, officeFiles, webRefs: webRefs.length ? dedupeRefs(webRefs) : undefined, pendingActions } },
    ]);
    if (updatedContext) conversations.setContext(convId, convContext);
  } catch {}

  res.json({
    ok: true,
    text: finalText,
    conversationId: convId,
    usedProvider: run.provider,
    usedModelId: run.modelId,
    usedName: usedStep?.name,
    usedProviderLabel: usedStep?.providerLabel,
    usedFallbackLevel: run.level,
    category,
    reason,
    mode,
    chain,
    attempts: run.attempts,
    savedMemories: memProc.saved,
    forgotten: memProc.forgotten,
    fileOps,
    pendingActions,
    contextMemory: contextEnabled,
    contextUpdated: updatedContext,
    compacted: comp.compacted,
    ragSources: sources ? sources.map((s) => ({ file: s.file, score: s.score })) : null,
    webRefs: webRefs.length ? dedupeRefs(webRefs) : null,
    officeFiles,
  });
});

function dedupeRefs(refs) {
  const seen = new Set(), out = [];
  for (const r of refs) { if (!seen.has(r.url)) { seen.add(r.url); out.push(r); } }
  return out.slice(0, 12);
}

// -----------------------------------------------------------------
// POST /api/chat/stream — versão com STREAMING (SSE).
// Usada pelo frontend no caso comum (sem projeto/sem geração de imagem).
// Suporta visão (imagens na última mensagem), memória, contexto e compactação.
// -----------------------------------------------------------------
app.post("/api/chat/stream", async (req, res) => {
  const { conversationId, messages, mode = "auto", manualChain } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages vazio." });
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? String(lastUser.content) : "";
  const hasImage = Boolean(lastUser && lastUser.images && lastUser.images.length);
  let convId = conversationId;

  let contextEnabled = false, convContext = "";
  if (convId) {
    const c = conversations.load(convId);
    if (c && c.contextMemory) { contextEnabled = true; convContext = c.context || ""; }
  }

  // cadeia
  const cat = effectiveCatalog();
  let chain = [], category = null, reason = null;
  if (mode === "manual" && Array.isArray(manualChain) && manualChain.length) {
    chain = manualChain.map((c) => {
      const prov = cat[c.provider];
      const model = prov?.models.find((m) => m.id === c.modelId);
      return { provider: c.provider, modelId: c.modelId, name: model?.name || c.modelId, providerLabel: prov?.label || c.provider };
    });
    reason = "escolha manual";
  } else {
    const picked = router.pickAutoChain(cat, providers.hasKey, lastUserText, { hasImage });
    category = picked.category; reason = picked.reason; chain = picked.chain;
  }

  // SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (res.flushHeaders) res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!chain.length) { send({ type: "error", error: "Nenhum modelo grátis disponível." }); return res.end(); }

  const comp = await compactMessages(messages, chain);
  const working = comp.messages;
  const systemPrompt = buildSystemPrompt(lastUserText, { context: contextEnabled ? convContext : null });

  // tenta a cadeia com streaming; cai para o próximo se falhar antes de emitir
  let raw = "", used = null, level = 0;
  const attempts = [];
  for (let i = 0; i < chain.length; i++) {
    const { provider, modelId } = chain[i];
    let acc = "", emitted = false;
    try {
      const r = await providers.callProviderStream(provider, modelId, working, systemPrompt, (d) => {
        acc += d; emitted = true; send({ type: "text", text: stripForStream(acc) });
      });
      // resposta vazia (ex.: Gemini filtrou/retornou nada) → trata como falha
      // e cai para o próximo modelo, em vez de mostrar bolha vazia.
      if (!r.text || !r.text.trim()) {
        attempts.push({ provider, modelId, error: "resposta vazia" });
        router.recordFailure(provider, "resposta vazia");
        if (emitted) { send({ type: "text", text: "" }); }
        send({ type: "fallback", from: `${provider}/${modelId}`, error: "resposta vazia" });
        continue;
      }
      raw = r.text; used = chain[i]; level = i;
      router.recordSuccess(provider);
      break;
    } catch (e) {
      const msg = String(e.message || e);
      attempts.push({ provider, modelId, error: msg });
      router.recordFailure(provider, msg);
      if (emitted) { send({ type: "error", error: "Falha no meio do streaming: " + msg, attempts }); return res.end(); }
      send({ type: "fallback", from: `${provider}/${modelId}`, error: msg });
    }
  }
  if (!used) { send({ type: "error", error: "Todos os modelos falharam.", attempts }); return res.end(); }

  // pós-processamento blindado: SEMPRE termina com 'done' (ou 'error').
  try {
    let updatedContext = false;
    raw = raw.replace(/<context>([\s\S]*?)<\/context>/i, (_m, b) => { if (contextEnabled) { convContext = b.trim(); updatedContext = true; } return ""; }).trim();
    const memProc = memory.processModelOutput(raw);
    const skillProc = skills.detectInvocations(memProc.cleanText);
    const officeProc = await processOfficeTags(skillProc.cleanText);
    const finalText = officeProc.cleanText;

    if (contextEnabled && !updatedContext) {
      try { const notes = await summarizeContext(chain, convContext, lastUserText, finalText); if (notes) { convContext = notes; updatedContext = true; } } catch {}
    }

    try {
      if (!convId) convId = conversations.create().id;
      conversations.appendMessages(convId, [
        { role: "user", content: lastUserText },
        { role: "assistant", content: finalText, meta: { provider: used.provider, modelId: used.modelId, fallbackLevel: level, category, reason, mode, attempts } },
      ]);
      if (updatedContext) conversations.setContext(convId, convContext);
    } catch {}

    send({
      type: "done",
      text: finalText,
      conversationId: convId,
      usedProvider: used.provider, usedModelId: used.modelId,
      usedName: used.name, usedProviderLabel: used.providerLabel,
      usedFallbackLevel: level, category, reason, mode, attempts,
      savedMemories: memProc.saved, forgotten: memProc.forgotten,
      contextMemory: contextEnabled, contextUpdated: updatedContext, compacted: comp.compacted,
      officeFiles: officeProc.files,
    });
  } catch (e) {
    // se algo no pós-processamento falhar, ainda entrega o texto cru gerado
    send({ type: "done", text: raw, conversationId: convId, usedProvider: used.provider, usedModelId: used.modelId, usedName: used.name, usedProviderLabel: used.providerLabel, usedFallbackLevel: level, category, reason, mode, attempts });
  }
  res.end();
});

// -----------------------------------------------------------------
// Memória
// -----------------------------------------------------------------
app.get("/api/memory", (req, res) => res.json({ memories: memory.list() }));
app.post("/api/memory", (req, res) => {
  const { name, description, type, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "name e body obrigatórios." });
  const slug = memory.save({ name, description, type, body });
  res.json({ ok: true, slug });
});
app.delete("/api/memory/:name", (req, res) => {
  res.json({ ok: memory.remove(req.params.name) });
});

// -----------------------------------------------------------------
// Skills
// -----------------------------------------------------------------
app.get("/api/skills", (req, res) => res.json({ skills: skills.list() }));
app.post("/api/skills", (req, res) => {
  const { name, description, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "name e body obrigatórios." });
  const dir = skills.save({ name, description, body });
  res.json({ ok: true, dir });
});
app.delete("/api/skills/:name", (req, res) => {
  res.json({ ok: skills.remove(req.params.name) });
});

// -----------------------------------------------------------------
// Projetos (pastas conectadas)
// -----------------------------------------------------------------
app.get("/api/projects", (req, res) => res.json({ projects: projects.list() }));

// Abre o seletor de pasta NATIVO do Windows (Explorer) e devolve o caminho.
// Funciona porque o servidor roda localmente na máquina do usuário.
app.post("/api/projects/pick", (req, res) => {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = "Selecione a pasta do projeto para o Cowork"
$dlg.ShowNewFolderButton = $true
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }
`;
  const { execFile } = require("child_process");
  execFile(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", ps],
    { windowsHide: false, timeout: 120000 },
    (err, stdout) => {
      if (err && !stdout) return res.json({ ok: false, error: "Seleção cancelada ou indisponível." });
      const folder = String(stdout || "").trim();
      if (!folder) return res.json({ ok: false, canceled: true });
      res.json({ ok: true, folder });
    }
  );
});

app.post("/api/projects", (req, res) => {
  try {
    const { name, folder } = req.body;
    if (!folder) return res.status(400).json({ error: "folder obrigatório." });
    res.json({ ok: true, project: projects.create({ name, folder }) });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});
app.delete("/api/projects/:id", (req, res) => res.json({ ok: projects.remove(req.params.id) }));
app.get("/api/projects/:id/tree", (req, res) => {
  try { res.json(projects.tree(req.params.id)); }
  catch (err) { res.status(404).json({ error: String(err.message || err) }); }
});
app.get("/api/projects/:id/file", (req, res) => {
  try { res.json(projects.readFile(req.params.id, req.query.path)); }
  catch (err) { res.status(404).json({ error: String(err.message || err) }); }
});

// Aprovar uma ESCRITA proposta (aplica o arquivo na pasta).
app.post("/api/projects/:id/apply", (req, res) => {
  try {
    const { path: p, content } = req.body;
    res.json({ ok: true, result: projects.writeFile(req.params.id, p, content) });
  } catch (err) { res.status(400).json({ ok: false, error: String(err.message || err) }); }
});

// Aprovar e EXECUTAR um comando de terminal na pasta do projeto.
app.post("/api/projects/:id/exec", (req, res) => {
  const proj = projects.get(req.params.id);
  if (!proj) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  const command = String((req.body || {}).command || "").trim();
  if (!command) return res.status(400).json({ ok: false, error: "comando vazio" });
  const { exec } = require("child_process");
  exec(command, { cwd: proj.folder, timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    res.json({
      ok: !err,
      command,
      code: err ? (err.code || 1) : 0,
      stdout: String(stdout || "").slice(0, 20000),
      stderr: String(stderr || (err ? err.message : "")).slice(0, 8000),
    });
  });
});

// Clonar repositório remoto e já conectar como projeto.
app.post("/api/git/clone", async (req, res) => {
  try {
    const { url, parent } = req.body || {};
    const r = await git.clone(url, parent);
    if (!r.ok) return res.json(r);
    const project = projects.create({ name: r.name, folder: r.folder });
    res.json({ ok: true, project, folder: r.folder });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Git: status, diff, log, commit (commit exige mensagem do usuário = aprovação).
app.get("/api/projects/:id/git/status", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: "projeto não encontrado" });
  try { res.json(await git.status(p.folder)); } catch (e) { res.json({ repo: false, error: String(e.message || e) }); }
});
app.get("/api/projects/:id/git/diff", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: "projeto não encontrado" });
  res.json(await git.diff(p.folder, req.query.file));
});
app.get("/api/projects/:id/git/log", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: "projeto não encontrado" });
  res.json({ log: await git.log(p.folder, 15) });
});
app.post("/api/projects/:id/git/commit", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  res.json(await git.commit(p.folder, (req.body || {}).message, { addAll: true }));
});
app.post("/api/projects/:id/git/init", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  res.json(await git.init(p.folder));
});
app.post("/api/projects/:id/git/push", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  const { remote = "origin", branch } = req.body || {};
  res.json(await git.push(p.folder, remote, branch));
});
app.post("/api/projects/:id/git/pull", async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  const { remote = "origin", branch } = req.body || {};
  res.json(await git.pull(p.folder, remote, branch));
});
app.get("/api/git/check", async (req, res) => {
  res.json(await git.checkGitAvailable());
});

// RAG: status do índice, (re)indexar, remover.
app.get("/api/projects/:id/rag", (req, res) => res.json(rag.status(req.params.id)));
app.delete("/api/projects/:id/rag", (req, res) => res.json({ ok: rag.remove(req.params.id) }));
app.post("/api/projects/:id/index", async (req, res) => {
  try {
    const stats = await rag.indexProject(req.params.id, req.body || {});
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Analisador de pasta: varredura determinística + PDF real.
app.post("/api/projects/:id/analyze", async (req, res) => {
  const proj = projects.get(req.params.id);
  if (!proj) return res.status(404).json({ ok: false, error: "projeto não encontrado" });
  if (!fsmod.existsSync(proj.folder)) return res.status(404).json({ ok: false, error: "pasta sumiu do disco" });
  try {
    const report = await analyzer.analyze(proj.folder, req.body || {});
    const safe = proj.name.replace(/[^a-z0-9-]/gi, "_").slice(0, 40);
    const file = `analise-${safe}-${Date.now().toString(36)}.pdf`;
    await pdfreport.buildPdf(report, path.join(REPORT_DIR, file));
    // remove o ponteiro de função antes de serializar
    const { fmtBytes, ...clean } = report;
    res.json({ ok: true, report: clean, pdfUrl: `/reports/${file}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// -----------------------------------------------------------------
// Conversas
// -----------------------------------------------------------------
app.get("/api/conversations", (req, res) => res.json({ conversations: conversations.list() }));
app.post("/api/conversations", (req, res) => {
  const { contextMemory } = req.body || {};
  res.json({ ok: true, conversation: conversations.create("Nova conversa", { contextMemory: Boolean(contextMemory) }) });
});
app.get("/api/conversations/:id", (req, res) => {
  const c = conversations.load(req.params.id);
  if (!c) return res.status(404).json({ error: "não encontrada" });
  res.json(c);
});
app.delete("/api/conversations/:id", (req, res) => {
  res.json({ ok: conversations.remove(req.params.id) });
});

// -----------------------------------------------------------------
// Saúde dos provedores
// -----------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ health: router.healthSnapshot() }));

// -----------------------------------------------------------------
// Descoberta de modelos grátis
// -----------------------------------------------------------------
app.post("/api/discovery/run", async (req, res) => {
  try {
    const report = await discovery.run(CATALOG);
    saveLastDiscovery();
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});
app.get("/api/discovery/report", (req, res) => {
  res.json({ report: discovery.lastReport(), lastRun: getLastDiscovery() });
});

// -----------------------------------------------------------------
// Agendador semanal da descoberta.
// -----------------------------------------------------------------
const fs = require("fs");
const LAST_RUN_FILE = path.join(__dirname, "data", "discovery-last-run.json");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getLastDiscovery() {
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8")).at || null;
  } catch {
    return null;
  }
}
function saveLastDiscovery() {
  fs.mkdirSync(path.dirname(LAST_RUN_FILE), { recursive: true });
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ at: new Date().toISOString() }), "utf8");
}

async function maybeRunDiscovery() {
  const anyKey = Object.keys(CATALOG).some((p) => providers.hasKey(p));
  if (!anyKey) return;
  const last = getLastDiscovery();
  if (last && Date.now() - new Date(last).getTime() < WEEK_MS) return;
  try {
    console.log("  [descoberta] varrendo modelos grátis…");
    await discovery.run(CATALOG);
    saveLastDiscovery();
    console.log("  [descoberta] concluída — veja data/discovery-report.md");
  } catch (e) {
    console.warn("  [descoberta] falhou:", e.message);
  }
}

// 404 para rotas de API desconhecidas (devolve JSON, não HTML).
app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "rota não encontrada: " + req.path }));

// Tratamento de erro global — qualquer exceção não capturada vira JSON limpo.
app.use((err, req, res, next) => {
  console.error("  [erro]", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: String(err.message || err) });
});

// Não derruba o processo por uma rejeição/exceção isolada.
process.on("unhandledRejection", (e) => console.warn("  [unhandledRejection]", String(e && e.message || e)));
process.on("uncaughtException", (e) => console.warn("  [uncaughtException]", String(e && e.message || e)));

app.listen(PORT, () => {
  console.log(`\n  Cowork LLM rodando em http://localhost:${PORT}\n`);
  // roda na inicialização se já passou uma semana, depois agenda semanal.
  maybeRunDiscovery();
  setInterval(maybeRunDiscovery, WEEK_MS);
});
