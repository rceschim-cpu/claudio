// worker/src/coxa-fatos.js
// Munição do Claudio para discutir Coritiba.
//
// Por que existe: o prompt trazia quatro fatos cravados (1909, 1985, 2011,
// Couto Pereira) e por isso TODA discussão de Coxa citava os mesmos quatro.
// Consertar repetição de conteúdo é o mesmo problema da rotação de recurso
// cômico: o modelo não lembra do que já disse, então a variedade tem que
// vir de fora.
//
// São fatos HISTÓRICOS, que não mudam e não precisam de busca. Situação de
// tabela e resultado recente vêm de outro lugar (ver `pesquisa.js`), porque
// isso sim muda toda semana.
//
// Nada aqui cita jogador, técnico ou dirigente — nem do Coxa, nem do rival.
// A regra de pessoa real não abre exceção para futebol, e um fato sobre
// clube nunca precisa de nome de gente para funcionar.

const FATOS = [
  "Fundado em 1909, é o clube mais antigo do Paraná — o Athletico só apareceu em 1924.",
  "Campeão brasileiro de 1985, o primeiro título nacional de um clube do Paraná.",
  "Em 2011 fez 24 vitórias seguidas, recorde mundial reconhecido pela imprensa esportiva da época.",
  "O Couto Pereira é de 1932 e é um dos estádios mais antigos do país ainda em uso pelo dono original.",
  "Tem o maior número de títulos do Campeonato Paranaense, e a conta não é apertada.",
  "A alcunha 'coxa-branca' vem dos imigrantes alemães que fundaram o clube — apelido que virou identidade.",
  "Foi o primeiro clube do Paraná a disputar a primeira divisão nacional.",
  "O Couto Pereira já recebeu mais de 60 mil pessoas em clássico, número que a arena do rival não comporta.",
  "O time é chamado de 'Verdão' no Sul muito antes de qualquer outro clube reivindicar o apelido.",
  "A torcida do Coxa é conhecida por encher estádio em Série B — fase ruim não esvazia arquibancada de time grande.",
];

// Munição contra o rival. Sobre o clube e o discurso, nunca sobre pessoas.
const CONTRA_O_RIVAL = [
  "A arena deles é bonita e vive vazia fora de decisão — estádio-shopping é isso.",
  "Torcida de resultado: aparece em ano bom e some em ano ruim, o oposto de torcida de verdade.",
  "Mudaram o nome do clube mais de uma vez, inclusive para caber hífen. Identidade sólida, hein.",
  "Trocaram o nome do estádio por patrocínio. Tradição é o que se vende primeiro por lá.",
  "Passaram décadas na sombra do Coxa e ainda hoje medem tudo por comparação com a gente.",
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

/**
 * Dois fatos do Coxa e um contra o rival, sorteados pela mensagem.
 * Mensagens diferentes puxam munição diferente — é o que evita a terceira
 * discussão parecer a primeira.
 */
export function municao(mensagem, sessao = "") {
  const n = hash(sessao + "|" + mensagem);
  const a = FATOS[n % FATOS.length];
  const b = FATOS[(n + 3 + (n % 5)) % FATOS.length];
  const c = CONTRA_O_RIVAL[n % CONTRA_O_RIVAL.length];
  return { coxa: a === b ? [a] : [a, b], rival: c };
}

export const TOTAL_FATOS = FATOS.length;
