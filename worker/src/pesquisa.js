// worker/src/pesquisa.js
// Busca ao vivo, usada com parcimônia.
//
// O `groq/compound-mini` faz busca na web do lado do servidor da Groq. É
// caro para este produto: ~5.500 tokens de entrada e ~7 segundos por
// chamada, contra ~1.400 e ~1s de uma resposta normal. Por isso ele NÃO é
// o modelo do Claudio — é uma ferramenta de pesquisa chamada antes, cujo
// resultado vira uma ficha curta injetada no prompt do modelo de verdade.
//
// Quando vale: só quando a pergunta é sobre AGORA (tabela, último jogo,
// fase atual). Fato histórico não precisa de busca — está em coxa-fatos.js,
// custa zero e não atrasa nada.
//
// RISCO QUE ISTO INTRODUZ: resultado de busca vem cheio de nome de gente
// real (presidente do clube, técnico, jogador). A moderação de entrada
// protege contra o USUÁRIO citar pessoa real; ela não via o que a busca
// injetava. Por isso a ficha é higienizada aqui antes de encostar no
// prompt — a regra 1 não pode depender de o modelo ter bom senso.

// Perguntas sobre o presente. Fora disto, não busca.
const ATUAL = /\b(agora|hoje|atual|atualmente|neste ano|esse ano|este ano|temporada|tabela|classifica[çc][ãa]o|posi[çc][ãa]o|[úu]ltimo jogo|[úu]ltima rodada|[úu]ltimos jogos|como (?:est[áa]|ta|vai)|em que (?:s[ée]rie|divis[ãa]o)|s[ée]rie [ab]\b|rebaix|acesso|2026|2025)\b/i;

export function precisaBuscar(mensagem, coxa) {
  if (!coxa) return false;
  const t = String(mensagem).normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ATUAL.test(t);
}

// Tira nome próprio de pessoa da ficha. Cargo seguido de nome é o padrão
// que a imprensa esportiva usa, e é o que mais aparece.
const CARGO_E_NOME =
  /\b(presidente|vice[- ]presidente|t[ée]cnico|treinador|auxiliar|diretor[a]?|dirigente|goleiro|zagueiro|lateral|volante|meia|atacante|craque|refor[çc]o|jogador|capit[ãa]o|[áa]rbitro|narrador|comentarista)\s+[A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+(?:d[aeo]s?|e)\s+[A-ZÀ-Ý][\wÀ-ÿ]*|\s+[A-ZÀ-Ý][\wÀ-ÿ]*){0,2}/g;

export function higienizar(texto) {
  return String(texto || "")
    // "a presidente Marianna Libano afirmou" -> "a presidente do clube afirmou"
    .replace(CARGO_E_NOME, (m) => m.split(/\s+/)[0] + " do clube")
    // sobra de nome solto entre aspas
    .replace(/["“][A-ZÀ-Ý][\wÀ-ÿ]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]+)+["”]/g, "alguém do clube")
    .slice(0, 700);
}

// Cache da ficha.
//
// A economia aqui é o que torna a busca viável. Medido: o compound-mini
// consome a cota diária do PRÓPRIO llama-3.3 — a API respondeu
// "Rate limit reached for model llama-3.3-70b-versatile ... Limit 100000,
// Used 97648, Requested 3367". Ou seja, cada busca custa ~3.400 tokens do
// mesmo balde do modelo principal: o equivalente a duas respostas e meia.
//
// Sem cache, dez perguntas sobre a fase do time comeriam um terço do dia.
// Com seis horas de cache, a mesma informação custa quatro buscas por dia,
// e posição de tabela não muda mais rápido que isso.
//
// O cache é por isolate, não global — o Worker pode ter vários. Na pior das
// hipóteses são algumas buscas a mais por dia, e não vale um Durable Object
// só para isso.
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

/**
 * Busca e devolve uma ficha curta e higienizada, ou null.
 * Falha em silêncio de propósito: sem ficha o Claudio ainda tem a munição
 * histórica, e um erro de busca não pode derrubar a resposta.
 */
export async function buscarFicha({ assunto, chave, baseUrl, signal, agora = Date.now() }) {
  if (!chave) return null;

  const guardado = cache.get(assunto);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.ficha;

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "groq/compound-mini",
        max_tokens: 200,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content:
              `Busque a situação atual do ${assunto} no futebol brasileiro. ` +
              "Responda em no máximo 4 linhas curtas, só fatos: divisão, posição na tabela, " +
              "resultado mais recente e desempenho das últimas rodadas. " +
              "NÃO cite nomes de pessoas (jogadores, técnicos, dirigentes). Sem opinião.",
          },
        ],
      }),
      signal,
    });
    // 429 aqui é comum e esperado: a busca divide a cota diária com o
    // modelo principal. Guarda o vazio no cache para não insistir a cada
    // pergunta e queimar o resto do dia tentando.
    if (!r.ok) {
      if (r.status === 429) cache.set(assunto, { em: agora, ficha: null });
      return null;
    }
    const d = await r.json();
    const t = d?.choices?.[0]?.message?.content;
    const ficha = t && t.trim() ? higienizar(t.trim()) : null;
    cache.set(assunto, { em: agora, ficha });
    return ficha;
  } catch {
    return null;
  }
}

// Só para teste: permite verificar o cache sem esperar seis horas.
export const _cache = cache;
