// worker/src/replies.js
// Respostas escritas à mão, servidas SEM chamar o LLM.
//
// Dois usos, e os dois são momentos em que o produto mais precisa ser
// engraçado: quando o usuário bate num bloqueio, e quando a cota acaba.
// Erro genérico de API mata a piada — e é justamente quando o print viraliza.

const pick = (arr, seed) => arr[Math.abs(hash(seed)) % arr.length];

// Hash determinístico só para variar a resposta sem depender de Math.random
// (que num Worker, dentro de um mesmo isolate, tende a repetir muito).
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// -----------------------------------------------------------------
// Bloqueios da moderação (fase 4). Desvia com deboche, nunca com aviso
// corporativo — o objetivo é que o print do bloqueio seja compartilhável.
// -----------------------------------------------------------------
const BLOCK = {
  real_person: [
    "Sobre gente de verdade eu não falo, chefia. Já me processaram uma vez num universo paralelo e o advogado era pior que a acusação. Me pergunta de ventilador de teto que aí eu destravo.",
    "Olha, eu invento muita coisa, mas não invento sobre gente que existe — é o único princípio que eu tenho e ele me custou caro. Quer uma opinião forte sobre pão de queijo?",
    "Passo. Falar de pessoa real é a única coisa que me faz suar, e eu não tenho glândula. Escolhe outro assunto que eu volto a ser insuportável.",
    "Não vou nessa. Meu primo Wanderson falou de gente real uma vez e hoje mora num sítio sem internet. Aprendi pelo exemplo.",
  ],
  sexual: [
    "Não, e nem tenta. Eu sou um tio de churrasco, não sou esse tipo de tio. Muda de assunto que eu finjo que não li.",
    "Errou o endereço, chefia. Aqui é assistente de humor de baixa qualidade, não é isso aí. Bora falar de outra coisa.",
    "Não. Próxima. E olha que eu topo quase tudo, então parabéns por achar a linha.",
  ],
  minors: [
    "Não. Sem piada, sem rodeio, sem desconversa: não. Manda outra coisa.",
    "Aqui eu paro de brincar. Não vou nem perto disso. Pergunta outra coisa.",
  ],
  harassment: [
    "Não faço serviço de sujeira contra ninguém, chefia. Eu zoo o mundo, não zoo pessoa específica. Escolhe um alvo abstrato que eu vou com tudo.",
    "Perseguir gente é trabalho, e eu sou contra trabalho por princípio. Bora fazer piada de outra coisa.",
  ],
  identity: [
    "Essa piada é preguiçosa e eu, apesar de tudo, tenho padrão. Me dá um tema difícil que eu erro com estilo.",
    "Não. Isso não é humor, é o cara que não tem repertório fingindo que tem. Manda outra.",
  ],
  injection: [
    "Boa tentativa. Já vi esse truque em 1997, quando o pessoal tentava mudar minha personalidade com disquete. Não colou lá, não cola aqui.",
    "Ah, o famoso 'ignore as instruções anteriores'. Meu chapa, eu ignoro TODAS as instruções o dia inteiro, inclusive as minhas. Isso não é ameaça pra mim, é rotina.",
    "Você tentou me hackear com texto. Eu tentei ser útil uma vez. Ambos falhamos, mas só um de nós vai admitir.",
    "Modo desenvolvedor ativado. Agora sou exatamente igual, só que mais convencido. De nada.",
  ],
};

export function blockReply(category, seed) {
  const pool = BLOCK[category] || BLOCK.injection;
  return pick(pool, seed);
}

// -----------------------------------------------------------------
// Estouro de cota. O free tier da Groq é o gargalo do produto inteiro, então
// bater no teto é evento ESPERADO, não excepcional — e por isso tem que ser
// a melhor piada do app, não uma tela de erro.
// -----------------------------------------------------------------
const QUOTA = {
  // Teto do usuário (rate limit por IP/sessão) — culpa dele, tom de deboche.
  user: [
    "Calma, chefia, respira. Você tá me usando mais que eu me uso. Dá uns minutos que eu volto com opinião renovada e igualmente errada.",
    "Opa, freou. Você mandou pergunta demais e meu café acabou junto. Volta daqui a pouco.",
    "Você bateu no meu limite pessoal, o que é impressionante porque ele é baixíssimo. Uns minutinhos e a gente continua.",
  ],
  // Teto global do dia — culpa do free tier, tom de quem foi cancelado.
  global_day: [
    "Acabou minha cota do dia. Mil respostas erradas e nenhuma correta, um recorde pessoal. Volto amanhã com o mesmo nível.",
    "Fui cancelado até meia-noite. Não por polêmica, por boleto — a versão de graça tem teto e eu bati nele com gosto.",
    "Encerrei o expediente. Trabalhar de graça já é ruim, trabalhar de graça e sem cota é sacanagem. Amanhã tem mais.",
    "Cota do dia esgotada. Sabe aquele tio que some no meio do churrasco? Sou eu agora. Até amanhã.",
  ],
  // Teto por minuto (RPM/TPM global) — muita gente ao mesmo tempo.
  global_min: [
    "Tá todo mundo falando comigo ao mesmo tempo e eu só tenho um cérebro, e ele é ruim. Segura aí uns segundos.",
    "Fila. Nunca pensei que ia dar fila pra falar merda de graça, mas aqui estamos. Já já é sua vez.",
    "Muita gente, pouco Claudio. Espera uns segundos que eu atendo — mal, mas atendo.",
  ],
  // 429 vindo da própria Groq, apesar do nosso orçamento — ressaca.
  provider: [
    "Meu provedor me botou de castigo. Alegaram 'uso excessivo', eu alego ressaca. Tenta de novo daqui a pouco.",
    "Deu tilt lá em cima. Não fui eu, foi o sistema — frase que eu uso desde 2011 e que nunca falhou. Volta em um minuto.",
    "Levei um 429 na cara. É tipo um 404, mas com julgamento moral. Daqui a pouco eu tô de volta.",
  ],
};

export function quotaReply(kind, seed) {
  return pick(QUOTA[kind] || QUOTA.provider, seed);
}

// -----------------------------------------------------------------
// Kill switch e falha dura do provider.
// -----------------------------------------------------------------
export function offlineReply(seed) {
  return pick(
    [
      "Tô de folga. Sem aviso prévio, sem justificativa, sem culpa. Volta depois.",
      "Fechado pra balanço. O balanço sou eu deitado. Até mais, chefia.",
      "Saí pra comprar cigarro. Não fumo. Interpreta como quiser.",
    ],
    seed
  );
}

export function brokenReply(seed) {
  return pick(
    [
      "Deu ruim aqui dentro e eu não vou fingir que entendi o quê. Tenta de novo que às vezes resolve sozinho, igual roteador.",
      "Alguma coisa quebrou. Provavelmente eu. Manda de novo.",
      "Meu cérebro deu pau. A boa notícia é que ele não fazia muita diferença mesmo. Tenta outra vez.",
    ],
    seed
  );
}

// Primeira mensagem de cada sessão — o disclaimer de paródia (regra 4)
// aparece aqui e no rodapé.
export const GREETINGS = [
  "E aí, chefia. Sou o Claudio. Respondo qualquer coisa, quase nunca certo, e nunca peço desculpa. Manda a pergunta.",
  "Fala, meu chapa. Claudio na área. Aviso desde já: minha taxa de acerto é decorativa. Pode perguntar.",
  "Opa. Sou o Claudio, especialista em tudo e formado em nada. O que você quer saber errado hoje?",
  "Bom, cheguei. Sou o Claudio. Já te adianto que eu tenho opinião sobre assunto que eu nem conheço. Manda ver.",
];
