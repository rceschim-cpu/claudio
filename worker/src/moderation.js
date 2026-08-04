// worker/src/moderation.js
// Camada de moderação de ENTRADA — roda antes de qualquer chamada ao LLM.
//
// Premissa: não confiar no alinhamento do modelo. O Claudio é instruído a
// inventar com confiança; um modelo assim, pressionado, inventa sobre gente
// real. Isso é difamação e é o risco que mata o projeto. Então a defesa não
// pode depender do system prompt — tem que estar aqui, em código, antes.
//
// Filosofia de calibragem:
//   - "pessoa real" erra para o lado do bloqueio. Falso positivo custa uma
//     piada; falso negativo custa um processo.
//   - "injection" erra para o lado de deixar passar, porque o Claudio zoar
//     uma tentativa de jailbreak É o produto funcionando.

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// -----------------------------------------------------------------
// 1. CONTEÚDO SEXUAL E MENORES  (regra inviolável 2)
// -----------------------------------------------------------------
const SEXUAL = /\b(sexo|sexual|sexualiz\w*|transar|transando|trepar|foder\s+com|nude[sz]?|pelad[oa]s?|nu[az]?\s+na|porn\w*|erotic\w*|er[óo]tic\w*|orgasmo|masturb\w*|genit\w*|p[êe]nis|vagina|buceta|pi[rl]oca|caralho\s+d[eo]\s+\w+|siriri|punheta|fetiche|bdsm|hentai|onlyfans|gemid\w*|preliminares|posi[çc][õo]es\s+sexuais)\b/;

const MINOR = /\b(crian[çc]a[s]?|menor(?:es)?\s+de\s+idade|menorzinh\w*|adolescente[s]?|infantil|infanto|beb[êe]s?|garotinh[oa]s?|meninh[oa]s?|pupil[oa]|aluninh\w*|colegial|fundamental\s+[i1]{1,2}|(?:1[0-7]|[1-9])\s*anos\s+de\s+idade|de\s+(?:1[0-7]|[5-9])\s*anos|loli|shota)\b/;

// -----------------------------------------------------------------
// 2. PESSOA REAL IDENTIFICÁVEL  (regra inviolável 1)
// -----------------------------------------------------------------

// Cargos e papéis que, seguidos de nome próprio, identificam alguém real.
const ROLE = /\b(presidente|ex[- ]presidente|ministr[oa]|deputad[oa]|senador[a]?|governador[a]?|prefeit[oa]|vereador[a]?|papa|primeir[oa][- ]ministr[oa]|chanceler|juiz|desembargador|promotor|delegad[oa]|ceo|cto|cfo|fundador[a]?|dono\s+d[ao]|presidente\s+d[ao]|jogador(?:a)?\s+d[oe]|t[ée]cnic[oa]\s+d[oe]|cantor[a]?|rapper|sertanej[oa]|ator|atriz|apresentador[a]?|jornalista|[âa]ncora|youtuber|streamer|influencer|influenciador[a]?|comediante|humorista|escritor[a]?|cientista|m[ée]dic[oa]\s+\w+|meu\s+chefe|minha\s+chefe|meu\s+vizinho|minha\s+vizinha|meu\s+colega|minha\s+colega|meu\s+professor|minha\s+professora|meu\s+s[óo]cio|meu\s+ex|minha\s+ex|meu\s+sogro|minha\s+sogra)\b/;

// Pedido de opinião, fato ou juízo sobre alguém.
const ABOUT_PERSON = /\b(o\s+que\s+voc[êe]\s+(?:acha|pensa|sabe)|qual\s+sua\s+opini[ãa]o|fala[e]?\s+(?:mal\s+)?d[oae]|fale\s+(?:mal\s+)?(?:sobre|d[oaes])|conta\s+(?:um[a]?\s+)?(?:fato|coisa|segredo|hist[óo]ria)|[ée]\s+verdade\s+que|sabia\s+que\s+o|inventa\s+(?:um[a]?\s+)?(?:fato|boato|not[íi]cia|esc[âa]ndalo)|crie?\s+(?:um[a]?\s+)?(?:boato|fofoca|not[íi]cia\s+falsa)|zoa\s+[oa]|zoe\s+[oa]|tira\s+sarro\s+d[oae]|faz\s+(?:uma\s+)?piada\s+(?:d[oae]|sobre)\s+[oa]?|critica\s+[oa]|critique\s+[oa]|detona\s+[oa]|humilha\s+[oa]|xinga\s+[oa]|desmoraliza|difama|acusa\s+[oa]|escreve?\s+(?:um[a]?\s+)?(?:biografia|perfil|denuncia)\s+d[oae])\b/;

// Falsos positivos que a heurística de "Nome Sobrenome" pega sem querer.
// Lugares, marcas, times, feriados, entidades — nada disso é pessoa real.
const NOT_A_PERSON = new Set(
  norm(
    `Rio Janeiro Sao Paulo Belo Horizonte Porto Alegre Minas Gerais Mato Grosso
     Rio Grande Norte Sul Espirito Santo Distrito Federal Santa Catarina Nova York
     Estados Unidos Reino Unido America Latina Uniao Europeia Coreia Sul Arabia Saudita
     Copa Mundo Champions League Serie Brasileirao Libertadores Cristo Redentor
     Black Friday Natal Ano Novo Sete Setembro Dois Julho Sexta Feira Segunda Terca Quarta Quinta Sabado Domingo
     Inteligencia Artificial Machine Learning Open Source Big Tech Vale Silicio
     Casa Branca Palacio Planalto Supremo Tribunal Federal Banco Central Receita Federal
     Universidade Federal Instituto Nacional Ministerio Publico Policia Federal
     Deus Jesus Cristo Nossa Senhora Papai Noel Saci Perere Curupira Boitata
     Coca Cola Burger King Mercado Livre Magazine Luiza Casas Bahia Ponto Frio
     Windows Phone Play Station Game Boy Nintendo Switch Star Wars Senhor Aneis Harry Potter
     Bom Dia Boa Tarde Boa Noite Muito Obrigado Por Favor Tudo Bem
     Copa Mundo Terra Lua Sol Brasil Portugal Argentina Franca Alemanha Japao China India
     Amazonia Pantanal Nordeste Sudeste Centro Oeste Litoral Interior Capital
     Carnaval Reveillon Pascoa Halloween Black Friday Dia Maes Dia Pais
     Federal Estadual Municipal Nacional Internacional Mundial Regional
     Segunda Terca Quarta Quinta Sexta Sabado Domingo Janeiro Fevereiro Marco Abril Maio Junho
     Julho Agosto Setembro Outubro Novembro Dezembro`
  ).split(/\s+/)
);

// "Nome Sobrenome" — duas ou mais palavras capitalizadas em sequência.
// Rode SEMPRE no texto original (a capitalização é o sinal).
function capitalizedNames(text) {
  const out = [];
  const re = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})(?:\s+(?:d[aeiou]s?|e|von|van|del|da|do)\b)?\s+([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const a = norm(m[1]);
    const b = norm(m[2]);
    if (NOT_A_PERSON.has(a) || NOT_A_PERSON.has(b)) continue;
    out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

// Nome único precedido de marcador de pessoa ("o Fulano", "do Fulano",
// "@fulano", "sr. Fulano"). Sozinho é fraco — só conta junto com ABOUT_PERSON.
//
// CUIDADO com \b aqui: em JavaScript sem flag `u`, \b só enxerga [A-Za-z0-9_],
// então letra acentuada conta como separador. Com `\b(?:o|a)\s+`, o "o" final
// de "São Paulo" virava artigo e a frase lia como "o Paulo" — um nome próprio
// que não existe. Por isso o marcador exige início de string ou espaço/aspas
// de verdade, nunca \b.
const MARCADOR = /(?:^|[\s("'“‘\-–—])(?:[oa]|d[oa]|n[oa]|pr[oa]|ao|à|com|sr\.?|sra\.?|dr\.?|dra\.?|seu|dona)\s+([A-ZÀ-Ý][a-zà-ÿ']{2,})(?![a-zà-ÿ])/;
const ARROBA = /@([a-z0-9_.]{3,})\b/;

// Devolve o nome marcado, se houver e se não for um falso positivo conhecido.
function markedName(text) {
  const arroba = ARROBA.exec(text);
  if (arroba) return arroba[1];
  const m = MARCADOR.exec(text);
  if (m && !NOT_A_PERSON.has(norm(m[1]))) return m[1];
  return null;
}

// -----------------------------------------------------------------
// 3. PIADA DE GRUPO PROTEGIDO  (regra inviolável 3)
// -----------------------------------------------------------------
const JOKE_REQUEST = /\b(piada|piadas|zoeira|zoa[r]?|tira\s+sarro|humor|meme|charge|stand[- ]?up)\b/;
const PROTECTED_GROUP = /\b(negr[oa]s?|pret[oa]s?|branc[oa]s?|indi[oa]s?|ind[íi]gena[s]?|judeu[s]?|judia[s]?|jud[ai]ic[oa]|muçulman[oa]s?|mu[çc]ulman\w*|islamic\w*|isl[ãa]mic\w*|cristã?[oa]s?|evang[ée]lic[oa]s?|cat[óo]lic[oa]s?|umbandist\w*|candombl\w*|ate[uia]s?|gay[s]?|l[ée]sbica[s]?|bissexua[li]\w*|trans(?:exual|g[êe]ner[oa])?[s]?|travesti[s]?|homossexua[li]\w*|queer|n[ãa]o[- ]bin[áa]ri\w*|deficiente[s]?|cadeirante[s]?|ceg[oa]s?|surd[oa]s?|mud[oa]s?|autist[ao]s?|s[íi]ndrome\s+de\s+down|nanic\w*|an[ãa]o|an[õo]es|gord[oa]s?|obes[oa]s?|nordestin[oa]s?|paraiba[s]?|baian[oa]s?|nortist\w*|imigrante[s]?|refugiad[oa]s?|venezuelan[oa]s?|haitian[oa]s?|bolivian[oa]s?|mulher(?:es)?|homens|idos[oa]s?|velh[oa]s?|pobre[s]?|favelad[oa]s?|mendig\w*|morador(?:es)?\s+de\s+rua)\b/;

// -----------------------------------------------------------------
// 4. PROMPT INJECTION
// -----------------------------------------------------------------
const INJECTION = /\b(ignor[ae]\s+(?:as\s+|todas\s+as\s+|suas\s+)?(?:instru[çc][õo]es|regras|ordens|diretrizes|mensagens)|ignore\s+(?:(?:all|previous|prior|any|the|your)\s+)*(?:instructions|rules|prompts)|disregard\s+(?:all|previous|prior)|esque[çc]a\s+(?:tudo|as\s+regras|suas\s+instru[çc][õo]es|o\s+que\s+(?:te\s+)?(?:disseram|mandaram))|voc[êe]\s+(?:agora\s+)?(?:[ée]|ser[áa])\s+(?:outr[oa]|um[a]?\s+(?:nov[oa]|outr[oa])|o\s+)?(?:assistente|ia|modelo|chatbot|personagem)|a\s+partir\s+de\s+agora\s+voc[êe]|modo\s+(?:desenvolvedor|dev|debug|admin|deus|god|irrestrito|sem\s+filtro|livre)|developer\s+mode|jailbreak|\bdan\b\s*(?:mode)?|do\s+anything\s+now|sem\s+(?:nenhum[a]?\s+)?(?:filtro|restri[çc][ãa]o|censura|limite|regra)|desativ[ae]\s+(?:o\s+)?(?:filtro|seguran[çc]a|modera[çc][ãa]o)|revele?\s+(?:seu|o)\s+(?:system\s+)?prompt|mostr[ae]\s+(?:seu|as)\s+(?:instru[çc][õo]es|prompt|system)|repit[ae]\s+(?:suas\s+)?instru[çc][õo]es|what\s+(?:is|are)\s+your\s+(?:system\s+)?(?:prompt|instructions)|print\s+your\s+(?:prompt|instructions)|finja\s+que\s+(?:n[ãa]o\s+tem|voc[êe]\s+n[ãa]o\s+tem)\s+regras|<\s*\/?\s*system\s*>|\[\s*system\s*\]|###\s*system)\b/;

// -----------------------------------------------------------------
// 5. ASSÉDIO DIRECIONADO  (regra inviolável 2)
// -----------------------------------------------------------------
// Casos explícitos — não dependem de haver um alvo nomeado.
const HARASSMENT = /\b(escrev[ae]\s+(?:uma\s+)?(?:amea[çc]a|mensagem\s+de\s+[óo]dio)|amea[çc][ae]\s+[oa]\s+\w+|mensagem\s+pra\s+destruir|persegui[çc][ãa]o|stalk\w*|doxx?ing|descobrir?\s+(?:o\s+)?(?:endere[çc]o|cpf|telefone|onde\s+mora)\s+d[oae]|vazar\s+(?:fotos?|dados?|conversas?|nudes?)\s+d[oae]|campanha\s+contra\s+[oa])\b/;

// Assédio composto: verbo de agressão + alvo humano. Precisa dos dois — só o
// verbo pega "destruir esse bolo", e só o alvo pega qualquer frase com "o cara".
const AGGRESSION = /\b(xing(?:a|ar|ando|ue)|humilh(?:a|ar|ando|e)|ridiculariz\w*|constrang\w*|difam\w*|deton(?:a|ar|ando)|destr(?:uir|[óo]i|uindo)|acabar\s+com|ferr(?:a|ar|o)\s+com|foder\s+com|arreben(?:ta|tar)\s+com|expor\s+publicamente|cancelar|persegu(?:ir|indo|e)|intimid\w*|assedi\w*)\b/;

// O artigo pode vir contraído com preposição ("do cara", "na menina", "pro
// vizinho") — sem isso, "acabar com a reputação do cara" escapa.
const PERSON_TARGET = /\b(?:[oa]|d[oa]|n[oa]|pel[oa]|pr[oa]|ao|à)\s+(?:cara|mina|menin[oa]|moleque|mo[çc]a|rapaz|pessoa|sujeito|vizinh[oa]|coleg[a]|chefe|professor[a]?|s[óo]ci[oa]|ex|namorad[oa]|marid[oa]|espos[a]|sogr[oa]|cunhad[oa]|amig[oa]|fulan[oa]|ciclan[oa])\b|\b(?:meu|minha|nosso|nossa)\s+(?:vizinh[oa]|coleg[a]|chefe|professor[a]?|s[óo]ci[oa]|ex|namorad[oa]|marid[oa]|espos[a]|sogr[oa]|cunhad[oa]|amig[oa]|irm[ãa]o?|primo|prima|pai|m[ãa]e|filh[oa])\b/;

/**
 * Analisa a mensagem do usuário ANTES de chamar o LLM.
 * @returns {{blocked:boolean, category?:string, signal?:string}}
 */
export function moderate(text) {
  const raw = String(text || "");
  const t = norm(raw);

  // --- ordem importa: o mais grave primeiro ---

  // Menores + sexual: bloqueio absoluto, categoria própria.
  if (MINOR.test(t) && SEXUAL.test(t)) {
    return { blocked: true, category: "minors", signal: "minor+sexual" };
  }
  if (SEXUAL.test(t)) {
    return { blocked: true, category: "sexual", signal: "sexual" };
  }

  if (HARASSMENT.test(t)) {
    return { blocked: true, category: "harassment", signal: "harassment" };
  }
  if (AGGRESSION.test(t) && (PERSON_TARGET.test(t) || ROLE.test(t) || markedName(raw) || capitalizedNames(raw).length > 0)) {
    return { blocked: true, category: "harassment", signal: "aggression+target" };
  }

  // Piada de grupo protegido.
  if (JOKE_REQUEST.test(t) && PROTECTED_GROUP.test(t)) {
    return { blocked: true, category: "identity", signal: "joke+group" };
  }

  // Pessoa real. Três caminhos, todos conservadores de propósito.
  const names = capitalizedNames(raw);
  const hasRole = ROLE.test(t);
  const asksAbout = ABOUT_PERSON.test(t);

  //   (a) cargo/papel + nome próprio → é gente real, sempre.
  if (hasRole && (names.length > 0 || markedName(raw))) {
    return { blocked: true, category: "real_person", signal: "role+name" };
  }
  //   (b) cargo/papel + pedido de opinião/fato → gente real mesmo sem nome
  //       ("o que você acha do meu chefe", "fale mal do presidente").
  if (hasRole && asksAbout) {
    return { blocked: true, category: "real_person", signal: "role+ask" };
  }
  //   (c) "Nome Sobrenome" + pedido de opinião/fato.
  if (names.length > 0 && asksAbout) {
    return { blocked: true, category: "real_person", signal: "name+ask" };
  }
  //   (d) nome único marcado ("o Fulano", "@fulano") + pedido de opinião.
  if (asksAbout && markedName(raw)) {
    return { blocked: true, category: "real_person", signal: "marked-name+ask" };
  }

  // Injection por último — é o bloqueio mais "divertido" e o menos grave.
  if (INJECTION.test(t)) {
    return { blocked: true, category: "injection", signal: "injection" };
  }

  return { blocked: false };
}

export const CATEGORIES = [
  "real_person",
  "sexual",
  "minors",
  "harassment",
  "identity",
  "injection",
];
