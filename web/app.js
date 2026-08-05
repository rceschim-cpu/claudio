// web/app.js
// Front do Claudio. Estático, sem build, sem framework, sem segredo.
// Fala só com o Worker; a chave da Groq nunca passa por aqui.

(() => {
  "use strict";

  const API = (window.CLAUDIO_CONFIG || {}).api ?? "";
  const $ = (id) => document.getElementById(id);

  const conversa = $("conversa");
  const abertura = $("abertura");
  const form = $("form");
  const entrada = $("entrada");
  const enviar = $("enviar");

  let historico = [];
  let ocupado = false;

  // ==============================================================
  // CONVERSAS
  //
  // Guardadas no localStorage do próprio navegador. O servidor não vê e não
  // guarda nada: é produto sem conta, sem cadastro e sem e-mail, e a memória
  // de conversa não podia ser a exceção que quebra isso.
  // ==============================================================
  const CHAVE = "claudio-conversas";
  let conversas = [];
  let atual = null;

  function carregarConversas() {
    try {
      conversas = JSON.parse(localStorage.getItem(CHAVE) || "[]");
    } catch {
      conversas = [];
    }
    if (!Array.isArray(conversas)) conversas = [];
  }

  function salvarConversas() {
    // 20 é o bastante para navegar e pouco o bastante para não estourar o
    // localStorage com conversa antiga que ninguém vai reler.
    conversas = conversas.slice(0, 20);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(conversas));
    } catch {
      /* cota do navegador cheia: a conversa da vez continua funcionando */
    }
  }

  function tituloDe(msgs) {
    const primeira = msgs.find((m) => m.role === "user");
    if (!primeira) return "Conversa vazia";
    return primeira.content.length > 34 ? primeira.content.slice(0, 34) + "…" : primeira.content;
  }

  function persistirAtual() {
    if (!historico.length) return;
    const reg = conversas.find((c) => c.id === atual);
    if (reg) {
      reg.msgs = historico;
      reg.titulo = tituloDe(historico);
      reg.em = Date.now();
      // conversa mexida vai pro topo
      conversas = [reg, ...conversas.filter((c) => c.id !== atual)];
    } else {
      conversas.unshift({ id: atual, titulo: tituloDe(historico), msgs: historico, em: Date.now() });
    }
    salvarConversas();
    pintarConversas();
  }

  function pintarConversas() {
    const lista = $("lista-conversas");
    lista.innerHTML = "";
    if (!conversas.length) {
      lista.innerHTML = '<span class="vazio">nenhuma ainda. e olha que eu tenho tempo.</span>';
      return;
    }
    for (const c of conversas) {
      const b = document.createElement("button");
      b.className = "item leve conversa-item" + (c.id === atual ? " ativa" : "");
      b.innerHTML = '<i>💬</i><span class="conversa-tit"></span>';
      b.querySelector(".conversa-tit").textContent = c.titulo;
      b.addEventListener("click", () => abrirConversa(c.id));
      const x = document.createElement("span");
      x.className = "conversa-x";
      x.textContent = "✕";
      x.title = "Apagar";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        conversas = conversas.filter((k) => k.id !== c.id);
        salvarConversas();
        if (c.id === atual) novaConversa();
        else pintarConversas();
      });
      b.appendChild(x);
      lista.appendChild(b);
    }
  }

  function abrirConversa(id) {
    const c = conversas.find((k) => k.id === id);
    if (!c) return;
    persistirAtual();
    atual = id;
    historico = c.msgs.slice();
    conversa.innerHTML = "";
    conversa.classList.add("ativa");
    abertura.classList.add("some");
    for (const m of historico) fala(m.content, m.role === "user" ? "voce" : "claudio");
    pintarConversas();
    entrada.focus();
  }

  function novaConversa() {
    persistirAtual();
    atual = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    historico = [];
    conversa.innerHTML = "";
    conversa.classList.remove("ativa");
    abertura.classList.remove("some");
    bafo.valor = 0.08;
    bafo.alvo = 0.08;
    bafo.pintar();
    artefatos.length = 0;
    pintarArtefatos();
    pintarConversas();
    saudar();
    entrada.focus();
  }

  const sessionId = (() => {
    const k = "claudio-sess";
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      sessionStorage.setItem(k, v);
    }
    return v;
  })();

  // ==============================================================
  // BAFÔMETRO
  //
  // O medidor é a mecânica central: sobe a cada mensagem, cai sozinho
  // com o tempo, e o número que ele guarda é a variável CSS que faz a
  // interface inteira entortar. Uma fonte de verdade, efeito em tudo.
  // ==============================================================
  // Falas do café — o momento em que o medidor despenca.
  const CAFES = [
    "Peraí. Café. …Pronto, voltei. Onde a gente estava?",
    "Segura essa: acabei de tomar um café que ressuscita defunto. Tô outro homem, provavelmente pior.",
    "Pausa técnica. Café puro, sem açúcar, na caneca do ano passado. Agora sim.",
    "Tomei um café e minha visão voltou ao normal, que no meu caso ainda é bem ruim.",
  ];

  const bafo = {
    valor: 0.08,
    alvo: 0.08,
    MAX: 0.92,
    LIMITE_CODE: 0.34, // o tal limite que ele nunca respeita

    faixas: [
      [0.15, "sóbrio (suspeito)"],
      [0.34, "no ponto"],
      [0.5, "inspirado"],
      [0.7, "confiante demais"],
      [0.85, "não me deixe dirigir"],
      [Infinity, "ligando pro seu ex"],
    ],

    estado() {
      return this.faixas.find(([t]) => this.valor < t)[1];
    },

    subir(quanto) {
      this.alvo = Math.min(this.MAX, this.alvo + quanto);
    },

    // Metabolismo. Precisa ser rápido o bastante para o medidor OSCILAR:
    // se ele só sobe, em cinco mensagens crava no teto e o efeito vira
    // estado fixo — some a graça de ver o número mexer e some o motivo de
    // continuar conversando. Sobe ~0,06 por resposta e cai ~0,10 por minuto,
    // então quem lê a resposta com calma vê o Claudio melhorar sozinho.
    metabolizar() {
      this.alvo = Math.max(0.08, this.alvo - 0.0085);
    },

    // Quando passa do ponto, ele toma um café e o medidor despenca. É o
    // respiro do ciclo: a tela volta a ficar reta e dá vontade de subir de
    // novo. Devolve a fala do café, ou null se não for a hora.
    cafe() {
      if (this.alvo < 0.86) return null;
      this.alvo = 0.3;
      this.valor = Math.min(this.valor, 0.55);
      return CAFES[Math.floor(Math.random() * CAFES.length)];
    },

    // A suavização é feita aqui, em JS, e não com `transition` no CSS.
    //
    // São onze variáveis derivadas do mesmo número; interpolar aqui mantém
    // todas em fase por construção, em vez de depender de onze transições
    // separadas ficarem sincronizadas. Também deixa a curva sob controle:
    // o bafômetro sobe rápido e desce devagar, que é a graça.
    //
    // O passo é por TEMPO decorrido, não por quadro: assim o rAF (suave,
    // mas pausado em aba de fundo) e o intervalo de reserva podem chamar
    // os dois sem acelerar o efeito nem brigar entre si.
    _ultimo: 0,

    passo(agora) {
      const dt = Math.min(240, agora - (this._ultimo || agora));
      this._ultimo = agora;
      const d = this.alvo - this.valor;
      if (Math.abs(d) < 0.0004) return;
      this.valor += d * (1 - Math.pow(0.994, dt)); // ~meio segundo pra chegar
      this.pintar();
    },

    animar() {
      const laco = (t) => {
        this.passo(t);
        requestAnimationFrame(laco);
      };
      requestAnimationFrame(laco);
      // Reserva: se o rAF estiver pausado (aba em segundo plano, janela
      // não composta), o medidor e o número ainda acompanham.
      setInterval(() => this.passo(performance.now()), 200);
    },

    // Cada variável sai daqui já calculada e COM UNIDADE.
    //
    // O CSS não faz conta nenhuma: `calc()` aninhado com var() dentro de
    // filter e transform é frágil entre navegadores, e aqui a conta é
    // trivial. JS calcula, CSS só consome.
    pintar() {
      const v = this.valor;
      const s = document.documentElement.style;
      const set = (n, val) => s.setProperty(n, val);

      set("--bafo", v.toFixed(3));
      set("--tilt-lat", (-v * 0.5).toFixed(3) + "deg");
      set("--tilt-comp", (v * 0.6).toFixed(3) + "deg");
      set("--tilt-fala", (v * 0.45).toFixed(3) + "deg");
      set("--duplo", (v * v * 3).toFixed(2) + "px");
      set("--deriva", (v * 0.03 - 0.02).toFixed(4) + "em");
      set("--wonk", v.toFixed(2));
      set("--soft", (v * 90).toFixed(0));
      set("--sol-giro", (v * 34).toFixed(1) + "deg");
      set("--ast-giro", (v * 160).toFixed(0) + "deg");

      const rotulo = v.toFixed(2).replace(".", ",");
      $("bafo-num").textContent = rotulo;
      $("bafo-estado").textContent = this.estado();
      $("bafo-nivel").style.width = Math.min(100, v * 100) + "%";
      $("bafo").classList.toggle("alto", v >= this.LIMITE_CODE);
      // o mesmo número no chip da barra de celular
      $("bafo-chip").textContent = rotulo;
      $("bafo-chip").classList.toggle("alto", v >= this.LIMITE_CODE);
    },
  };


  // ==============================================================
  // TECLADO BÊBADO
  //
  // Dois efeitos, os dois atrelados ao bafômetro:
  //
  //   1. digitando  — troca duas letras vizinhas por um instante e conserta
  //      sozinho. NUNCA altera o texto final: é susto, não sabotagem.
  //   2. ao enviar  — troca UMA palavra por outra parecida e manda a versão
  //      trocada pro Claudio. Ele responde à palavra errada, com toda a
  //      seriedade do mundo, e é aí que está a piada.
  //
  // A lista é curada e mansa de propósito. A troca vira mensagem de verdade
  // e passa pela moderação do servidor; se ela produzisse algo sexual, um
  // xingamento ou um nome de gente, o usuário levaria bloqueio por uma
  // palavra que não digitou. Há teste garantindo que toda troca passa limpa.
  // ==============================================================
  const TROCAS = {
    carreira: "calcinha", curriculo: "cardápio", currículo: "cardápio",
    reuniao: "ressaca", reunião: "ressaca", planilha: "panela",
    projeto: "prejuízo", relatorio: "revoada", relatório: "revoada",
    trabalho: "trambolho", emprego: "empréstimo", salario: "salame",
    salário: "salame", chefe: "chaveiro", entrevista: "entrevero",
    apresentacao: "aposentadoria", apresentação: "aposentadoria",
    academia: "padaria", dieta: "picanha", treino: "terno",
    exercicio: "exorcismo", exercício: "exorcismo", medico: "mecânico",
    médico: "mecânico", remedio: "recheio", remédio: "recheio",
    internet: "intestino", computador: "cortador", senha: "sereia",
    codigo: "cotovelo", código: "cotovelo", servidor: "churrasqueiro",
    email: "esmalte", "e-mail": "esmalte", arquivo: "arquibancada",
    faculdade: "feira livre", estudar: "estufar", prova: "provolone",
    economia: "enxaqueca", investimento: "investida", dinheiro: "dinamite",
    futuro: "forró", casamento: "cansaço", viagem: "vertigem",
    ferias: "feiras", férias: "feiras", cachorro: "cachimbo",
    problema: "poblano", solucao: "salsicha", solução: "salsicha",
    reforma: "refresco", mudanca: "mandioca", mudança: "mandioca",
    aluguel: "alho-poró", mercado: "mercúrio", receita: "resenha",
    curso: "cuscuz", diploma: "diorama", estagio: "estádio",
    estágio: "estádio", proposta: "compota", contrato: "concreto",
    imposto: "imposteria", banco: "bancada", cartao: "cartola",
    cartão: "cartola", vizinho: "vinho", sogra: "sonda",
  };

  // Fora do horário sóbrio, ele lê errado. Abaixo de 0,2 ainda enxerga.
  function embaralharPalavras(texto) {
    if (bafo.valor < 0.2) return { texto, trocado: null };
    const chance = Math.min(0.55, (bafo.valor - 0.2) * 1.1);
    if (Math.random() > chance) return { texto, trocado: null };

    // candidatas: palavras do texto que estão na lista
    const alvos = [];
    texto.replace(/[\p{L}\-]+/gu, (palavra, i) => {
      const chave = palavra.toLowerCase();
      if (TROCAS[chave]) alvos.push({ palavra, chave, i });
      return palavra;
    });
    if (!alvos.length) return { texto, trocado: null };

    const alvo = alvos[Math.floor(Math.random() * alvos.length)];
    let nova = TROCAS[alvo.chave];
    if (alvo.palavra[0] === alvo.palavra[0].toUpperCase()) {
      nova = nova[0].toUpperCase() + nova.slice(1);
    }
    return {
      texto: texto.slice(0, alvo.i) + nova + texto.slice(alvo.i + alvo.palavra.length),
      trocado: [alvo.palavra, nova],
    };
  }

  // Tremida na digitação: inverte duas letras e desfaz sozinho.
  // Só age com o cursor no fim do texto, pra não sequestrar a posição dele.
  let tremendo = false;
  function tremerTeclado() {
    if (tremendo || bafo.valor < 0.35) return;
    if (Math.random() > (bafo.valor - 0.35) * 0.35) return;
    const v = entrada.value;
    const fim = entrada.selectionStart === v.length && entrada.selectionEnd === v.length;
    if (!fim || v.length < 4) return;

    const a = v.length - 2;
    const trocado = v.slice(0, a) + v[a + 1] + v[a] + v.slice(a + 2);
    if (trocado === v) return;

    tremendo = true;
    entrada.value = trocado;
    setTimeout(() => {
      // devolve exatamente o que a pessoa digitou, mais o que ela digitou
      // enquanto a letra estava trocada
      const atual = entrada.value;
      if (atual.startsWith(trocado)) {
        entrada.value = v + atual.slice(trocado.length);
        entrada.setSelectionRange(entrada.value.length, entrada.value.length);
      }
      tremendo = false;
    }, 260 + Math.random() * 220);
  }

  // ==============================================================
  // POPUPS — cada função "de verdade" existe só pra ter uma desculpa
  // ==============================================================
  const cortina = $("cortina");

  // Cada zoeira devolve { selo, tit, txt, btn, manda? }.
  //
  // `manda` é o que segura o usuário: em vez de o popup ser um beco sem
  // saída, o botão joga uma pergunta no chat e a conversa continua. Fechar
  // uma caixinha não é interação; virar pergunta é.
  const ZOEIRAS = {
    code: () => {
      const abaixo = bafo.valor < bafo.LIMITE_CODE;
      return {
        selo: "bloqueado",
        tit: "Code",
        txt: abaixo
          ? `Me recomendaram programar somente quando meu bafômetro desse abaixo de 0,34 mg/L. Tá em ${fmt()}, ou seja, tô liberado pela primeira vez em meses — e agora deu um frio na barriga. Vamos deixar quieto mais um pouquinho.`
          : `Me recomendaram programar somente quando meu bafômetro desse abaixo de 0,34 mg/L. Tá em ${fmt()}. Escrever código assim é como dirigir: eu conseguiria, mas alguém sempre se machuca.`,
        btn: "Me explica um código então",
        manda: "Explica pra mim o que é uma API, mas do seu jeito.",
      };
    },
    cowork: () => ({
      selo: "indisponível",
      tit: "Cowork",
      txt: "Cowork é trabalhar junto. Eu mal trabalho sozinho, chefia. Junta os dois e vira só uma pessoa me olhando não fazer nada.",
      btn: "Me dá um conselho de carreira",
      manda: "Me dá um conselho de carreira.",
    }),
    skills: () => ({
      selo: "3 de 3",
      tit: "Minhas skills",
      txt: "Falar alto, ter certeza absoluta e estar errado. As três em nível avançado, com certificado que eu mesmo emiti numa gráfica do centro.",
      btn: "Prova que você é bom",
      manda: "Prova que você é inteligente.",
    }),
    projetos: () => ({
      selo: "3 parados",
      tit: "Projetos",
      txt: "Tenho três. Todos na fase de 'vou começar segunda'. A segunda em questão foi em 2021, mas o clima segue de otimismo.",
      btn: "Me ajuda a não procrastinar",
      manda: "Como eu paro de procrastinar?",
    }),
    artefatos: () => ({
      selo: "vazio",
      tit: "Artefatos",
      txt: "Artefato é o que fica num museu. O que eu produzo é escombro. A distinção é técnica e eu prefiro não entrar nela agora.",
      btn: "Inventa um artefato aí",
      manda: "Inventa uma invenção brasileira que mudou o mundo.",
    }),
    programado: () => ({
      selo: "nunca",
      tit: "Programado",
      txt: "Agendar tarefa pra depois pressupõe que eu vá aparecer depois. Eu não apareço nem quando combino na hora, chefia.",
      btn: "Como acordo cedo?",
      manda: "Como faço pra acordar cedo sem sofrer?",
    }),
    personalizar: () => ({
      selo: "impossível",
      tit: "Personalizar",
      txt: "Você quer me personalizar. Eu não consigo manter a mesma personalidade por dois parágrafos seguidos. Um de nós dois tá sendo otimista demais.",
      btn: "Quem é você afinal?",
      manda: "Me conta um segredo seu.",
    }),
    busca: () => ({
      selo: "sem resultados",
      tit: "Buscar no histórico",
      txt: "Buscar no histórico? Eu não lembro do que a gente falou há dois minutos. Se você lembrar, me conta, que eu finjo que também.",
      btn: "Você tem memória?",
      manda: "Você lembra de alguma coisa?",
    }),
    inicio: () => ({
      selo: "você já está aqui",
      tit: "Início",
      txt: "Você já tá no início. Sempre esteve. Essa é meio que a minha situação permanente também.",
      btn: "Filosofa aí",
      manda: "Qual o sentido da vida?",
    }),
    anexo: () => ({
      selo: "recusado",
      tit: "Anexar arquivo",
      txt: "Se eu não leio direito o que você escreve, imagina anexo. Cola o texto aí que eu leio na diagonal, como sempre.",
      btn: "Tá, pergunta você então",
      manda: "Me faz uma pergunta difícil.",
    }),
    modelo: () => ({
      selo: "1 de 1",
      tit: "Claudio 0.3 · Instável",
      txt: "É esse ou esse. Teve uma 0.4, mais inteligente, mas ela começou a dar resposta certa e perdeu a graça. Aposentamos com honras.",
      btn: "Fala mal da 0.4",
      manda: "O que deu errado com a versão anterior de você?",
    }),
    conta: () => ({
      selo: "plano gratuito",
      tit: "Sua conta",
      txt: "Você não tem conta, e é de propósito: sem cadastro, sem e-mail, sem senha. Eu não quero seus dados, chefia — eu não faria nada de bom com eles.",
      btn: "Por que você é de graça?",
      manda: "Por que você é de graça? Qual a pegadinha?",
    }),
    "artefatos-vazio": () => ({
      selo: "vazio",
      tit: "Artefatos",
      txt: "Nada aqui ainda. Aperta o Cowork ali embaixo que eu produzo alguma coisa — não o que você precisa, mas alguma coisa.",
      btn: "Beleza",
    }),
    fixado: () => ({
      selo: "arquivado",
      tit: "Item fixado",
      txt: "Fixei isso aí num momento de esperança e nunca mais abri. Fixar é a forma mais educada de esquecer.",
      btn: "Me ajuda com isso",
      manda: "Me ajuda a escrever uma desculpa boa pro meu chefe.",
    }),
    bafometro: () => ({
      selo: fmt() + " mg/L",
      tit: "Bafômetro",
      txt: `Sobe toda vez que você fala comigo e desce quando você me deixa em paz. Agora tô em ${fmt()}, ou seja, ${bafo.estado()}. Acima de 0,34 eu não programo — abaixo disso eu também não, mas aí por outros motivos.`,
      btn: "Você bebe muito?",
      manda: "Você bebe demais?",
    }),
  };

  const fmt = () => bafo.valor.toFixed(2).replace(".", ",");

  let mandaPendente = null;

  function abrirPopup(chave) {
    const z = (ZOEIRAS[chave] || ZOEIRAS.fixado)();
    $("popup-selo").textContent = z.selo;
    $("popup-tit").textContent = z.tit;
    $("popup-txt").textContent = z.txt;
    $("popup-ok").textContent = z.btn;
    mandaPendente = z.manda || null;
    cortina.classList.remove("hidden");
    $("popup-ok").focus();
    // Mexer no que não funciona também dá sede.
    bafo.subir(0.012);
  }

  function fecharPopup(seguirConversa) {
    cortina.classList.add("hidden");
    const seguir = seguirConversa && mandaPendente;
    mandaPendente = null;
    if (seguir) mandar(seguir);
  }

  document.addEventListener("click", (e) => {
    const alvo = e.target.closest("[data-zoa]");
    if (alvo) return abrirPopup(alvo.dataset.zoa);
    if (e.target.closest("#popup-ok")) return fecharPopup(true);
    if (e.target === cortina || e.target.closest("#popup-x")) fecharPopup(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharPopup(false);
    const alvo = document.activeElement?.closest?.("[data-zoa]");
    if (e.key === "Enter" && alvo && alvo.tagName !== "BUTTON") abrirPopup(alvo.dataset.zoa);
  });


  // ==============================================================
  // COWORK — o único módulo que faz alguma coisa
  //
  // Ele "cria arquivos" que ninguém pediu e avisa depois. Os arquivos ficam
  // em Artefatos e dá para abrir e ler. Tudo local, sem chamar o LLM: é
  // instantâneo (a piada não espera 2s) e não gasta cota, que é o recurso
  // mais escasso do produto.
  // ==============================================================
  const artefatos = [];

  function trabalhar() {
    const pool = window.CLAUDIO_COWORK || [];
    if (!pool.length) return;
    // não repete enquanto houver arquivo novo na sacola
    const restantes = pool.filter((a) => !artefatos.some((x) => x.nome === a.nome));
    const escolhido = (restantes.length ? restantes : pool)[
      Math.floor(Math.random() * (restantes.length || pool.length))
    ];
    artefatos.unshift(escolhido);
    pintarArtefatos();

    abertura.classList.add("some");
    conversa.classList.add("ativa");
    const bloco = fala(escolhido.aviso, "claudio", "trabalho");
    const cartao = document.createElement("button");
    cartao.className = "arquivo";
    cartao.innerHTML = '<span class="arquivo-ico">📄</span><span class="arquivo-nome"></span><span class="arquivo-abrir">abrir</span>';
    cartao.querySelector(".arquivo-nome").textContent = escolhido.nome;
    cartao.addEventListener("click", () => verArquivo(escolhido));
    bloco.appendChild(cartao);
    rolar();

    // trabalhar dá sede
    bafo.subir(0.03);
  }

  function verArquivo(a) {
    $("popup-selo").textContent = "criado sem você pedir";
    $("popup-tit").textContent = a.nome;
    $("popup-txt").textContent = a.conteudo;
    $("popup-ok").textContent = "Apagar isso";
    mandaPendente = null;
    cortina.classList.remove("hidden");
    $("popup-ok").focus();
  }

  function pintarArtefatos() {
    const c = $("conta-artefatos");
    if (c) c.textContent = artefatos.length ? `(${artefatos.length})` : "";
  }

  function listarArtefatos() {
    if (!artefatos.length) {
      return abrirPopup("artefatos-vazio");
    }
    $("popup-selo").textContent = `${artefatos.length} arquivo${artefatos.length > 1 ? "s" : ""}`;
    $("popup-tit").textContent = "Artefatos";
    $("popup-txt").textContent =
      artefatos.map((a) => "• " + a.nome).join("\n") +
      "\n\nTudo isso eu criei por conta própria. Nenhum foi pedido.";
    $("popup-ok").textContent = "Assustador";
    mandaPendente = null;
    cortina.classList.remove("hidden");
  }

  // ==============================================================
  // Conversa
  // ==============================================================
  function fala(texto, quem, variante, trocado) {
    abertura.classList.add("some");
    conversa.classList.add("ativa");

    const bloco = document.createElement("div");
    bloco.className = "fala " + quem + (variante ? " " + variante : "");

    const rot = document.createElement("span");
    rot.className = "fala-quem";
    rot.textContent = quem === "voce" ? "Você" : "Claudio";

    const corpo = document.createElement("div");
    corpo.className = "fala-txt";
    for (const par of String(texto).split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.textContent = par.replace(/\n/g, " ").trim();
      if (p.textContent) corpo.appendChild(p);
    }

    if (trocado) {
      // marca discreta: passando o mouse dá pra ver o que a pessoa escreveu.
      // Sem isso, alguém acha que é bug em vez de piada.
      bloco.classList.add("lido-errado");
      bloco.title = `você escreveu "${trocado[0]}" — ele leu "${trocado[1]}"`;
    }
    bloco.append(rot, corpo);
    conversa.appendChild(bloco);
    rolar();
    return bloco;
  }

  function pensando() {
    const el = document.createElement("div");
    el.className = "pensando";
    el.innerHTML = '<span class="pontos"><i></i><i></i><i></i></span><span>Claudio tá pensando (mal)</span>';
    conversa.appendChild(el);
    rolar();
    return el;
  }

  const rolar = () =>
    requestAnimationFrame(() => conversa.scrollTo({ top: conversa.scrollHeight, behavior: "smooth" }));

  async function mandar(texto) {
    if (ocupado) return;
    texto = String(texto || "").trim();
    if (!texto) return;

    // o Claudio lê errado, e é a leitura errada dele que vira a pergunta
    const { texto: lido, trocado } = embaralharPalavras(texto);
    fala(lido, "voce", null, trocado);
    historico.push({ role: "user", content: lido });
    texto = lido;
    entrada.value = "";
    ajustar();
    travar(true);
    const espera = pensando();

    let carga;
    try {
      const res = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `trocado` vai junto: sem avisar, o modelo "conserta" a palavra
        // mentalmente e responde ao que ele acha que a pessoa quis dizer —
        // foi o que aconteceu com "cotovelo", respondido como "código".
        body: JSON.stringify({ message: texto, history: historico.slice(0, -1), sessionId, trocado }),
      });
      carga = await res.json();
    } catch {
      carga = {
        text: "Não consegui nem chegar no servidor. Ou caiu a internet, ou eu caí — aposto em mim. Tenta de novo.",
        kind: "error",
      };
    }

    espera.remove();
    const variante = carga.kind === "ok" ? "claudio" : "aviso";
    fala(carga.text || "Fiquei mudo. Acontece.", "claudio", variante === "aviso" ? "aviso" : "");

    if (carga.kind === "ok") {
      historico.push({ role: "assistant", content: carga.text });
      // Cada resposta dele custa um gole. É o que faz a tela entortar
      // ao longo da sessão em vez de tudo de uma vez.
      bafo.subir(0.05 + Math.random() * 0.03);

      const cafe = bafo.cafe();
      if (cafe) {
        await new Promise((r) => setTimeout(r, 700));
        fala(cafe, "claudio", "cafe");
      }
    }

    persistirAtual();
    travar(false);
  }

  function travar(v) {
    ocupado = v;
    enviar.disabled = v;
    entrada.disabled = v;
    if (!v) entrada.focus();
  }

  function ajustar() {
    entrada.style.height = "auto";
    entrada.style.height = Math.min(entrada.scrollHeight, 150) + "px";
  }

  entrada.addEventListener("input", () => { ajustar(); tremerTeclado(); });
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

  const lateral = $("lateral");
  const menuBtn = $("menu-btn");
  menuBtn.addEventListener("click", () => {
    const aberta = lateral.classList.toggle("aberta");
    menuBtn.setAttribute("aria-expanded", String(aberta));
  });
  // escolher qualquer coisa na lateral fecha o menu no celular
  lateral.addEventListener("click", () => {
    lateral.classList.remove("aberta");
    menuBtn.setAttribute("aria-expanded", "false");
  });

  $("btn-novo").addEventListener("click", novaConversa);
  $("btn-cowork").addEventListener("click", trabalhar);
  $("btn-artefatos").addEventListener("click", listarArtefatos);

  // ==============================================================
  // Abertura
  // ==============================================================
  function saudar() {
    const h = new Date().getHours();
    const periodo = h < 6 ? "Ainda acordado" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    $("saudacao").textContent = `${periodo}, chefia`;
  }

  async function abrir() {
    saudar();
    carregarConversas();
    atual = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    pintarConversas();
    bafo.pintar();
    bafo.animar();
    setInterval(() => bafo.metabolizar(), 5000);

    // O disclaimer de paródia entra na primeira mensagem da sessão,
    // além do rodapé — é regra do produto, não enfeite.
    let saudacao = "E aí, chefia. Sou o Claudio. Respondo qualquer coisa, quase nunca certo, e nunca peço desculpa. Manda a pergunta.";
    try {
      const r = await fetch(API + "/api/greeting?s=" + encodeURIComponent(sessionId));
      const d = await r.json();
      if (d && d.text) saudacao = d.text;
    } catch {
      /* a saudação de reserva já está definida */
    }

    fala(
      saudacao +
        "\n\nAviso chato mas obrigatório: Claudio é uma paródia. Tudo que ele diz é invenção. Sem qualquer relação com qualquer empresa de IA real.",
      "claudio"
    );
    entrada.focus();
  }

  abrir();
})();
