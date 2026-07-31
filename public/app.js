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
let autoApply = true;           // aplicar escrita/comandos direto, sem pedir aprovação (padrão)
let agentId = null;             // agente ativo (persona + conhecimento + conectores)
let editingKnowledge = [];      // blocos de conhecimento no editor de agente
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
  await loadAgents();
  await loadConversations();
  wireUI();
  refreshStatusHealth();
}

// =================================================================
// MODO (auto / manual)
// =================================================================
function wireUI() {
  // seletor de modelo desta conversa (janelinha)
  $("model-picker-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleModelPop(); });
  $("model-pop-close").addEventListener("click", () => toggleModelPop(false));
  $("model-pop").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => toggleModelPop(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleModelPop(false); });

  $("btn-new-chat").addEventListener("click", newChat);
  $("btn-customize").addEventListener("click", () => openCustomizeModal());
  $("modal-close").addEventListener("click", closeModal);
  // Fecha só quando o clique COMEÇA e TERMINA no fundo. Assim, selecionar
  // texto dentro da janela e soltar o mouse fora não fecha mais.
  let backdropPressed = false;
  $("modal-backdrop").addEventListener("mousedown", (e) => { backdropPressed = e.target.id === "modal-backdrop"; });
  $("modal-backdrop").addEventListener("click", (e) => {
    if (backdropPressed && e.target.id === "modal-backdrop") closeModal();
    backdropPressed = false;
  });
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

  // (Imagem e web agora são decididas pela IA a partir do prompt — sem botões.)

  // projeto
  $("btn-connect-folder").addEventListener("click", connectFolder);
  $("btn-clone").addEventListener("click", cloneRepo);
  $("btn-analyze").addEventListener("click", analyzeFolder);
  $("btn-index").addEventListener("click", indexFolder);
  $("btn-git").addEventListener("click", openGitModal);
  $("btn-agents").addEventListener("click", openAgentsModal);
  $("btn-roi").addEventListener("click", openRoiModal);
  $("agent-select").addEventListener("change", (e) => { agentId = e.target.value || null; reflectAgent(); });
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

// Nova conversa = reset LOCAL. A conversa só é criada no servidor quando a
// primeira mensagem é enviada (evita conversas vazias poluindo o histórico).
async function newChat() {
  conversationId = null;
  conversation = [];
  artifacts = [];
  activeArtifact = 0;
  attachedImages = [];
  clearReplyQuote();

  // limpa anexos e painel de artefatos
  const prev = $("file-preview");
  if (prev) { prev.innerHTML = ""; prev.classList.add("hidden"); }
  $("btn-attach")?.classList.remove("has-file");
  document.querySelector(".app")?.classList.remove("artifacts-open");

  $("status-routing").innerHTML = "";
  setStatus("green", "pronto");
  reflectModelPicker();

  renderMessages();
  renderArtifacts();
  await loadConversations();
  $("chat-input")?.focus();
}

// =================================================================
// MODALS
// =================================================================
function openModal(title, bodyHtml, { fixed = false } = {}) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  // janela de tamanho fixo (Personalização) — não "pula" ao navegar entre abas
  document.querySelector(".modal")?.classList.toggle("modal-fixed", fixed);
  $("modal-backdrop").classList.remove("hidden");
}

function closeModal() {
  $("modal-backdrop").classList.add("hidden");
  $("modal-body").innerHTML = "";
}

// =================================================================
// PERSONALIZAÇÃO — Memória · Skills · Modelos numa janela só.
// Tamanho fixo; navegação lista → detalhe desliza dentro da mesma janela.
// =================================================================
let custTab = "memoria";

async function openCustomizeModal(tab) {
  custTab = tab || custTab || "memoria";
  openModal("Personalização", `
    <div class="cust">
      <div class="cust-tabs" role="tablist">
        <button type="button" class="cust-tab" data-tab="memoria">Memória</button>
        <button type="button" class="cust-tab" data-tab="skills">Skills</button>
        <button type="button" class="cust-tab" data-tab="modelos">Modelos</button>
      </div>
      <div class="cust-stage">
        <div class="cust-list" id="cust-list"></div>
        <div class="cust-detail" id="cust-detail"></div>
      </div>
    </div>
  `, { fixed: true });

  $("modal-body").querySelectorAll(".cust-tab").forEach(b =>
    b.addEventListener("click", () => { custTab = b.dataset.tab; renderCustTab(); }));
  renderCustTab();
}

function custBack() {
  const st = document.querySelector(".cust-stage");
  st?.classList.remove("detail-open");
  setTimeout(() => { const d = $("cust-detail"); if (d && !st?.classList.contains("detail-open")) d.innerHTML = ""; }, 320);
}

// Abre o detalhe DENTRO da mesma janela (desliza da direita).
function custShowDetail(title, html) {
  const d = $("cust-detail");
  if (!d) return;
  d.innerHTML = `
    <div class="cust-detail-head">
      <button type="button" class="cust-back" id="cust-back">‹</button>
      <span class="cust-detail-title">${escapeHtml(title)}</span>
    </div>
    <div class="cust-detail-body">${html}</div>`;
  d.querySelector("#cust-back").addEventListener("click", custBack);
  document.querySelector(".cust-stage")?.classList.add("detail-open");
}

async function renderCustTab() {
  custBack();
  $("modal-body").querySelectorAll(".cust-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === custTab));
  const list = $("cust-list");
  if (!list) return;
  list.innerHTML = '<div class="cust-empty">carregando…</div>';

  if (custTab === "memoria") return renderCustMemoria(list);
  if (custTab === "skills") return renderCustSkills(list);
  return renderCustModelos(list);
}

// ---- Memória: lista enxuta, detalhe só ao clicar ----
async function renderCustMemoria(list) {
  const r = await api("/api/memory");
  const mems = r.memories || [];
  list.innerHTML = `
    <div class="cust-intro">Fatos que o Prisma lembra entre conversas. Ele grava e apaga sozinho.</div>
    ${mems.length ? mems.map((m, i) => `
      <button type="button" class="cust-item" data-i="${i}">
        <div class="cust-item-main">
          <div class="cust-item-name">${escapeHtml(m.name)}</div>
          <div class="cust-item-sub">${escapeHtml(m.description || m.body || "")}</div>
        </div>
        <span class="cust-item-tag">${escapeHtml(m.type || "")}</span>
        <span class="cust-chev">›</span>
      </button>`).join("") : '<div class="cust-empty">Nenhuma memória ainda.</div>'}
  `;
  list.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => {
    const m = mems[+b.dataset.i];
    custShowDetail(m.name, `
      <div class="cust-meta">${escapeHtml(m.type || "")}${m.updated ? " · " + escapeHtml(m.updated) : ""}</div>
      ${m.description ? `<div class="cust-desc">${escapeHtml(m.description)}</div>` : ""}
      <pre class="cust-pre">${escapeHtml(m.body || "")}</pre>
      <button class="btn-sm danger" id="cust-del">Esquecer esta memória</button>
    `);
    $("cust-del").addEventListener("click", async () => {
      if (!confirm(`Esquecer "${m.name}"?`)) return;
      await api(`/api/memory/${encodeURIComponent(m.name)}`, { method: "DELETE" });
      renderCustTab();
    });
  }));
}

// ---- Skills: lista + criar nova (no mesmo painel) ----
async function renderCustSkills(list) {
  const r = await api("/api/skills");
  const skills = r.skills || [];
  list.innerHTML = `
    <div class="cust-intro">Instruções especializadas que o Prisma injeta quando a tarefa pede.</div>
    <button type="button" class="cust-item cust-item-add" id="cust-new-skill">
      <div class="cust-item-main"><div class="cust-item-name">＋ Nova skill</div></div>
      <span class="cust-chev">›</span>
    </button>
    ${skills.length ? skills.map((s, i) => `
      <button type="button" class="cust-item" data-i="${i}">
        <div class="cust-item-main">
          <div class="cust-item-name">${escapeHtml(s.name)}</div>
          <div class="cust-item-sub">${escapeHtml(s.description || "")}</div>
        </div>
        <span class="cust-chev">›</span>
      </button>`).join("") : '<div class="cust-empty">Nenhuma skill cadastrada.</div>'}
  `;

  $("cust-new-skill").addEventListener("click", () => {
    custShowDetail("Nova skill", `
      <div class="form-row"><label>Nome</label><input id="sk-name" placeholder="ex: revisor-codigo"></div>
      <div class="form-row"><label>Quando usar</label><input id="sk-desc" placeholder="Revisa código procurando bugs"></div>
      <div class="form-row"><label>Instruções</label><textarea id="sk-body" rows="8" placeholder="Passo a passo que o modelo deve seguir…"></textarea></div>
      <button class="btn-sm" id="sk-save">Salvar skill</button>
    `);
    $("sk-save").addEventListener("click", async () => {
      const name = $("sk-name").value.trim(), body = $("sk-body").value.trim();
      if (!name || !body) return alert("Nome e instruções são obrigatórios.");
      await api("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: $("sk-desc").value, body }) });
      renderCustTab();
    });
  });

  list.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => {
    const s = skills[+b.dataset.i];
    custShowDetail(s.name, `
      ${s.description ? `<div class="cust-desc">${escapeHtml(s.description)}</div>` : ""}
      <pre class="cust-pre">${escapeHtml(s.body || "")}</pre>
      <button class="btn-sm danger" id="cust-del">Excluir skill</button>
    `);
    $("cust-del").addEventListener("click", async () => {
      if (!confirm(`Excluir a skill "${s.name}"?`)) return;
      await api(`/api/skills/${encodeURIComponent(s.name)}`, { method: "DELETE" });
      renderCustTab();
    });
  }));
}

// ---- Modelos: descoberta + provedores (detalhe lista os modelos) ----
async function renderCustModelos(list) {
  const disc = await api("/api/discovery/report");
  // só provedores que realmente oferecem modelos grátis (o Prisma é free-only)
  const sources = Object.entries(CATALOG)
    .filter(([, p]) => p.hasKey && p.models.some(m => m.input === 0 && m.output === 0));
  list.innerHTML = `
    <div class="cust-intro">O Prisma varre os provedores toda semana e usa apenas modelos 100% grátis.</div>
    <button type="button" class="cust-item" id="cust-disc">
      <div class="cust-item-main">
        <div class="cust-item-name">Descoberta automática</div>
        <div class="cust-item-sub">Última varredura: ${disc.lastRun ? new Date(disc.lastRun).toLocaleString("pt-BR") : "nunca"}</div>
      </div>
      <span class="cust-chev">›</span>
    </button>
    ${sources.map(([pid, p]) => {
      const free = p.models.filter(m => m.input === 0 && m.output === 0).length;
      return `<button type="button" class="cust-item" data-p="${pid}">
        <div class="cust-item-main">
          <div class="cust-item-name"><span class="cust-dot" style="background:${p.color || "var(--accent)"}"></span>${escapeHtml(p.label)}</div>
          <div class="cust-item-sub">${free} modelo(s) grátis</div>
        </div>
        <span class="cust-chev">›</span>
      </button>`;
    }).join("")}
  `;

  $("cust-disc").addEventListener("click", () => {
    custShowDetail("Descoberta automática", `
      <div class="cust-desc">Roda sozinha toda semana. Você pode forçar uma varredura agora.</div>
      <button class="btn-sm" id="run-disc">Varrer agora</button>
      <pre class="cust-pre" style="margin-top:12px">${escapeHtml(disc.report || "Sem relatório ainda.")}</pre>
    `);
    $("run-disc").addEventListener("click", async () => {
      const b = $("run-disc"); b.disabled = true; b.textContent = "varrendo…";
      const res = await api("/api/discovery/run", { method: "POST" });
      if (res.ok) { CATALOG = await api("/api/catalog"); renderCustTab(); }
      else { b.disabled = false; b.textContent = "Varrer agora"; alert("Erro: " + res.error); }
    });
  });

  list.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => {
    const p = CATALOG[b.dataset.p];
    const models = p.models.filter(m => m.input === 0 && m.output === 0)
      .sort((a, c) => String(c.released || "").localeCompare(String(a.released || "")));
    custShowDetail(p.label, models.length ? models.map(m => `
      <div class="cust-model">
        <div class="cust-item-name">${escapeHtml(m.name)}</div>
        <div class="cust-item-sub">${escapeHtml(String(m.released || "").slice(0, 10))}${m.context ? " · " + escapeHtml(m.context) : ""}</div>
      </div>`).join("") : '<div class="cust-empty">Sem modelos grátis neste provedor.</div>');
  }));
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
// ESCOLHA DE MODELO — por conversa, numa janelinha na barra do chat.
// "Automático" é sempre o padrão; escolher um modelo fixa-o nesta conversa.
// =================================================================
function setMode(newMode) { mode = newMode; }   // compat.

// Rótulo do botão: "Automático" ou o modelo escolhido.
function reflectModelPicker() {
  const label = $("status-active-label");
  if (!label) return;
  if (mode === "manual" && manualChain[0]) label.textContent = manualChain[0].name;
  else label.textContent = "Automático";
  $("model-picker-btn")?.classList.toggle("picked", mode === "manual" && Boolean(manualChain[0]));
}

function toggleModelPop(force) {
  const pop = $("model-pop");
  if (!pop) return;
  const show = force !== undefined ? force : pop.classList.contains("hidden");
  if (show) { renderModelPop(); pop.classList.remove("hidden"); }
  else pop.classList.add("hidden");
}

// Agrupa por FONTE (provedor) e ordena do mais recente para o mais antigo.
function renderModelPop() {
  const body = $("model-pop-body");
  if (!body) return;
  const isAuto = mode !== "manual" || !manualChain[0];

  let html = `
    <button type="button" class="model-opt model-opt-auto ${isAuto ? "on" : ""}" data-auto="1">
      <div class="model-opt-main">
        <div class="model-opt-name">Automático</div>
        <div class="model-opt-sub">O Prisma escolhe o melhor modelo grátis por tarefa e evita provedores fora do ar</div>
      </div>
      ${isAuto ? '<span class="model-check">✓</span>' : ""}
    </button>`;

  // provedores com chave e com modelos grátis
  const sources = Object.entries(CATALOG)
    .filter(([, p]) => p.hasKey && p.models.some(m => m.input === 0 && m.output === 0));

  for (const [pid, prov] of sources) {
    const models = prov.models
      .filter(m => m.input === 0 && m.output === 0)
      .sort((a, b) => String(b.released || "").localeCompare(String(a.released || "")));   // mais recente primeiro
    if (!models.length) continue;

    html += `<div class="model-source">
      <span class="model-source-dot" style="background:${prov.color || "var(--accent)"}"></span>
      ${escapeHtml(prov.label)}<span class="model-source-count">${models.length}</span>
    </div>`;

    for (const m of models) {
      const on = mode === "manual" && manualChain[0]?.provider === pid && manualChain[0]?.modelId === m.id;
      const year = String(m.released || "").slice(0, 7);
      html += `
        <button type="button" class="model-opt ${on ? "on" : ""}" data-p="${pid}" data-m="${escapeHtml(m.id)}">
          <div class="model-opt-main">
            <div class="model-opt-name">${escapeHtml(m.name)}</div>
            <div class="model-opt-sub">${year ? year : ""}${m.context ? ` · ${escapeHtml(m.context)}` : ""}</div>
          </div>
          ${on ? '<span class="model-check">✓</span>' : ""}
        </button>`;
    }
  }

  if (!sources.length) html += '<div class="muted" style="padding:10px">Nenhum modelo grátis disponível. Configure chaves no .env.</div>';
  body.innerHTML = html;

  body.querySelectorAll("[data-auto]").forEach(b => b.addEventListener("click", () => {
    mode = "auto"; manualChain = [null, null, null];
    reflectModelPicker(); toggleModelPop(false);
  }));
  body.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => {
    const pid = b.dataset.p, mid = b.dataset.m;
    const prov = CATALOG[pid];
    const m = prov.models.find(x => x.id === mid);
    mode = "manual";
    manualChain = [{ provider: pid, modelId: mid, name: m.name, color: prov.color, providerLabel: prov.label }, null, null];
    reflectModelPicker(); toggleModelPop(false);
  }));
}

function renderManualBuilder() { reflectModelPicker(); }   // compat. com o init

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
  
  clearReplyQuote();
  const hasImages = userMsg.images && userMsg.images.length;

  // A IA DECIDE (sem botões): analisa o prompt e resolve se busca na web e/ou
  // gera imagem. Web vale inclusive DENTRO de projetos (pesquisar + escrever).
  // Geração de imagem só fora de projeto (dentro, o foco é editar arquivos).
  let forceImage = false, web = false;
  if (mode === "auto" && !hasImages && text) {
    try {
      setStatus("amber", "analisando…");
      // manda também o pedido anterior do usuário (contexto p/ follow-ups tipo "e aí?")
      const prevUser = [...conversation].slice(0, -1).reverse().find(m => m.role === "user");
      const d = await api("/api/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, prev: prevUser ? String(prevUser.content).slice(0, 500) : "" }) });
      web = Boolean(d.web);
      forceImage = !projectId && Boolean(d.image);
    } catch {}
  }

  const payload = {
    conversationId,
    messages: conversation,
    mode,
    manualChain: mode === "manual" ? manualChain.filter(Boolean) : undefined,
    projectId,
    forceImage,
    autoApply,
    web,
    agentId
  };

  // Streaming no caso comum; projeto/imagem/web usam o caminho bloqueante (loop agêntico).
  // agente ativo usa o caminho bloqueante (persona + conectores + ROI)
  const useStream = !projectId && !forceImage && !web && !hasImages && !agentId;
  try {
    setStatus("amber", forceImage ? "gerando imagem…" : web ? "pesquisando…" : "pensando…");
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
      image: r.image, webRefs: r.webRefs, officeFiles: r.officeFiles, pendingActions: r.pendingActions,
      agent: r.agent, minutesSaved: r.minutesSaved
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
        <img src="logo-mark.png" alt="" class="empty-logo-img" />
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
      
      if (msg.meta.agent) {
        html += `<div class="agent-badge">${escapeHtml(msg.meta.agent.icon || "🤖")} ${escapeHtml(msg.meta.agent.name)}${
          msg.meta.minutesSaved ? ` <span class="agent-badge-saved">+${msg.meta.minutesSaved} min economizados</span>` : ""
        }</div>`;
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

// =================================================================
// AGENTES — criar "cópias suas" que executam trabalhos
// =================================================================
async function loadAgents() {
  const { agents } = await api("/api/agents");
  const sel = $("agent-select");
  sel.innerHTML = '<option value="">— sem agente (Prisma padrão) —</option>' +
    agents.map(a => `<option value="${a.id}" ${a.id === agentId ? "selected" : ""}>${escapeHtml(a.icon + "  " + a.name)}</option>`).join("");
  if (agentId && !agents.some(a => a.id === agentId)) agentId = null;
  reflectAgent();
  return agents;
}

function reflectAgent() {
  const sel = $("agent-select");
  if (!sel) return;
  sel.classList.toggle("agent-on", Boolean(agentId));
  const txt = agentId ? (sel.options[sel.selectedIndex]?.text || "").trim() : null;
  $("chat-input").placeholder = agentId
    ? `Falando com ${txt} — descreva a tarefa…`
    : "Fale com seu cowork…  (Enter envia · Shift+Enter quebra linha)";
}

const FREQ_OPTS = ["diaria", "semanal", "quinzenal", "mensal", "sob demanda"];

// ---- Estúdio: lista de agentes ----
async function openAgentsModal() {
  const agents = await loadAgents();
  const cards = agents.length ? agents.map(a => {
    const pot = Math.round((a.potentialMonthlyMinutes || 0) / 60);
    return `
      <div class="agent-card">
        <div class="agent-card-icon">${escapeHtml(a.icon || "🤖")}</div>
        <div class="agent-card-main">
          <div class="agent-card-name">${escapeHtml(a.name)}</div>
          <div class="agent-card-desc">${escapeHtml((a.description || a.role || "").slice(0, 110))}</div>
          <div class="agent-card-meta">
            ${a.activity?.task ? `<span class="tag">${escapeHtml(a.activity.task)}</span>` : ""}
            ${pot ? `<span class="tag tag-free">~${pot}h/mês</span>` : ""}
            ${a.knowledge?.length ? `<span class="tag">${a.knowledge.length} conhecimento${a.indexed ? " ✓" : ""}</span>` : ""}
            ${a.connectors?.web ? `<span class="tag">web</span>` : ""}
            ${a.connectors?.folder ? `<span class="tag">pasta</span>` : ""}
          </div>
        </div>
        <div class="agent-card-actions">
          <button class="btn-sm" data-use="${a.id}">Usar</button>
          <button class="btn-sm secondary" data-edit="${a.id}">Editar</button>
          <button class="btn-sm secondary" data-exp="${a.id}">Compartilhar</button>
          <button class="btn-sm danger" data-del="${a.id}">Excluir</button>
        </div>
      </div>`;
  }).join("") : '<div class="muted">Nenhum agente ainda. Crie o primeiro — ou importe um do Claude.</div>';

  openModal("🧩 Estúdio de Agentes", `
    <div class="agent-toolbar">
      <button class="btn-sm" id="ag-new">+ Novo agente</button>
      <button class="btn-sm secondary" id="ag-import">⬇ Importar arquivo</button>
      <button class="btn-sm secondary" id="ag-claude">✦ Importar do Claude</button>
    </div>
    <div id="agent-list">${cards}</div>
  `);

  $("ag-new").addEventListener("click", () => openAgentEditor(null));
  $("ag-import").addEventListener("click", importAgentFile);
  $("ag-claude").addEventListener("click", openClaudeImport);
  $("modal-body").querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", async () => {
    agentId = b.dataset.use; await loadAgents(); closeModal(); setStatus("green", "agente ativo");
  }));
  $("modal-body").querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", async () => {
    const r = await api(`/api/agents/${b.dataset.edit}`); openAgentEditor(r.agent);
  }));
  $("modal-body").querySelectorAll("[data-exp]").forEach(b => b.addEventListener("click", () => {
    window.open(`/api/agents/${b.dataset.exp}/export`, "_blank");
  }));
  $("modal-body").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Excluir este agente?")) return;
    await api(`/api/agents/${b.dataset.del}`, { method: "DELETE" });
    openAgentsModal();
  }));
}

// ---- Estúdio: editor do agente ----
async function openAgentEditor(agent) {
  const a = agent || {};
  const c = a.connectors || {};
  const act = a.activity || {};
  const own = a.owner || {};
  editingKnowledge = JSON.parse(JSON.stringify(a.knowledge || []));

  const projects = (await api("/api/projects")).projects || [];
  const skills = (await api("/api/skills")).skills || [];

  openModal(a.id ? `Editar — ${a.name}` : "Novo agente", `
    <div class="agent-form">
      <div class="form-grid">
        <div class="form-row" style="max-width:88px"><label>Ícone</label><input id="ag-icon" value="${escapeHtml(a.icon || "🤖")}"></div>
        <div class="form-row" style="flex:1"><label>Nome</label><input id="ag-name" value="${escapeHtml(a.name || "")}" placeholder="ex: Revisor de Contratos"></div>
      </div>
      <div class="form-row"><label>O que ele faz (resumo)</label><input id="ag-desc" value="${escapeHtml(a.description || "")}" placeholder="Revisa contratos e aponta cláusulas de risco"></div>

      <div class="form-section">1 · Persona</div>
      <div class="form-row"><label>Quem ele é</label><textarea id="ag-role" rows="3" placeholder="Você é um advogado revisor de contratos, objetivo e cético.">${escapeHtml(a.role || "")}</textarea></div>
      <div class="form-row"><label>Instruções (regras, formato de saída, restrições)</label><textarea id="ag-inst" rows="6" placeholder="Sempre liste riscos em bullets. Nunca invente cláusulas…">${escapeHtml(a.instructions || "")}</textarea></div>

      <div class="form-section">2 · Programação (playbook)</div>
      <div class="form-row"><label>Passos que ele executa — um por linha</label><textarea id="ag-play" rows="4" placeholder="Ler o documento&#10;Extrair as cláusulas de risco&#10;Sugerir redação alternativa">${escapeHtml((a.playbook || []).join("\n"))}</textarea></div>

      <div class="form-section">3 · Conhecimento</div>
      <div id="ag-know"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn-sm secondary" id="ag-know-add">+ Bloco de texto</button>
        <button type="button" class="btn-sm secondary" id="ag-know-file">📄 Carregar arquivo</button>
      </div>

      <div class="form-section">4 · Conectores</div>
      <div class="conn-grid">
        <label class="conn"><input type="checkbox" id="ag-web" ${c.web ? "checked" : ""}> 🌐 Pesquisar na web</label>
        <label class="conn"><input type="checkbox" id="ag-office" ${c.office !== false ? "checked" : ""}> 📊 Gerar planilha/doc</label>
        <label class="conn"><input type="checkbox" id="ag-image" ${c.image ? "checked" : ""}> 🎨 Gerar imagens</label>
        <label class="conn"><input type="checkbox" id="ag-auto" ${c.autoApply !== false ? "checked" : ""}> ⚡ Agir sem pedir aprovação</label>
      </div>
      <div class="form-grid">
        <div class="form-row" style="flex:1"><label>Pasta de trabalho</label>
          <select id="ag-folder"><option value="">— nenhuma —</option>${projects.map(p => `<option value="${p.id}" ${c.folder === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></div>
        <div class="form-row" style="flex:1"><label>Skills (Ctrl+clique p/ várias)</label>
          <select id="ag-skills" multiple size="3">${skills.map(s => `<option value="${escapeHtml(s.name)}" ${(c.skills || []).includes(s.name) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></div>
      </div>

      <div class="form-section">5 · Atividade que ele substitui <span class="muted">(base do cálculo de horas)</span></div>
      <div class="form-row"><label>Atividade (do seu job description)</label><input id="ag-task" value="${escapeHtml(act.task || "")}" placeholder="Revisão de contrato"></div>
      <div class="form-grid">
        <div class="form-row"><label>Minutos no manual</label><input id="ag-min" type="number" min="0" value="${act.minutesManual ?? 30}"></div>
        <div class="form-row"><label>Frequência</label><select id="ag-freq">${FREQ_OPTS.map(f => `<option value="${f}" ${act.frequency === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
        <div class="form-row"><label>Vezes por período</label><input id="ag-per" type="number" min="0" value="${act.perPeriod ?? 1}"></div>
      </div>

      <div class="form-section">6 · Dono <span class="muted">(consolida as visões gerenciais)</span></div>
      <div class="form-grid">
        <div class="form-row"><label>Usuário</label><input id="ag-user" value="${escapeHtml(own.user || "")}"></div>
        <div class="form-row"><label>Departamento</label><input id="ag-dept" value="${escapeHtml(own.department || "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>VP / Diretoria</label><input id="ag-vp" value="${escapeHtml(own.vp || "")}"></div>
        <div class="form-row"><label>Empresa</label><input id="ag-comp" value="${escapeHtml(own.company || "")}"></div>
      </div>

      <div class="agent-form-actions">
        <button class="btn-sm" id="ag-save">Salvar agente</button>
        ${a.id ? `<button class="btn-sm secondary" id="ag-index">📚 Indexar conhecimento</button>` : ""}
        <button class="btn-sm secondary" id="ag-back">Voltar</button>
      </div>
    </div>
  `);

  renderKnowledgeEditor();
  $("ag-know-add").addEventListener("click", () => { editingKnowledge.push({ title: "", content: "" }); renderKnowledgeEditor(); });
  $("ag-know-file").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".txt,.md,.csv,.json,.html,.js,.py,.yaml,.yml,.xml,.sql";
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = (e) => { editingKnowledge.push({ title: f.name, content: e.target.result }); renderKnowledgeEditor(); };
      rd.readAsText(f, "utf-8");
    });
    inp.click();
  });
  $("ag-back").addEventListener("click", openAgentsModal);
  $("ag-index")?.addEventListener("click", async () => {
    const btn = $("ag-index"); btn.textContent = "indexando…"; btn.disabled = true;
    const r = await api(`/api/agents/${a.id}/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    alert(r.ok ? `Conhecimento indexado: ${r.chunks} trecho(s).` : "Falha: " + r.error);
    btn.textContent = "📚 Indexar conhecimento"; btn.disabled = false;
  });
  $("ag-save").addEventListener("click", async () => {
    const payload = {
      id: a.id,
      icon: $("ag-icon").value, name: $("ag-name").value, description: $("ag-desc").value,
      role: $("ag-role").value, instructions: $("ag-inst").value,
      playbook: $("ag-play").value.split("\n").map(s => s.trim()).filter(Boolean),
      knowledge: editingKnowledge.filter(k => (k.content || "").trim()),
      connectors: {
        web: $("ag-web").checked, office: $("ag-office").checked, image: $("ag-image").checked,
        autoApply: $("ag-auto").checked, folder: $("ag-folder").value || null,
        skills: [...$("ag-skills").selectedOptions].map(o => o.value),
      },
      activity: { task: $("ag-task").value, minutesManual: +$("ag-min").value, frequency: $("ag-freq").value, perPeriod: +$("ag-per").value },
      owner: { user: $("ag-user").value, department: $("ag-dept").value, vp: $("ag-vp").value, company: $("ag-comp").value },
    };
    if (!payload.name.trim()) return alert("Dê um nome ao agente.");
    const r = await api("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) return alert("Erro ao salvar: " + r.error);
    if (payload.knowledge.length) {
      try { await api(`/api/agents/${r.agent.id}/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}
    }
    await loadAgents();
    openAgentsModal();
  });
}

function renderKnowledgeEditor() {
  const box = $("ag-know");
  if (!box) return;
  box.innerHTML = editingKnowledge.length ? editingKnowledge.map((k, i) => `
    <div class="know-block">
      <input class="know-title" data-i="${i}" value="${escapeHtml(k.title || "")}" placeholder="Título do bloco">
      <textarea class="know-content" data-i="${i}" rows="3" placeholder="Cole aqui o conteúdo que o agente precisa saber…">${escapeHtml(k.content || "")}</textarea>
      <button type="button" class="btn-icon know-del" data-i="${i}" title="Remover">✕</button>
    </div>`).join("") : '<div class="muted">Sem conhecimento fixo. Adicione políticas, exemplos, terminologia…</div>';
  box.querySelectorAll(".know-title").forEach(el => el.addEventListener("input", () => { editingKnowledge[+el.dataset.i].title = el.value; }));
  box.querySelectorAll(".know-content").forEach(el => el.addEventListener("input", () => { editingKnowledge[+el.dataset.i].content = el.value; }));
  box.querySelectorAll(".know-del").forEach(el => el.addEventListener("click", () => { editingKnowledge.splice(+el.dataset.i, 1); renderKnowledgeEditor(); }));
}

// ---- Importar agente: arquivo .prisma-agent.json ----
function importAgentFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json";
  inp.addEventListener("change", () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = async (e) => {
      const r = await api("/api/agents/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: e.target.result }) });
      if (!r.ok) return alert("Falha ao importar: " + r.error);
      await loadAgents(); openAgentsModal();
    };
    rd.readAsText(f, "utf-8");
  });
  inp.click();
}

// ---- Importar agente do Claude: prompt de extração + colar JSON ----
async function openClaudeImport() {
  const { prompt } = await api("/api/agents/claude-prompt");
  openModal("✦ Importar agente do Claude", `
    <div class="muted" style="margin-bottom:10px">Copie o prompt abaixo, cole na conversa com o seu agente do Claude, e traga a resposta dele de volta aqui.</div>
    <div class="form-row"><label>1 · Prompt para rodar no Claude</label>
      <textarea id="cl-prompt" rows="7" readonly>${escapeHtml(prompt)}</textarea></div>
    <button class="btn-sm secondary" id="cl-copy">📋 Copiar prompt</button>
    <div class="form-row" style="margin-top:14px"><label>2 · Cole aqui a resposta do Claude</label>
      <textarea id="cl-json" rows="7" placeholder="Cole o JSON que o Claude respondeu (pode colar com o texto em volta)"></textarea></div>
    <button class="btn-sm" id="cl-import">Criar agente no Prisma</button>
  `);
  $("cl-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(prompt); $("cl-copy").textContent = "✓ copiado"; }
    catch { $("cl-prompt").select(); document.execCommand("copy"); $("cl-copy").textContent = "✓ copiado"; }
  });
  $("cl-import").addEventListener("click", async () => {
    const text = $("cl-json").value.trim();
    if (!text) return alert("Cole a resposta do Claude.");
    const r = await api("/api/agents/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) return alert("Falha: " + r.error);
    await loadAgents();
    openAgentEditor(r.agent);   // abre para revisar/ajustar antes de usar
  });
}

// =================================================================
// PAINEL DE ROI — horas economizadas (usuário, depto, VP, empresa)
// =================================================================
let roiRate = localStorage.getItem("prisma-rate") || "";

async function openRoiModal() {
  const q = roiRate ? `?hourlyRate=${encodeURIComponent(roiRate)}` : "";
  const d = await api("/api/roi" + q);
  const money = (v) => (v === undefined || v === null) ? "" : ` · R$ ${Number(v).toLocaleString("pt-BR")}`;

  const table = (title, rows) => !rows || !rows.length ? "" : `
    <div class="roi-section">
      <div class="roi-section-title">${title}</div>
      ${rows.slice(0, 12).map(r => {
        const max = rows[0].hours || 1;
        return `<div class="roi-row">
          <div class="roi-key">${escapeHtml(String(r.key))}</div>
          <div class="roi-bar"><span style="width:${Math.max(3, (r.hours / max) * 100)}%"></span></div>
          <div class="roi-val">${r.hours}h${money(r.value)}</div>
        </div>`;
      }).join("")}
    </div>`;

  openModal("📈 Horas economizadas", `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-num">${d.totals.hours}h</div><div class="kpi-label">economizadas</div></div>
      <div class="kpi"><div class="kpi-num">${d.totals.runs}</div><div class="kpi-label">execuções</div></div>
      <div class="kpi"><div class="kpi-num">${d.totals.agents}</div><div class="kpi-label">agentes</div></div>
      <div class="kpi"><div class="kpi-num">${d.totals.potentialMonthlyHours}h</div><div class="kpi-label">potencial/mês</div></div>
      ${d.totals.value !== undefined ? `<div class="kpi kpi-accent"><div class="kpi-num">R$ ${Number(d.totals.value).toLocaleString("pt-BR")}</div><div class="kpi-label">valor gerado</div></div>` : ""}
    </div>

    <div class="roi-rate">
      <label>Custo/hora (R$):</label>
      <input id="roi-rate" type="number" min="0" value="${escapeHtml(roiRate)}" placeholder="ex: 120" style="width:110px">
      <button class="btn-sm secondary" id="roi-apply">Aplicar</button>
    </div>

    ${d.totals.runs === 0 ? '<div class="muted" style="margin:16px 0">Nenhuma execução registrada ainda. Use um agente no chat — cada uso soma as horas da atividade mapeada.</div>' : ""}
    ${table("Por usuário", d.byUser)}
    ${table("Por departamento", d.byDepartment)}
    ${table("Por VP / Diretoria", d.byVp)}
    ${table("Empresa (geral)", d.byCompany)}
    ${table("Por agente", d.byAgent)}
    ${table("Por atividade", d.byTask)}
    ${d.timeline && d.timeline.length ? `<div class="roi-section"><div class="roi-section-title">Evolução mensal</div>${d.timeline.map(t => `<div class="roi-row"><div class="roi-key">${t.month}</div><div class="roi-bar"><span style="width:${Math.max(3, (t.hours / Math.max(...d.timeline.map(x => x.hours))) * 100)}%"></span></div><div class="roi-val">${t.hours}h</div></div>`).join("")}</div>` : ""}

    <div class="roi-section">
      <div class="roi-section-title">Consolidação da equipe</div>
      <div class="muted" style="margin-bottom:8px">Cada pessoa exporta suas execuções; importe aqui para consolidar o time.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm secondary" id="roi-export">⬆ Exportar minhas execuções</button>
        <button class="btn-sm secondary" id="roi-import">⬇ Importar execuções da equipe</button>
      </div>
    </div>
  `);

  $("roi-apply").addEventListener("click", () => {
    roiRate = $("roi-rate").value || "";
    localStorage.setItem("prisma-rate", roiRate);
    openRoiModal();
  });
  $("roi-export").addEventListener("click", () => window.open("/api/roi/export", "_blank"));
  $("roi-import").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json";
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async (e) => {
        const r = await api("/api/roi/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runs: e.target.result }) });
        alert(r.ok ? `${r.added} execução(ões) importada(s).` : "Falha: " + r.error);
        openRoiModal();
      };
      rd.readAsText(f, "utf-8");
    });
    inp.click();
  });
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
