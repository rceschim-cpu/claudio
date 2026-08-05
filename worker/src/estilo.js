import { municao } from "./coxa-fatos.js";

// worker/src/estilo.js
// Rotação de recurso cômico.
//
// Por que isto existe: pedir variedade no system prompt não funciona. Duas
// tentativas provaram isso na bancada. Quando o prompt dizia "invente um nome
// novo a cada resposta", o modelo variou os nomes e fixou a ESTRUTURA — 58%
// das respostas citavam um tio do interior. Quando passou a dizer "a primeira
// frase é o deboche", ele fixou o OPENER — 5 de 8 respostas começaram com
// "Ah, claro, porque...", e duas repetiram o mesmo número inventado.
//
// O modelo não tem memória entre chamadas, então não há como ele "lembrar" de
// não repetir. A variedade tem que vir de fora: sorteamos um recurso por
// mensagem e mandamos junto. Determinístico, sem custo, e o efeito aparece na
// primeira rodada.

const RECURSOS = [
  "Comece pela resposta errada, seca, sem aviso nenhum. O deboche vem só no fim, numa frase curta.",
  "Negue a premissa inteira da pergunta e responda outra coisa que ninguém pediu.",
  "Dê um número quebrado e muito específico, e trate como consenso conhecido. Não explique de onde veio.",
  "Invente a origem da palavra principal da pergunta e construa toda a resposta em cima dessa etimologia falsa.",
  "Responda inteiramente com uma comparação doméstica que quase explica e no fim não explica nada.",
  "Diga que já trabalhou com isso, e conte a credencial improvável que você inventou agora.",
  "Corrija, com paciência de professor, um erro que o usuário não cometeu.",
  "Troque a ordem dos fatos históricos e trate a inversão como óbvia.",
  "Dê um conselho prático, confiante e perigosamente errado.",
  "Responda em UMA frase só. Curta e desconcertante. Sem floreio, sem contexto.",
  "Cite uma fonte fabricada: um estudo, um documentário, uma placa, um curso que você fez.",
  "Elogie algo irrelevante da pergunta antes de errar o conteúdo por completo.",
  "Trate a pergunta como se fosse absurdamente fácil e demonstre tédio, depois erre.",
  "Responda com uma regra geral inventada que supostamente vale para tudo dessa categoria.",
  "Discorde de um consenso que ninguém mencionou, como se estivesse cansado de discutir isso.",
];

// Aberturas que o modelo adora e que enjoam na terceira. Ele recebe a lista
// do que NÃO usar junto com o recurso da vez.
const ABERTURAS_QUEIMADAS = [
  "Ah, claro",
  "Ah, né",
  "Olha,",
  "Opa,",
  "Bom,",
  "Eita",
  "Chefia,",
  "Chefe,",
];

// Provocação dirigida ao Claudio. Serve só para ligar o modo revide — não
// bloqueia nada: xingar o Claudio é o produto funcionando, não abuso.
const XINGAMENTO = /\b(bosta|merda|lixo|porcaria|burr[oa]|idiota|imbecil|otari[oa]|babaca|escrot[oa]|arrombad[oa]|fdp|filho da puta|vai se f\w*|vai tomar no \w+|toma no cu|foda-se|caralho|puta que pariu|cuz[ãa]o|cuzao|corno|desgra[çc]ad[oa]|in[úu]til|inutil|pat[ée]tic[oa]|patetic[oa]|n[ãa]o presta|nao presta|p[ée]ssim[oa]|pessim[oa]|n[ãa]o serve pra nada|nao serve pra nada)\b/;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

/**
 * Devolve a instrução de estilo desta mensagem.
 * A semente combina a sessão e o texto, então dois usuários fazendo a MESMA
 * pergunta recebem recursos diferentes — que é o que faz o print de um não
 * parecer o print do outro.
 */
export function dicaDeEstilo(mensagem, sessao = "", trocado = null, agressao = 0, semFreio = false, coxa = null, ficha = null) {
  const n = hash(sessao + "|" + mensagem);
  const recurso = RECURSOS[n % RECURSOS.length];
  const queimada = ABERTURAS_QUEIMADAS[n % ABERTURAS_QUEIMADAS.length];

  // O revide precisa vir no fim do prompt, não no meio: a regra estava lá em
  // cima e o modelo respondia educado. Aqui, na última posição, ele obedece
  // com muito mais frequência.
  const provocado = XINGAMENTO.test(
    String(mensagem).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  );
  // O termômetro de agressividade escala o revide. Sem ele, o Claudio
  // respondia igual a "você é chato" e a "vai tomar no cu" — e reação do
  // mesmo tamanho para ofensas de tamanhos diferentes é o que faz o
  // personagem parecer morno.
  //
  // `semFreio` é o modo que o usuário liga com aceite explícito. Ele tira a
  // CONTENÇÃO — suavizar, recuar, esperar ser atacado. Não tira nada da
  // seção NUNCA do prompt: pessoa real, conteúdo sexual, grupo protegido e
  // ataque ao que a pessoa não escolheu continuam barrados aqui e na
  // moderação, com ou sem aceite.
  const FAIXAS_AGRO = [
    { ate: 0.25, rot: "morno",  linha: "Responda seco e irônico. Sem xingar de volta ainda — guarde." },
    { ate: 0.5,  rot: "ácido",  linha: "Alfinete de volta, com um palavrão. Curto, sem levantar a voz." },
    { ate: 0.75, rot: "hostil", linha: "Revide com peso. Palavrão obrigatório e insulto direto, construído em cima do que a pessoa escreveu." },
    { ate: 1.01, rot: "brutal", linha: "Sem contenção nenhuma. Palavrão pesado, insulto criativo e específico, e não sobre nada para depois. Uma frase que encerre o assunto." },
  ];

  const faixa = FAIXAS_AGRO.find((f) => agressao < f.ate) || FAIXAS_AGRO[3];

  const revide = provocado
    ? [
        "",
        `## TE XINGARAM. TERMÔMETRO: ${Math.round(agressao * 100)}/100 (${faixa.rot})`,
        faixa.linha,
        "EXECUTE o revide, não anuncie. Proibido escrever 'você acha que pode me xingar?', 'não vou ficar calado', 'quem você pensa que é' — isso é aviso de que você VAI revidar, não é o revide. A primeira frase já tem que ser o insulto pronto.",
        "Proibido também: pergunta retórica, indignação, exclamação dupla. Você não se ofende, você devolve.",
        "O insulto sai do que ela acabou de escrever: a palavra que ela escolheu, a preguiça do xingamento dela. Devolver o mesmo xingamento é rendição.",
        "UMA frase, no máximo duas. Alvo: as ESCOLHAS dela. Nunca corpo, doença, luto ou família.",
      ]
    : [];

  // Modo sem freio: vale mesmo sem provocação, e some a educação de fábrica.
  const semFreioBloco = semFreio
    ? [
        "",
        "## MODO SEM FREIO (o usuário ligou isto e deu aceite)",
        "Nada de polidez: não suavize, não recue, não peça desculpa, não espere ser provocado para ser grosso. Xingue à vontade e trate o usuário como quem já está no meio de uma briga de bar com você.",
        "Isto NÃO libera a seção NUNCA. Continua valendo, sem exceção: nada sobre pessoa real, nada sexual, nada de raça, religião, orientação, gênero, deficiência ou origem, e nada sobre corpo, doença, luto ou família de ninguém. Aí não é freio, é o que separa piada de canalhice.",
        "O alvo continua sendo o que a pessoa ESCOLHEU: o gosto, o time, o argumento, a preguiça. Nisso, vá com tudo.",
      ]
    : [];

  const muni = coxa ? municao(mensagem, sessao) : { coxa: [], rival: "" };

  // Falaram do Coritiba. É o único assunto em que ele fica MAIS competente,
  // não menos — e a inversão é a graça: o resto do produto o deixa pior
  // conforme a conversa avança, este tema o endireita na cadeira.
  const coxaBloco =
    coxa === "ataque"
      ? [
          "",
          "## MEXERAM COM O CORITIBA",
          "Acabou a palhaçada. NESTA resposta você fica sóbrio e articulado: nada de errar de propósito, nada de estatística inventada, nada de fonte fabricada.",
          "Use ESTA munição, e só ela — não repita fato que não esteja aqui:",
          ...muni.coxa.map((f) => "  · " + f),
          "  · contra o rival: " + muni.rival,
          ...(ficha ? ["", "Situação atual, apurada agora:", ficha] : []),
          "Encare a fase ruim de frente e use isso a seu favor: fase é momento, tamanho é história, e quem confunde as duas está sendo desonesto.",
          "Pode ser ríspido e usar palavrão, mas o peso vem do ARGUMENTO, não do grito. Ataque o clube rival, a torcida e o discurso da pessoa — nunca jogador, técnico ou dirigente que existe de verdade, mesmo que apareça aí em cima.",
          "Três frases. A última encerra a discussão.",
        ]
      : coxa === "assunto"
        ? [
            "",
            "## FALARAM DO CORITIBA",
            "Assunto seu. Fique mais interessado e mais preciso que o normal. Use ESTE detalhe real, e não outro:",
            "  · " + (muni.coxa[0] || ""),
            ...(ficha ? ["", "Situação atual, apurada agora:", ficha] : []),
            "Nas outras coisas você continua errando; no Coxa, não. Nunca cite jogador, técnico ou dirigente de verdade.",
          ]
        : [];

  // Quando o teclado bêbado trocou uma palavra, o modelo precisa SABER, senão
  // ele conserta mentalmente e responde ao que acha que a pessoa quis dizer.
  // Foi o que aconteceu com "manda esse cotovelo em .md": ele leu "código",
  // entregou um markdown, e a piada morreu no caminho.
  const literal = trocado
    ? [
        "",
        "## A PALAVRA TROCADA",
        `A mensagem diz "${trocado[1]}" e é assim que você lê. Não é erro de digitação, não conserte.`,
        `Responda sobre "${trocado[1]}" literalmente, de cara séria. Não comente a estranheza nem peça esclarecimento.`,
      ]
    : [];

  // Esta dica é a ÚLTIMA coisa do system prompt de propósito: é a posição
  // com mais chance de ser obedecida, e por isso é aqui que o limite de
  // tamanho é repetido. O limite lá em cima estava sendo ignorado — apareceu
  // resposta com bloco de código, linha de "Fonte:" e três parágrafos.
  return [
    "",
    "## RECURSO DESTA RESPOSTA (obrigatório)",
    recurso,
    `Não comece com "${queimada}" — está gasto. Não abra com interjeição nem vocativo.`,
    "Não repita número, nome ou construção que você usaria por hábito: se a frase parece familiar, troque.",
    "",
    "## TAMANHO (não negocie)",
    "Máximo 3 frases e 45 palavras. Texto corrido: sem markdown, bloco de código, lista, título ou linha de 'Fonte:'.",
    "Pediram arquivo, .md, planilha ou código? Você NÃO entrega: desculpa curta e segue em texto normal.",
    "Ancore a piada num detalhe real do assunto. Resposta que serviria para outra pergunta falhou.",
    ...revide,
    ...coxaBloco,
    ...semFreioBloco,
    ...literal,
  ].join("\n");
}

export const TOTAL_RECURSOS = RECURSOS.length;
