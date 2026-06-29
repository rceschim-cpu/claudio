// app.js — frontend do Cowork LLM local.
// Nenhuma chave de API passa por aqui: tudo vai ao servidor local em /api/*.

let CATALOG = {};
let mode = "auto";
let manualChain = [null, null, null];
let conversation = [];          // [{role, content, images, meta}]
let conversationId = null;
let artifacts = [];             // [{filename, actualFilename, lang, code}]
let activeArtifact = 0;
let projectId = null;           // pasta conectada ativa
let forceImage = false;         // próxima mensagem gera imagem
let webEnabled = false;          // próxima mensagem pode pesquisar na web
let autoApply = false;          // aplicar escrita sem revisar diff
let suppressAutoOpen = false;   // evita abrir artefatos ao recarregar histórico
let attachedImages = [];        // holds attached image base64
let artifactViewMode = 'code';   // 'code' or 'preview'
let replyQuote = null;
let snippetCounter = 1;

const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  return r.json();
};

init();

async function init() {
  CATALOG = await api("/api/catalog");
  renderManualBuilder();
  await loadProjects();
  await loadConversations();
  wireUI();
  refreshStatusHealth();
}

// =================================================================
// MODO (auto / manual)
// =================================================================
function wireUI() {
  $("mode-auto").addEventListener("click", () => setMode("auto"));
  $("mode-manual").addEventListener("click", () => setMode("manual"));
  $("btn-new-chat").addEventListener("click", newChat);
  $("btn-memory").addEventListener("click", openMemoryModal);
  $("btn-skills").addEventListener("click", openSkillsModal);
  $("btn-models").addEventListener("click", openModelsModal);
  $("modal-close").addEventListener("click", closeModal);
  $("modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });
  $("btn-close-artifacts").addEventListener("click", () => document.querySelector(".app").classList.remove("artifacts-open"));

  // input
  const input = $("chat-input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-form").requestSubmit(); } });
  
  // colar da área de transferência
  input.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf("image") === 0) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = function(evt) {
          const dataUrl = evt.target.result;
          attachedImages = [dataUrl];
          
          const preview = $("file-preview");
          preview.innerHTML = `
            <div style="position:relative;display:inline-block;margin:4px;">
              <img src="${dataUrl}" style="max-height:40px;border-radius:4px;border:1px solid var(--border-2);" />
              <button type="button" class="preview-remove" style="position:absolute;top:-4px;right:-4px;background:var(--red);color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
          `;
          preview.classList.remove("hidden");
          preview.querySelector(".preview-remove").addEventListener("click", () => {
            attachedImages = [];
            preview.classList.add("hidden");
            preview.innerHTML = "";
            $("file-input").value = "";
          });
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  });

  $("chat-form").addEventListener("submit", onSend);

  // anexo
  $("btn-attach").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", onAttach);

  // imagem — toggle explícito: só gera imagem quando ISTO está ligado
  $("btn-image").addEventListener("click", () => {
    forceImage = !forceImage;
    $("btn-image").classList.toggle("has-file", forceImage);
    $("btn-image").title = forceImage
      ? "MODO IMAGEM LIGADO — a próxima mensagem vai gerar uma imagem. Clique para desligar."
      : "Gerar imagem: clique para que a próxima mensagem crie uma imagem.";
    $("chat-input").placeholder = forceImage
      ? "🎨 MODO IMAGEM — descreva a imagem que quer gerar…"
      : "Fale com seu cowork…  (Enter envia · Shift+Enter quebra linha)";
    $("chat-input").focus();
  });

  // web — toggle: a próxima mensagem pode pesquisar na web
  $("btn-web").addEventListener("click", () => {
    webEnabled = !webEnabled;
    $("btn-web").classList.toggle("has-file", webEnabled);
    $("btn-web").title = webEnabled ? "WEB LIGADA — vou pesquisar na web. Clique para desligar." : "Pesquisar na web nesta mensagem.";
    $("chat-input").focus();
  });

  // projeto
  $("btn-connect-folder").addEventListener("click", connectFolder);
  $("btn-clone").addEventListener("click", cloneRepo);
  $("btn-analyze").addEventListener("click", analyzeFolder);
  $("btn-index").addEventListener("click", indexFolder);
  $("btn-git").addEventListener("click", openGitModal);
  $("auto-apply").addEventListener("change", (e) => { autoApply = e.target.checked; });
  $("project-select").addEventListener("change", (e) => { projectId = e.target.value || null; updateProjectInfo(); });

  // redimensionamento de colunas
  setupResizers();

  // citação: selecionar trecho de uma mensagem → botão "responder"
  setupQuoteReply();
}

// =================================================================
// CITAÇÃO — selecionar texto numa mensagem mostra "↩ responder"
// =================================================================
function setupQuoteReply() {
  const btn = document.createElement("button");
  btn.id = "quote-btn";
  btn.className = "quote-btn hidden";
  btn.textContent = "↩ responder";
  document.body.appendChild(btn);

  const hide = () => btn.classList.add("hidden");
  btn.addEventListener("mousedown", (e) => e.preventDefault()); // não perde a seleção

  $("chat-window").addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      if (!text || text.length < 2) { hide(); return; }
      // só dentro de uma mensagem
      const anchor = sel.anchorNode;
      const inMsg = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest(".msg");
      if (!inMsg) { hide(); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      btn.style.left = Math.max(8, rect.left + rect.width / 2 - 45) + "px";
      btn.style.top = (rect.top - 38) + "px";
      btn.classList.remove("hidden");
    }, 10);
  });

  btn.addEventListener("click", () => {
    const text = window.getSelection().toString().trim();
    if (text) setReplyQuote(text);
    window.getSelection().removeAllRanges();
    hide();
  });

  document.addEventListener("scroll", hide, true);
  document.addEventListener("mousedown", (e) => { if (e.target.id !== "quote-btn") hide(); });
}

function setReplyQuote(text) {
  replyQuote = text;
  const el = $("reply-quote");
  el.innerHTML = `<span class="reply-quote-label">↩ respondendo a:</span> <span class="reply-quote-text">${escapeHtml(text.length > 160 ? text.slice(0, 160) + "…" : text)}</span> <button type="button" class="reply-quote-x">✕</button>`;
  el.classList.remove("hidden");
  el.querySelector(".reply-quote-x").addEventListener("click", clearReplyQuote);
  $("chat-input").focus();
}

function clearReplyQuote() {
  replyQuote = null;
  $("reply-quote").innerHTML = ""; $("reply-quote").classList.add("hidden");
}

// =================================================================
// COLUNAS REDIMENSIONÁVEIS
// =================================================================
function setupResizers() {
  const app = document.querySelector(".app");
  const sw = localStorage.getItem("cowork-sidebar-w");
  const aw = localStorage.getItem("cowork-artifacts-w");
  if (sw) app.style.setProperty("--sidebar-w", sw);
  if (aw) app.style.setProperty("--artifacts-w", aw);

  makeResizer($("resizer-left"), "--sidebar-w", "cowork-sidebar-w", 180, 520, +1);
  makeResizer($("resizer-right"), "--artifacts-w", "cowork-artifacts-w", 280, 900, -1);
}

function makeResizer(handle, cssVar, storeKey, min, max, dir) {
  if (!handle) return;
  const app = document.querySelector(".app");
  let startX = 0, startW = 0;
  const onDown = (e) => {
    startX = e.clientX;
    startW = parseInt(getComputedStyle(app).getPropertyValue(cssVar)) || 0;
    document.body.classList.add("resizing");
    handle.classList.add("dragging");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  };
  const onMove = (e) => {
    let w = startW + dir * (e.clientX - startX);
    w = Math.max(min, Math.min(max, w));
    app.style.setProperty(cssVar, w + "px");
  };
  const onUp = () => {
    document.body.classList.remove("resizing");
    handle.classList.remove("dragging");
    localStorage.setItem(storeKey, getComputedStyle(app).getPropertyValue(cssVar).trim());
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  handle.addEventListener("mousedown", onDown);
}

// =================================================================
// PROJETOS (pasta conectada)
// =================================================================
async function loadProjects() {
  const { projects } = await api("/api/projects");
  const sel = $("project-select");
  sel.innerHTML = '<option value="">— sem pasta (chat normal) —</option>' +
    projects.map(p => `<option value="${p.id}" ${p.id === projectId ? "selected" : ""}>${escapeHtml(p.name)}${p.exists ? "" : " (sumiu!)"}</option>`).join("");
  updateProjectInfo();
}

async function updateProjectInfo() {
  const info = $("project-info");
  $("btn-analyze").classList.toggle("hidden", !projectId);
  $("btn-index").classList.toggle("hidden", !projectId);
  $("btn-git").classList.toggle("hidden", !projectId);
  $("apply-toggle-wrap").classList.toggle("hidden", !projectId);
  if (!projectId) { info.classList.add("hidden"); return; }
  info.classList.remove("hidden");
  const list = (await api("/api/projects")).projects || [];
  const proj = list.find(p => p.id === projectId);
  let ragLine = "";
  try {
    const r = await api(`/api/projects/${projectId}/rag`);
    if (r.indexed) {
      ragLine = `<div class="proj-stats" style="color:var(--green);margin-top:4px;">📚 indexado: ${r.chunks} trechos — RAG ativa</div>`;
      $("btn-index").textContent = "📚 Reindexar p/ busca (RAG)";
    } else {
      $("btn-index").textContent = "📚 Indexar p/ busca (RAG)";
    }
  } catch (err) {
    console.error("Erro RAG info:", err);
  }
  try {
    const t = await api(`/api/projects/${projectId}/tree`);
    info.innerHTML = `
      <div class="proj-path" title="${escapeHtml(proj?.folder || "")}">📁 ${escapeHtml(proj?.folder || "")}</div>
      <div class="proj-stats">${t.files ? t.files.length : 0} arquivo(s)${t.truncated ? "+" : ""} · cowork lê/escreve aqui</div>
      ${ragLine}`;
  } catch (err) {
    info.textContent = "Erro ao ler a pasta";
  }
}

async function connectFolder() {
  try {
    setStatus("amber", "selecionando pasta…");
    const picked = await api("/api/projects/pick", { method: "POST" });
    setStatus("green", "ok");
    if (!picked.ok || picked.canceled) return;
    const folder = picked.folder;
    const name = prompt("Nome do projeto:", folder.split(/[\\/]/).pop() || "Novo Projeto");
    if (!name) return;
    
    setStatus("amber", "conectando…");
    const r = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder }),
    });
    setStatus("green", "ok");
    if (r.ok) {
      projectId = r.project.id;
      await loadProjects();
    } else {
      alert("Erro ao criar projeto: " + r.error);
    }
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao conectar pasta: " + err.message);
  }
}

// Clona um repositório remoto (GitHub) e conecta como projeto.
async function cloneRepo() {
  const url = prompt("URL do repositório Git (ex: https://github.com/usuario/projeto.git):");
  if (!url) return;

  let parent = null;
  try {
    const picked = await api("/api/projects/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (picked.canceled) return;
    if (picked.ok) parent = picked.folder;
  } catch (err) {
    console.error("Erro no pick nativo:", err);
  }

  if (!parent) {
    parent = prompt("Não abriu o seletor. Cole o CAMINHO COMPLETO da pasta de destino:");
    if (!parent) return;
  }

  setStatus("amber", "clonando…");
  try {
    const r = await api("/api/git/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, parent })
    });
    if (!r.ok) { 
      setStatus("red", "falhou");
      alert("Falha ao clonar: " + r.error);
      return;
    }
    projectId = r.project.id;
    await loadProjects();
    setStatus("green", "clonado");
    alert("Repositório clonado e conectado: " + r.folder);
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao clonar: " + (err.message || String(err)));
  }
}

async function analyzeFolder() {
  if (!projectId) return;
  setStatus("amber", "analisando…");
  try {
    const r = await api(`/api/projects/${projectId}/analyze`, { method: "POST" });
    setStatus("green", "ok");
    if (!r.ok) {
      alert("Erro ao analisar pasta: " + r.error);
      return;
    }
    
    let html = `
      <div style="font-size:13px;line-height:1.4;">
        <p><b>PDF Report:</b> <a href="${r.pdfUrl}" target="_blank" style="color:var(--green);font-weight:600;text-decoration:underline;">Ver Relatório Completo PDF</a></p>
        <p><b>Total de arquivos:</b> ${r.report.totalFiles || 0} (${(r.report.totalBytes / 1024 / 1024).toFixed(2)} MB)</p>
    `;
    
    if (r.report.duplicates && r.report.duplicates.length) {
      html += `
        <h5 style="margin:12px 0 6px 0;color:var(--amber);">Arquivos duplicados detectados:</h5>
        <div style="max-height:200px;overflow:auto;background:var(--bg-3);padding:6px;font-family:var(--mono);font-size:11.5px;">
      `;
      for (const dup of r.report.duplicates) {
        html += `<div style="margin-bottom:6px;border-bottom:1px dashed var(--border);padding-bottom:4px;">
          <b>SHA256:</b> ${dup.hash.slice(0, 8)}...<br>
          <b>Tamanho:</b> ${(dup.size / 1024).toFixed(1)} KB<br>
          <b>Caminhos:</b><br>${dup.paths.map(p => `• ${escapeHtml(p)}`).join('<br>')}
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<p style="color:var(--green)">✓ Nenhum arquivo duplicado encontrado.</p>`;
    }
    
    html += `</div>`;
    openModal("Análise da Pasta", html);
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao analisar: " + err.message);
  }
}

async function indexFolder() {
  if (!projectId) return;
  setStatus("amber", "indexando…");
  try {
    const r = await api(`/api/projects/${projectId}/index`, { method: "POST" });
    setStatus("green", "ok");
    if (r.ok) {
      alert(`Indexação concluída! ${r.chunks} trechos indexados para busca semântica (RAG).`);
      await updateProjectInfo();
    } else {
      alert("Erro ao indexar: " + r.error);
    }
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao indexar: " + err.message);
  }
}

async function openGitModal() {
  if (!projectId) return;
  setStatus("amber", "obtendo git…");
  try {
    // Check git availability first
    const gitCheck = await api("/api/git/check");
    if (!gitCheck.ok) {
      openModal("Git - Não Encontrado", `
        <div style="font-size:13px;line-height:1.6;">
          <p style="color:var(--red);">⚠️ Git não encontrado no sistema.</p>
          <p>Instale o Git para Windows em: <a href="https://git-scm.com/download/win" target="_blank" style="color:var(--green);">git-scm.com/download/win</a></p>
          <p style="color:var(--text-dim);font-size:12px;">Após instalar, reinicie o servidor e tente novamente.</p>
        </div>
      `);
      setStatus("amber", "git não instalado");
      return;
    }

    const status = await api(`/api/projects/${projectId}/git/status`);
    const logData = await api(`/api/projects/${projectId}/git/log`);
    setStatus("green", "ok");

    if (!status.repo) {
      let html = `
        <div style="font-size:13px;">
          <p>A pasta do projeto não é um repositório Git ativo.</p>
          <p style="color:var(--text-dim);font-size:12px;">Git detectado: <span style="color:var(--green);">${escapeHtml(gitCheck.version)}</span></p>
          <button class="btn-primary" id="btn-git-init" style="margin-top:12px;">⚡ Inicializar Git Agora</button>
        </div>
      `;
      openModal("Git Integration", html);
      $("btn-git-init").addEventListener("click", async () => {
        setStatus("amber", "inicializando…");
        const r = await api(`/api/projects/${projectId}/git/init`, { method: "POST" });
        setStatus("green", "ok");
        if (r.ok) { alert("Git inicializado!"); openGitModal(); }
        else alert("Erro: " + r.error);
      });
      return;
    }

    // Build modal
    let html = `<div style="font-size:12.5px;">`;

    // Branch + remote info
    html += `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
        <span>🌿 <b style="color:var(--green);font-family:var(--mono);">${escapeHtml(status.branch)}</b></span>
        ${status.ahead > 0 ? `<span style="color:var(--amber);font-size:11px;">↑ ${status.ahead} à frente</span>` : ""}
        ${status.behind > 0 ? `<span style="color:var(--red);font-size:11px;">↓ ${status.behind} atrás</span>` : ""}
        ${status.remotes && status.remotes.length ? `<span style="color:var(--text-faint);font-size:11px;">🔗 ${escapeHtml(status.remotes[0])}</span>` : ""}
      </div>
    `;

    // Push/Pull buttons (only if remote exists)
    if (status.remotes && status.remotes.length) {
      html += `
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <button type="button" class="btn-primary" id="btn-git-pull" style="flex:1;">⬇ Pull</button>
          <button type="button" class="btn-primary" id="btn-git-push" style="flex:1;">⬆ Push</button>
        </div>
      `;
    }

    // Staged/Unstaged files
    if (status.files && status.files.length) {
      html += `<h5 style="margin:10px 0 6px 0;color:var(--amber);">Modificações (${status.files.length}):</h5>`;
      for (const f of status.files) {
        html += `
          <div class="git-file">
            <span class="git-flag ${f.staged ? 'st' : ''}">${f.raw}</span>
            <span class="git-path" onclick="showGitDiff('${escapeHtml(f.file)}')">  ${escapeHtml(f.file)}</span>
            <span style="color:var(--text-faint);font-size:11px;">(${escapeHtml(f.state)})</span>
          </div>
        `;
      }

      html += `
        <div style="margin-top:14px;background:var(--bg-3);padding:10px;border:1px solid var(--border);">
          <textarea id="git-commit-msg" placeholder="Mensagem de commit…" style="width:100%;height:54px;background:var(--bg-2);color:var(--text);border:1px solid var(--border-2);padding:6px;font-family:var(--mono);resize:vertical;"></textarea>
          <button type="button" class="btn-primary" id="btn-git-commit" style="margin-top:6px;width:100%;">✓ Registrar (Commit)</button>
        </div>
      `;
    } else {
      html += `<p style="color:var(--green);">✓ Árvore de trabalho limpa. Nada para commitar.</p>`;
    }

    // Log
    if (logData.log && logData.log.length) {
      html += `<h5 style="margin:16px 0 6px 0;color:var(--text-dim);">Histórico recente:</h5>`;
      for (const c of logData.log) {
        html += `
          <div class="git-log">
            <b>${escapeHtml(c.hash)}</b> - ${escapeHtml(c.subject)} <span style="color:var(--text-faint)">(${escapeHtml(c.when)} por ${escapeHtml(c.author)})</span>
          </div>
        `;
      }
    }

    html += `</div>`;
    openModal(`🔱 Git: ${status.branch}`, html);

    // Commit button
    const commitBtn = $("btn-git-commit");
    if (commitBtn) {
      commitBtn.addEventListener("click", async () => {
        const msg = $("git-commit-msg").value.trim();
        if (!msg) { alert("Digite uma mensagem de commit."); return; }
        setStatus("amber", "commitando…");
        const r = await api(`/api/projects/${projectId}/git/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg })
        });
        setStatus("green", "ok");
        if (r.ok) { alert("Commit realizado!"); openGitModal(); }
        else alert("Erro ao commitar: " + r.error);
      });
    }

    // Push button
    const pushBtn = $("btn-git-push");
    if (pushBtn) {
      pushBtn.addEventListener("click", async () => {
        setStatus("amber", "enviando…");
        const r = await api(`/api/projects/${projectId}/git/push`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        setStatus(r.ok ? "green" : "red", r.ok ? "ok" : "erro push");
        alert(r.ok ? "Push realizado!\n" + r.output : "Erro no push:\n" + r.output);
        if (r.ok) openGitModal();
      });
    }

    // Pull button
    const pullBtn = $("btn-git-pull");
    if (pullBtn) {
      pullBtn.addEventListener("click", async () => {
        setStatus("amber", "atualizando…");
        const r = await api(`/api/projects/${projectId}/git/pull`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        setStatus(r.ok ? "green" : "red", r.ok ? "ok" : "erro pull");
        alert(r.ok ? "Pull realizado!\n" + r.output : "Erro no pull:\n" + r.output);
        if (r.ok) openGitModal();
      });
    }

  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao carregar dados do Git: " + err.message);
  }
}

window.showGitDiff = async function(file) {
  try {
    setStatus("amber", "obtendo diff…");
    const diffData = await api(`/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}`);
    setStatus("green", "ok");
    
    const diffText = diffData.unstaged || diffData.staged || "Sem mudanças detectadas.";
    
    // Split lines and colorize
    const lines = diffText.split("\n");
    let diffHtml = '<div class="diff" style="max-height:400px;overflow:auto;">';
    for (const l of lines) {
      let cls = "diff-ctx";
      if (l.startsWith("+")) cls = "diff-add";
      else if (l.startsWith("-")) cls = "diff-del";
      diffHtml += `<div class="${cls}">${escapeHtml(l)}</div>`;
    }
    diffHtml += '</div>';
    
    openModal(`Diff: ${file}`, diffHtml);
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao carregar diff: " + err.message);
  }
};

// =================================================================
// CONVERSAS (Histórico)
// =================================================================
async function loadConversations() {
  try {
    const r = await api("/api/conversations");
    const list = $("conversation-list");
    if (!list) return;
    
    if (!r.conversations || r.conversations.length === 0) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px 0;text-align:center;">Nenhuma conversa ativa</div>';
      return;
    }
    
    list.innerHTML = r.conversations.map(c => `
      <div class="conv-item ${c.id === conversationId ? "active" : ""}" data-id="${c.id}">
        <span class="conv-title" title="${escapeHtml(c.title || 'Sem título')}">${escapeHtml(c.title || 'Sem título')}</span>
        <button class="conv-del" data-id="${c.id}" title="Excluir conversa">✕</button>
      </div>
    `).join("");
    
    list.querySelectorAll(".conv-item").forEach(item => {
      item.addEventListener("click", async (e) => {
        if (e.target.classList.contains("conv-del")) {
          e.stopPropagation();
          const id = e.target.dataset.id;
          if (confirm("Deseja realmente excluir esta conversa?")) {
            const res = await api(`/api/conversations/${id}`, { method: "DELETE" });
            if (res.ok) {
              if (conversationId === id) {
                conversationId = null;
                conversation = [];
                renderMessages();
              }
              await loadConversations();
            }
          }
          return;
        }
        
        const id = item.dataset.id;
        await loadConversation(id);
      });
    });
  } catch (err) {
    console.error("Erro ao carregar conversas:", err);
  }
}

async function loadConversation(id) {
  try {
    setStatus("amber", "carregando…");
    const c = await api(`/api/conversations/${id}`);
    setStatus("green", "ok");
    if (!c) return;
    
    conversationId = c.id;
    conversation = c.messages || [];
    
    // Extract artifacts that are in assistant messages
    artifacts = [];
    activeArtifact = 0;
    
    for (const msg of conversation) {
      if (msg.role === "assistant" && msg.content) {
        const codeBlockRegex = /```(\w+)?(?:\s+([^\n]+))?\n([\s\S]*?)\n```/g;
        let match;
        while ((match = codeBlockRegex.exec(msg.content)) !== null) {
          const lang = match[1] || "txt";
          const filename = match[2] ? match[2].trim() : null;
          const code = match[3];
          
          if (!filename) {
            const firstLine = code.split("\n")[0].trim().slice(0, 50) || "Código";
            const ext = getExtensionForLang(lang);
            const contentHash = Math.abs(hashString(code)).toString(36);
            const generatedFilename = `${firstLine}`;
            const actualFilename = `snippet-${contentHash}.${ext}`;
            if (!artifacts.some(a => a.actualFilename === actualFilename)) {
              artifacts.push({ filename: generatedFilename, actualFilename, lang, code });
            }
          } else {
            if (!artifacts.some(a => a.filename === filename)) {
              artifacts.push({ filename, actualFilename: filename, lang, code });
            }
          }
        }
      }
    }
    
    // Roteamento
    const lastAssistant = [...conversation].reverse().find(m => m.role === "assistant");
    if (lastAssistant && lastAssistant.meta && lastAssistant.meta.provider) {
      const step = {
        provider: lastAssistant.meta.provider,
        modelId: lastAssistant.meta.modelId,
        name: lastAssistant.meta.usedName || lastAssistant.meta.modelId,
        color: CATALOG[lastAssistant.meta.provider]?.color || "#888",
        providerLabel: lastAssistant.meta.usedProviderLabel || lastAssistant.meta.provider
      };
      
      const chainList = lastAssistant.meta.chain || [step];
      renderStatusRouting(chainList, lastAssistant.meta.fallbackLevel || 0, lastAssistant.meta.attempts || []);
      
      $("status-dot").className = "dot dot-" + (lastAssistant.meta.fallbackLevel > 0 ? "amber" : "green");
      $("status-active-label").textContent = `${step.providerLabel} · ${step.name}`;
    } else {
      $("status-dot").className = "dot dot-green";
      $("status-active-label").textContent = "pronto";
      $("status-routing").innerHTML = "";
    }
    
    renderMessages();
    renderArtifacts();
    await loadConversations();
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao carregar conversa: " + err.message);
  }
}

async function newChat() {
  try {
    setStatus("amber", "iniciando chat…");
    const r = await api("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextMemory: false })
    });
    setStatus("green", "ok");
    if (r.ok && r.conversation) {
      conversationId = r.conversation.id;
      conversation = [];
      artifacts = [];
      activeArtifact = 0;
      
      $("status-dot").className = "dot dot-green";
      $("status-active-label").textContent = "pronto";
      $("status-routing").innerHTML = "";
      
      renderMessages();
      renderArtifacts();
      await loadConversations();
    }
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro ao criar nova conversa: " + err.message);
  }
}

// =================================================================
// MODALS
// =================================================================
function openModal(title, bodyHtml) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-backdrop").classList.remove("hidden");
}

function closeModal() {
  $("modal-backdrop").classList.add("hidden");
  $("modal-body").innerHTML = "";
}

async function openMemoryModal() {
  try {
    const r = await api("/api/memory");
    let html = `
      <div class="memory-modal">
        <p style="margin-bottom:12px;color:var(--text-dim);">O cowork local armazena memórias de longo prazo aqui. O modelo lê e grava nelas automaticamente.</p>
        <ul style="list-style:none;padding:0;max-height:300px;overflow:auto;">
    `;
    if (!r.memories || r.memories.length === 0) {
      html += `<li style="padding:10px;text-align:center;color:var(--text-faint);">Nenhuma memória salva ainda.</li>`;
    } else {
      for (const m of r.memories) {
        html += `
          <li style="border-bottom:1px solid var(--border);padding:8px 0;display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="flex:1;padding-right:12px;">
              <b style="color:var(--green);">${escapeHtml(m.name)}</b> <span style="font-size:11px;color:var(--text-faint);">(${escapeHtml(m.type)})</span> - <i>${escapeHtml(m.description || "")}</i>
              <pre style="font-size:11px;margin:5px 0 0 0;white-space:pre-wrap;color:var(--text-dim);background:var(--bg-3);padding:6px;border:1px solid var(--border-2);">${escapeHtml(m.body || "")}</pre>
            </div>
            <button class="btn-ghost" onclick="deleteMemory('${escapeHtml(m.name)}')" style="color:var(--red);margin-top:2px;">✕</button>
          </li>
        `;
      }
    }
    html += `</ul></div>`;
    openModal("Memória Persistente", html);
  } catch (err) {
    alert("Erro ao carregar memórias: " + err.message);
  }
}

window.deleteMemory = async function(name) {
  if (confirm(`Deseja esquecer a memória "${name}"?`)) {
    const r = await api(`/api/memory/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (r.ok) {
      openMemoryModal();
    }
  }
};

async function openSkillsModal() {
  try {
    const r = await api("/api/skills");
    let html = `
      <div class="skills-modal">
        <p style="margin-bottom:12px;color:var(--text-dim);">Skills estendem a capacidade do cowork injetando instruções específicas no prompt do sistema.</p>
        <ul style="list-style:none;padding:0;max-height:300px;overflow:auto;">
    `;
    if (!r.skills || r.skills.length === 0) {
      html += `<li style="padding:10px;text-align:center;color:var(--text-faint);">Nenhuma skill cadastrada.</li>`;
    } else {
      for (const s of r.skills) {
        html += `
          <li style="border-bottom:1px solid var(--border);padding:8px 0;display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="flex:1;padding-right:12px;">
              <b style="color:var(--green);">${escapeHtml(s.name)}</b> - <i>${escapeHtml(s.description || "")}</i>
              <pre style="font-size:11px;margin:5px 0 0 0;white-space:pre-wrap;color:var(--text-dim);background:var(--bg-3);padding:6px;border:1px solid var(--border-2);max-height:100px;overflow:auto;">${escapeHtml(s.body || "")}</pre>
            </div>
            <button class="btn-ghost" onclick="deleteSkill('${escapeHtml(s.name)}')" style="color:var(--red);margin-top:2px;">✕</button>
          </li>
        `;
      }
    }
    html += `</ul></div>`;
    openModal("Skills do Sistema", html);
  } catch (err) {
    alert("Erro ao carregar skills: " + err.message);
  }
}

window.deleteSkill = async function(name) {
  if (confirm(`Deseja excluir a skill "${name}"?`)) {
    const r = await api(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (r.ok) {
      openSkillsModal();
    }
  }
};

async function openModelsModal() {
  try {
    const r = await api("/api/discovery/report");
    let html = `
      <div class="models-modal">
        <p style="color:var(--text-dim);">O cowork varre provedores automaticamente para catalogar modelos 100% grátis.</p>
        <p><b>Última varredura:</b> ${r.lastRun ? new Date(r.lastRun).toLocaleString() : "nunca"}</p>
        <button class="btn-primary" id="btn-run-discovery" style="margin-bottom:14px;width:100%;">🔍 Varrer agora (Descoberta semanal)</button>
        <h5 style="margin-bottom:6px;">Relatório de Descoberta:</h5>
        <pre style="font-family:var(--mono);font-size:11.5px;background:var(--bg-3);padding:10px;border-radius:4px;overflow:auto;max-height:230px;white-space:pre-wrap;border:1px solid var(--border);color:var(--text-dim);">${escapeHtml(r.report || "Sem relatório disponível.")}</pre>
      </div>
    `;
    openModal("Descoberta de Modelos Grátis", html);
    
    $("btn-run-discovery").addEventListener("click", async () => {
      setStatus("amber", "varrendo…");
      $("btn-run-discovery").disabled = true;
      $("btn-run-discovery").textContent = "Varrendo provedores…";
      try {
        const res = await api("/api/discovery/run", { method: "POST" });
        setStatus("green", "ok");
        if (res.ok) {
          alert("Descoberta finalizada com sucesso!");
          openModelsModal();
        } else {
          alert("Erro na descoberta: " + res.error);
        }
      } catch (e) {
        setStatus("red", "erro");
        alert("Erro ao executar varredura: " + e.message);
      }
    });
  } catch (err) {
    alert("Erro ao carregar relatório: " + err.message);
  }
}

// =================================================================
// ANEXOS
// =================================================================
function onAttach(e) {
  const file = e.target.files[0];
  if (!file) return;
  const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(file.name);
  const reader = new FileReader();

  if (isImage) {
    // imagem → vision (anexa como base64)
    reader.onload = function(evt) {
      const dataUrl = evt.target.result;
      attachedImages = [dataUrl];
      const preview = $("file-preview");
      preview.innerHTML = `
        <div style="position:relative;display:inline-block;margin:4px;">
          <img src="${dataUrl}" style="max-height:40px;border-radius:4px;border:1px solid var(--border-2);" />
          <button type="button" class="preview-remove" style="position:absolute;top:-4px;right:-4px;background:var(--red);color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>`;
      preview.classList.remove("hidden");
      preview.querySelector(".preview-remove").addEventListener("click", () => {
        attachedImages = [];
        preview.classList.add("hidden");
        preview.innerHTML = "";
        $("file-input").value = "";
      });
    };
    reader.readAsDataURL(file);
  } else {
    // arquivo de texto → embute o conteúdo no campo da mensagem
    reader.onload = function(evt) {
      const input = $("chat-input");
      input.value += (input.value ? "\n\n" : "") + `[Arquivo: ${file.name}]\n\`\`\`\n${evt.target.result}\n\`\`\``;
      input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px";
      input.focus();
    };
    reader.readAsText(file, "utf-8");
  }
  e.target.value = "";
}

// =================================================================
// ROTEAMENTO MANUAL
// =================================================================
function setMode(newMode) {
  mode = newMode;
  $("mode-auto").classList.toggle("active", mode === "auto");
  $("mode-manual").classList.toggle("active", mode === "manual");
  $("auto-info").classList.toggle("hidden", mode !== "auto");
  $("manual-info").classList.toggle("hidden", mode !== "manual");
  
  if (mode === "manual") {
    renderManualBuilder();
  }
}

function renderManualBuilder() {
  const container = $("manual-builder");
  if (!container) return;
  
  let html = "";
  for (let i = 0; i < 3; i++) {
    const label = i === 0 ? "Principal" : `Fallback ${i}`;
    html += `
      <div class="manual-slot">
        <div class="manual-slot-label">${label}</div>
        <select data-slot="${i}">
          <option value="">— nenhum —</option>
    `;
    
    for (const [providerId, provider] of Object.entries(CATALOG)) {
      if (!provider.hasKey) continue;
      const freeModels = provider.models.filter(m => m.input === 0 && m.output === 0);
      if (freeModels.length === 0) continue;
      
      html += `<optgroup label="${escapeHtml(provider.label)}">`;
      for (const model of freeModels) {
        const selected = manualChain[i] && manualChain[i].provider === providerId && manualChain[i].modelId === model.id ? "selected" : "";
        html += `<option value="${providerId}:${model.id}" ${selected}>${escapeHtml(model.name)}</option>`;
      }
      html += `</optgroup>`;
    }
    
    html += `
        </select>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  container.querySelectorAll("select").forEach(select => {
    select.addEventListener("change", (e) => {
      const slot = parseInt(e.target.dataset.slot);
      const val = e.target.value;
      if (!val) {
        manualChain[slot] = null;
      } else {
        const [provider, modelId] = val.split(":");
        const prov = CATALOG[provider];
        const m = prov.models.find(x => x.id === modelId);
        manualChain[slot] = {
          provider,
          modelId,
          name: m.name,
          color: prov.color,
          providerLabel: prov.label
        };
      }
    });
  });
}

function renderStatusRouting(chain, activeIndex = 0, attempts = []) {
  const el = $("status-routing");
  if (!el) return;
  
  const activeChain = chain.filter(Boolean);
  if (activeChain.length === 0) {
    el.innerHTML = "";
    return;
  }
  
  el.innerHTML = activeChain.map((step, idx) => {
    let cls = "";
    const failed = attempts.some(a => a.provider === step.provider && a.modelId === step.modelId);
    
    if (failed) cls = "style='color:var(--red);text-decoration:line-through;'";
    else if (idx === activeIndex) cls = `style='color:var(--green);font-weight:600;text-shadow:var(--glow) rgba(54,255,106,.4);'`;
    else cls = `style='color:${step.color || 'var(--text-dim)'}'`;
    
    const arrow = idx < activeChain.length - 1 ? `<span style="color:var(--text-faint);margin:0 4px;">→</span>` : "";
    return `<span ${cls}>${escapeHtml(step.name || step.modelId)}</span>${arrow}`;
  }).join("");
}

// =================================================================
// ENVIO E RESPOSTA
// =================================================================
async function onSend(e) {
  e.preventDefault();
  const input = $("chat-input");
  const text = (input.value || "").trim();
  if (!text && attachedImages.length === 0) return;
  
  input.value = "";
  input.style.height = "auto";
  
  const preview = $("file-preview");
  preview.classList.add("hidden");
  preview.innerHTML = "";
  
  const userMsg = { role: "user", content: text };
  if (attachedImages.length) {
    userMsg.images = [...attachedImages];
  }
  
  attachedImages = [];
  $("file-input").value = "";
  
  conversation.push(userMsg);
  renderMessages();
  
  const payload = {
    conversationId,
    messages: conversation,
    mode,
    manualChain: mode === "manual" ? manualChain.filter(Boolean) : undefined,
    projectId,
    forceImage,
    autoApply,
    web: webEnabled
  };
  
  forceImage = false; $("btn-image").classList.remove("has-file");
  webEnabled = false; $("btn-web").classList.remove("has-file");
  $("chat-input").placeholder = "Fale com seu cowork…  (Enter envia · Shift+Enter quebra linha)";
  clearReplyQuote();

  // Streaming no caso comum; projeto/imagem/web usam o caminho bloqueante (loop agêntico).
  const useStream = !projectId && !forceImage && !webEnabled && (!userMsg.images || !userMsg.images.length);
  try {
    setStatus("amber", "pensando…");
    if (useStream) await sendStreaming(payload);
    else await sendBlocking(payload);
  } catch (err) {
    console.error("Erro ao enviar:", err);
    setStatus("red", "erro");
    conversation.push({ role: "assistant", content: `Erro na rede: ${err.message}` });
    renderMessages();
  }
}

// Aplica a resposta final (de /api/chat ou do evento 'done' do stream) à conversa.
function applyAssistantResponse(r) {
  if (r.conversationId) conversationId = r.conversationId;
  conversation.push({
    role: "assistant",
    content: r.text || "",
    meta: {
      provider: r.usedProvider, modelId: r.usedModelId, usedName: r.usedName,
      usedProviderLabel: r.usedProviderLabel, fallbackLevel: r.usedFallbackLevel,
      category: r.category, reason: r.reason, attempts: r.attempts, chain: r.chain,
      image: r.image, webRefs: r.webRefs, officeFiles: r.officeFiles, pendingActions: r.pendingActions
    }
  });
  const step = {
    provider: r.usedProvider, modelId: r.usedModelId, name: r.usedName || r.usedModelId,
    color: CATALOG[r.usedProvider]?.color || "#888", providerLabel: r.usedProviderLabel || r.usedProvider
  };
  renderStatusRouting(r.chain && r.chain.length ? r.chain : [step], r.usedFallbackLevel || 0, r.attempts || []);
  $("status-dot").className = "dot dot-" + (r.usedFallbackLevel > 0 ? "amber" : "green");
  $("status-active-label").textContent = `${step.providerLabel} · ${step.name}`;
  const oldArtifactCount = artifacts.length;
  renderMessages();
  if (artifacts.length > oldArtifactCount) { renderArtifacts(); if (!suppressAutoOpen) openArtifacts(); }
  loadConversations();
  setStatus("green", "ok");
}

// Caminho BLOQUEANTE (projeto/imagem/web).
async function sendBlocking(payload) {
  const el = $("chat-window");
  const thinking = document.createElement("div");
  thinking.className = "msg-thinking";
  thinking.textContent = "pensando…";
  el.appendChild(thinking);
  el.scrollTop = el.scrollHeight;
  const r = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  thinking.remove();
  if (!r.ok) {
    setStatus("red", "erro");
    conversation.push({ role: "assistant", content: `Erro do cowork: ${r.error}` });
    renderMessages();
    return;
  }
  applyAssistantResponse(r);
}

// Caminho com STREAMING (SSE via fetch): bolha temporária que cresce token-a-token.
async function sendStreaming(payload) {
  const el = $("chat-window");
  const bubble = document.createElement("div");
  bubble.className = "msg msg-assistant streaming";
  bubble.innerHTML = '<div class="stream-text"></div><span class="stream-caret">█</span>';
  el.appendChild(bubble);
  el.scrollTop = el.scrollHeight;
  const textEl = bubble.querySelector(".stream-text");

  const resp = await fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok || !resp.body) { bubble.remove(); throw new Error("falha ao iniciar streaming (" + resp.status + ")"); }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "", done = null;
  while (true) {
    const { value, done: rd } = await reader.read();
    if (rd) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 2);
      if (!line.startsWith("data:")) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === "text") {
        textEl.textContent = ev.text; el.scrollTop = el.scrollHeight;
        // cadência suave: cede ao navegador para pintar entre os pedaços
        // (modelos muito rápidos como o Cerebras chegam em lote; isso torna
        // o streaming visível em vez de aparecer tudo de uma vez)
        await new Promise((r) => setTimeout(r, 14));
      }
      else if (ev.type === "fallback") { setStatus("amber", "fallback…"); }
      else if (ev.type === "error") { bubble.remove(); conversation.push({ role: "assistant", content: "Erro: " + ev.error }); renderMessages(); setStatus("red", "falhou"); return; }
      else if (ev.type === "done") { done = ev; }
    }
  }
  bubble.remove();
  if (!done) { setStatus("red", "sem resposta"); return; }
  applyAssistantResponse(done);
}

// =================================================================
// RENDERIZAÇÃO DE MENSAGENS & MARKDOWN
// =================================================================
function renderMessages() {
  const el = $("chat-window");
  if (!el) return;
  
  if (conversation.length === 0) {
    el.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <div class="empty-logo">⌘</div>
        <h2>Seu cowork local está pronto</h2>
        <p>Modelos 100% grátis, memória persistente em disco, skills e artefatos. Modo autônomo escolhe o modelo por você.</p>
      </div>
    `;
    return;
  }
  
  el.innerHTML = conversation.map((msg, idx) => renderMessage(msg, idx)).join("");
  el.scrollTop = el.scrollHeight;
  
  // Bind actions
  el.querySelectorAll(".btn-apply-write").forEach(btn => {
    btn.addEventListener("click", () => {
      const msgIdx = parseInt(btn.dataset.msgIdx);
      const actionIdx = parseInt(btn.dataset.actionIdx);
      const action = conversation[msgIdx].meta.pendingActions[actionIdx];
      applyWriteAction(btn, action.path, action.newContent);
    });
  });
  
  el.querySelectorAll(".btn-run-cmd").forEach(btn => {
    btn.addEventListener("click", () => {
      const msgIdx = parseInt(btn.dataset.msgIdx);
      const actionIdx = parseInt(btn.dataset.actionIdx);
      const action = conversation[msgIdx].meta.pendingActions[actionIdx];
      runCommandAction(btn, action.command);
    });
  });
  
  el.querySelectorAll(".btn-reject-action").forEach(btn => {
    btn.addEventListener("click", () => {
      const actionsDiv = btn.closest(".pending-actions");
      actionsDiv.innerHTML = `<span class="pending-resolved no">✕ Ação recusada pelo usuário</span>`;
    });
  });
}

function renderMessage(msg, msgIdx) {
  const roleClass = msg.role === "user" ? "msg-user" : "msg-assistant";
  
  let html = `<div class="msg ${roleClass}">`;
  
  if (msg.role === "user") {
    html += `<div>${escapeHtml(msg.content)}</div>`;
    if (msg.images && msg.images.length) {
      for (const img of msg.images) {
        html += `<img src="${img}" class="msg-image" onclick="window.open('${img}')" />`;
      }
    }
  } else {
    const hasExtra = msg.meta && (msg.meta.image || (msg.meta.officeFiles && msg.meta.officeFiles.length) || (msg.meta.pendingActions && msg.meta.pendingActions.length));
    if ((!msg.content || !msg.content.trim()) && !hasExtra) {
      html += `<div style="color:var(--text-faint);font-style:italic;">(o modelo não retornou texto — reenvie a mensagem ou tente o modo manual)</div>`;
    } else {
      html += `<div>${renderMarkdown(msg.content)}</div>`;
    }

    if (msg.meta) {
      if (msg.meta.image) {
        html += `<img src="${msg.meta.image}" class="msg-image" onclick="window.open('${msg.meta.image}')" />`;
      }
      
      if (msg.meta.webRefs && msg.meta.webRefs.length) {
        html += `
          <div class="web-refs">
            <div class="web-refs-head">Fontes Consultadas:</div>
            ${msg.meta.webRefs.map(ref => `
              <a href="${ref.url}" target="_blank" class="web-ref" title="${escapeHtml(ref.title)}">
                🌐 [${escapeHtml(ref.title)}] ${escapeHtml(ref.url)}
              </a>
            `).join("")}
          </div>
        `;
      }
      
      if (msg.meta.officeFiles && msg.meta.officeFiles.length) {
        html += `
          <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
            ${msg.meta.officeFiles.map(file => `
              <a href="${file.url}" download="${file.name}" class="btn-download-file" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
                <span>📊</span>
                <span>Baixar ${escapeHtml(file.name)}</span>
              </a>
            `).join("")}
          </div>
        `;
      }
      
      if (msg.meta.pendingActions && msg.meta.pendingActions.length) {
        html += `<div class="pending-wrap">`;
        msg.meta.pendingActions.forEach((action, actionIdx) => {
          if (action.type === "write") {
            html += `
              <div class="pending-card">
                <div class="pending-head">Proposta de escrita: ${escapeHtml(action.path)}</div>
                <div class="diff">
                  ${action.diff.map(line => {
                    let cls = "diff-ctx";
                    if (line.t === "+") cls = "diff-add";
                    else if (line.t === "-") cls = "diff-del";
                    return `<div class="${cls}">${line.t} ${escapeHtml(line.line)}</div>`;
                  }).join("")}
                </div>
                <div class="pending-actions">
                  <button type="button" class="btn-primary btn-apply-write" data-msg-idx="${msgIdx}" data-action-idx="${actionIdx}">Aceitar Escrita</button>
                  <button type="button" class="btn-ghost btn-reject-action">Recusar</button>
                </div>
              </div>
            `;
          } else if (action.type === "command") {
            html += `
              <div class="pending-card">
                <div class="pending-head">Proposta de comando</div>
                <div class="cmd">${escapeHtml(action.command)}</div>
                <div class="pending-actions">
                  <button type="button" class="btn-primary btn-run-cmd" data-msg-idx="${msgIdx}" data-action-idx="${actionIdx}">Executar Comando</button>
                  <button type="button" class="btn-ghost btn-reject-action">Recusar</button>
                </div>
              </div>
            `;
          }
        });
        html += `</div>`;
      }
      
      if (msg.meta.provider) {
        html += `
          <div class="msg-meta-tag">
            🤖 ${escapeHtml(msg.meta.usedName || msg.meta.modelId)}
            <div class="tooltip-content">
Modelo: ${escapeHtml(msg.meta.usedName || msg.meta.modelId)}
Provedor: ${escapeHtml(msg.meta.usedProviderLabel || msg.meta.provider)}
Categoria: ${escapeHtml(msg.meta.category || 'auto')}
Razão: ${escapeHtml(msg.meta.reason || 'N/A')}
Fallback: ${msg.meta.fallbackLevel > 0 ? 'Slot ' + msg.meta.fallbackLevel : 'Principal'}
            </div>
          </div>
        `;
      }
    }
  }
  
  html += `</div>`;
  return html;
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  
  const codeBlockRegex = /```(\w+)?(?:\s+([^\n]+))?\n([\s\S]*?)\n```/g;
  html = html.replace(codeBlockRegex, (match, lang, filename, code) => {
    lang = lang || "txt";
    filename = filename ? filename.trim() : null;
    
    const decodedCode = code
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
      
    if (!filename) {
      const firstLine = decodedCode.split("\n")[0].trim().slice(0, 50) || "Código";
      const ext = getExtensionForLang(lang);
      const contentHash = Math.abs(hashString(decodedCode)).toString(36);
      const generatedFilename = `${firstLine}`;
      const actualFilename = `snippet-${contentHash}.${ext}`;
      
      if (!artifacts.some(a => a.actualFilename === actualFilename)) {
        artifacts.push({ filename: generatedFilename, actualFilename, lang, code: decodedCode });
      }
      
      return `
        <div class="artifact-card" data-filename="${escapeHtml(actualFilename)}" onclick="openArtifactByActualFilename('${escapeHtml(actualFilename)}')">
          <span class="artifact-card-icon">📄</span>
          <span class="artifact-card-name">${escapeHtml(generatedFilename)}</span>
          <span class="artifact-card-open">ABRIR ARTEFATO</span>
        </div>
      `;
    } else {
      if (!artifacts.some(a => a.filename === filename)) {
        artifacts.push({ filename, actualFilename: filename, lang, code: decodedCode });
      }
      return `
        <div class="artifact-card" data-filename="${escapeHtml(filename)}" onclick="openArtifactByActualFilename('${escapeHtml(filename)}')">
          <span class="artifact-card-icon">📄</span>
          <span class="artifact-card-name">${escapeHtml(filename)}</span>
          <span class="artifact-card-open">ABRIR ARTEFATO</span>
        </div>
      `;
    }
  });
  
  html = html.replace(/^### (.*?)$/gm, '<h3 style="color:var(--amber);font-size:13px;margin:8px 0 4px;">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 style="color:var(--green);font-size:14px;margin:10px 0 5px;">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 style="color:var(--green);font-size:16px;margin:12px 0 6px;">$1</h1>');
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong style="color:var(--text);">$1</strong>');
  html = html.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');
  html = html.replace(/_([\s\S]*?)_/g, '<em>$1</em>');
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/^&gt; (.*?)$/gm, '<blockquote>$1</blockquote>');
  
  const lines = html.split('\n');
  let inList = false, inOList = false, oIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // numbered list: matches "1. ", "2. ", etc.
    const olMatch = trimmed.match(/^(\d+)\. (.+)/);
    if (olMatch) {
      const content = olMatch[2];
      if (!inOList) {
        if (inList) { lines[i - 1] += '</ul>'; inList = false; }
        lines[i] = '<ol style="margin:6px 0;padding-left:20px;"><li>' + content + '</li>';
        inOList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2);
      if (inOList) { lines[i - 1] += '</ol>'; inOList = false; }
      if (!inList) {
        lines[i] = '<ul style="margin:6px 0;padding-left:20px;"><li>' + content + '</li>';
        inList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else {
      if (inList) { lines[i] = '</ul>' + lines[i]; inList = false; }
      if (inOList) { lines[i] = '</ol>' + lines[i]; inOList = false; }
    }
  }
  if (inList) lines[lines.length - 1] += '</ul>';
  if (inOList) lines[lines.length - 1] += '</ol>';
  html = lines.join('\n');
  
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<pre class="msg-code-body">([\s\S]*?)<\/pre>/g, (m, body) => {
    return `<pre class="msg-code-body">${body.replaceAll('<br>', '\n')}</pre>`;
  });
  html = html.replace(/<blockquote([\s\S]*?)<\/blockquote>/g, (m, body) => {
    return `<blockquote${body.replaceAll('<br>', '\n')}</blockquote>`;
  });
  
  return html;
}

window.openArtifactByActualFilename = function(actualFilename) {
  const idx = artifacts.findIndex(a => a.actualFilename === actualFilename || a.filename === actualFilename);
  if (idx >= 0) {
    activeArtifact = idx;
    renderArtifacts();
    openArtifacts();
  }
};

// =================================================================
// ARTEFATOS (Painel Lateral)
// =================================================================
function openArtifacts() {
  document.querySelector(".app").classList.add("artifacts-open");
}

function renderArtifacts() {
  const tabsEl = $("artifacts-tabs");
  if (!tabsEl) return;
  
  if (artifacts.length === 0) {
    tabsEl.innerHTML = "";
    $("artifacts-body").innerHTML = `<div style="padding:20px;color:var(--text-dim);text-align:center;">Nenhum artefato ativo</div>`;
    return;
  }
  
  tabsEl.innerHTML = artifacts.map((a, i) => `
    <button class="artifact-tab ${i === activeArtifact ? 'active' : ''}" data-index="${i}">
      ${escapeHtml(a.filename.length > 25 ? a.filename.slice(0, 22) + '...' : a.filename)}
    </button>
  `).join("");
  
  tabsEl.querySelectorAll(".artifact-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeArtifact = parseInt(btn.dataset.index);
      renderArtifacts();
    });
  });
  
  renderActiveArtifact();
}

function renderActiveArtifact() {
  const a = artifacts[activeArtifact];
  const bodyEl = $("artifacts-body");
  if (!a || !bodyEl) return;
  
  const isHtml = a.lang === "html" || a.filename.endsWith(".html") || a.filename.endsWith(".svg");
  
  let toolbarHtml = `
    <div class="artifact-toolbar">
      <button type="button" class="${artifactViewMode === 'code' ? 'active' : ''}" id="btn-art-code">Código</button>
  `;
  if (isHtml) {
    toolbarHtml += `
      <button type="button" class="${artifactViewMode === 'preview' ? 'active' : ''}" id="btn-art-preview">Visualizar</button>
    `;
  }
  toolbarHtml += `
      <button type="button" id="btn-art-download">Baixar</button>
    </div>
  `;
  
  let contentHtml = "";
  if (artifactViewMode === 'preview' && isHtml) {
    contentHtml = `<iframe class="artifact-preview" srcdoc="${escapeHtml(a.code)}"></iframe>`;
  } else {
    contentHtml = `<pre class="artifact-code"><code>${escapeHtml(a.code)}</code></pre>`;
  }
  
  bodyEl.innerHTML = toolbarHtml + contentHtml;
  
  const codeBtn = $("btn-art-code");
  if (codeBtn) {
    codeBtn.addEventListener("click", () => {
      artifactViewMode = 'code';
      renderActiveArtifact();
    });
  }
  
  const previewBtn = $("btn-art-preview");
  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      artifactViewMode = 'preview';
      renderActiveArtifact();
    });
  }
  
  const downloadBtn = $("btn-art-download");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([a.code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename.endsWith(".") ? a.filename + "txt" : a.filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  }
}

// =================================================================
// PENDING ACTION HANDLERS (Aplicações diretas)
// =================================================================
async function applyWriteAction(button, path, content) {
  setStatus("amber", "aplicando…");
  try {
    const r = await api(`/api/projects/${projectId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content })
    });
    setStatus("green", "ok");
    if (r.ok) {
      const actionsDiv = button.closest(".pending-actions");
      actionsDiv.innerHTML = `<span class="pending-resolved ok">✓ Arquivo gravado com sucesso</span>`;
      await updateProjectInfo();
    } else {
      alert("Erro ao aplicar escrita: " + r.error);
    }
  } catch (err) {
    setStatus("red", "erro");
    alert("Erro de rede: " + err.message);
  }
}

async function runCommandAction(button, command) {
  setStatus("amber", "executando…");
  const card = button.closest(".pending-card");
  
  let outDiv = card.querySelector(".cmd-out");
  if (!outDiv) {
    outDiv = document.createElement("pre");
    outDiv.className = "cmd-out";
    card.insertBefore(outDiv, button.closest(".pending-actions"));
  }
  outDiv.textContent = "Executando comando no terminal...\n";
  
  try {
    const r = await api(`/api/projects/${projectId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command })
    });
    setStatus("green", "ok");
    
    outDiv.textContent = `STDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    
    const actionsDiv = button.closest(".pending-actions");
    if (r.ok) {
      actionsDiv.innerHTML = `<span class="pending-resolved ok">✓ Comando executado com código ${r.code}</span>`;
      await updateProjectInfo();
    } else {
      actionsDiv.innerHTML = `<span class="pending-resolved no">✕ Falhou com código ${r.code}</span>`;
    }
  } catch (err) {
    setStatus("red", "erro");
    outDiv.textContent += `\nErro de rede: ${err.message}`;
  }
}

// =================================================================
// AUXILIARES
// =================================================================
function setStatus(color, text) {
  const dot = $("status-dot");
  const label = $("status-active-label");
  if (dot) dot.className = `dot dot-${color}`;
  if (label) label.textContent = text;
}

function refreshStatusHealth() {
  setInterval(async () => {
    try {
      await api("/api/health");
    } catch {
      setStatus("red", "desconectado");
    }
  }, 10_000);
}

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function getExtensionForLang(lang) {
  const map = {
    javascript: "js", js: "js",
    typescript: "ts", ts: "ts",
    python: "py", py: "py",
    html: "html", css: "css",
    json: "json", yaml: "yml", yml: "yml",
    bash: "sh", sh: "sh", shell: "sh",
    sql: "sql", c: "c", cpp: "cpp",
    go: "go", rust: "rs", rs: "rs",
    markdown: "md", md: "md"
  };
  return map[lang.toLowerCase()] || "txt";
}
