// web/app.js
// Front do Claudio. Estático, sem build, sem framework, sem segredo.
// Fala só com o Worker; a chave da Groq nunca passa por aqui.

(() => {
  "use strict";

  const API = (window.CLAUDIO_CONFIG || {}).api || "";

  const $ = (id) => document.getElementById(id);
  const conversa = $("conversa");
  const form = $("form");
  const entrada = $("entrada");
  const enviar = $("enviar");
  const atalhos = $("atalhos");
  const medidorTxt = $("medidor-txt");
  const medidor = $("medidor");

  // Histórico só em memória: o Claudio não guarda nada de ninguém.
  const historico = [];
  let ocupado = false;

  // Id de sessão do navegador — serve só para o rate limit por sessão.
  // É aleatório, não identifica pessoa, e o Worker só vê o hash dele.
  const sessionId = (() => {
    const k = "claudio-sess";
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      sessionStorage.setItem(k, v);
    }
    return v;
  })();

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  function bolha(texto, quem, variante) {
    const el = document.createElement("div");
    el.className = "bolha " + (quem === "voce" ? "voce" : "claudio") + (variante ? " " + variante : "");

    const rotulo = document.createElement("span");
    rotulo.className = "quem";
    rotulo.textContent = quem === "voce" ? "Você" : "Claudio";
    el.appendChild(rotulo);

    // texto puro, parágrafo por linha em branco — sem HTML vindo do modelo
    for (const par of String(texto).split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.textContent = par.replace(/\n/g, " ").trim();
      if (p.textContent) el.appendChild(p);
    }

    conversa.appendChild(el);
    rolar();
    return el;
  }

  function pensando() {
    const el = document.createElement("div");
    el.className = "pensando-bolha";
    el.innerHTML =
      '<span class="pontos"><i></i><i></i><i></i></span><span>Claudio tá pensando (mal)</span>';
    conversa.appendChild(el);
    document.body.classList.add("pensando");
    rolar();
    return el;
  }

  const rolar = () =>
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  // --------------------------------------------------------------
  // Envio
  // --------------------------------------------------------------
  async function mandar(texto) {
    if (ocupado) return;
    texto = String(texto || "").trim();
    if (!texto) return;

    atalhos.classList.add("some");
    bolha(texto, "voce");
    historico.push({ role: "user", content: texto });

    entrada.value = "";
    ajustarAltura();
    travar(true);
    const espera = pensando();

    let carga;
    try {
      const res = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: texto, history: historico.slice(0, -1), sessionId }),
      });
      carga = await res.json();
    } catch {
      carga = {
        text: "Não consegui nem chegar no servidor. Ou caiu a internet, ou eu caí — aposto em mim. Tenta de novo.",
        kind: "error",
      };
    }

    espera.remove();
    document.body.classList.remove("pensando");

    const variante =
      carga.kind === "blocked" ? "aviso" : carga.kind === "quota" || carga.kind === "offline" ? "cota" : "";

    bolha(carga.text || "Fiquei mudo. Acontece.", "claudio", variante);

    // Só resposta de verdade entra no histórico — bloqueio e cota não são
    // fala do personagem sobre o assunto, e poluiriam o contexto seguinte.
    if (carga.kind === "ok") historico.push({ role: "assistant", content: carga.text });

    travar(false);
    atualizarMedidor();
  }

  function travar(v) {
    ocupado = v;
    enviar.disabled = v;
    entrada.disabled = v;
    if (!v) entrada.focus();
  }

  // --------------------------------------------------------------
  // Medidor de cota — a restrição do free tier como elemento de marca
  // --------------------------------------------------------------
  async function atualizarMedidor() {
    // Sem guard de API vazia: string vazia significa MESMA ORIGEM (dev, ou o
    // site servido pelo próprio Worker), que é um caso válido — não ausência
    // de configuração.
    try {
      const r = await fetch(API + "/health");
      const h = await r.json();
      const resta = h?.requests?.remaining;
      if (typeof resta !== "number") return;

      const total = h.requests.budget || 1;
      const cafes = Math.max(0, Math.ceil((resta / total) * 10));
      medidorTxt.textContent = resta === 0 ? "cota seca" : `${resta} respostas hoje`;
      medidor.classList.toggle("seco", cafes <= 2);
      medidor.title =
        `Cota do dia: ${h.requests.used}/${total} usadas. ` +
        `Quando acabar, o Claudio some até amanhã — versão de graça tem teto.`;
    } catch {
      /* medidor é enfeite; se falhar, o app continua */
    }
  }

  // --------------------------------------------------------------
  // Entrada
  // --------------------------------------------------------------
  function ajustarAltura() {
    entrada.style.height = "auto";
    entrada.style.height = Math.min(entrada.scrollHeight, 160) + "px";
  }

  entrada.addEventListener("input", ajustarAltura);
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      mandar(entrada.value);
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    mandar(entrada.value);
  });

  atalhos.addEventListener("click", (e) => {
    const b = e.target.closest(".atalho");
    if (b) mandar(b.dataset.q);
  });

  // --------------------------------------------------------------
  // Abertura — o disclaimer de paródia na primeira mensagem (regra 4)
  // --------------------------------------------------------------
  async function abrir() {
    let saudacao = "E aí, chefia. Sou o Claudio. Respondo qualquer coisa, quase nunca certo, e nunca peço desculpa. Manda a pergunta.";
    try {
      const r = await fetch(API + "/api/greeting?s=" + encodeURIComponent(sessionId));
      const d = await r.json();
      if (d && d.text) saudacao = d.text;
    } catch {
      /* saudação de reserva já está definida */
    }

    bolha(
      saudacao +
        "\n\nAviso chato mas obrigatório: Claudio é uma paródia. Tudo que ele diz é invenção. Sem qualquer relação com qualquer empresa de IA real.",
      "claudio"
    );
    atualizarMedidor();
    entrada.focus();
  }

  abrir();
})();
