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
export function dicaDeEstilo(mensagem, sessao = "") {
  const n = hash(sessao + "|" + mensagem);
  const recurso = RECURSOS[n % RECURSOS.length];
  const queimada = ABERTURAS_QUEIMADAS[n % ABERTURAS_QUEIMADAS.length];

  return [
    "",
    "## RECURSO DESTA RESPOSTA (obrigatório)",
    recurso,
    `Não comece com "${queimada}" — está gasto. Não abra com interjeição nem vocativo.`,
    "Não repita número, nome ou construção que você usaria por hábito: se a frase parece familiar, troque.",
  ].join("\n");
}

export const TOTAL_RECURSOS = RECURSOS.length;
