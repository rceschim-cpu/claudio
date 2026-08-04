# Claudio

**Inteligência Aproximada. Resultados surpreendentes.**

Claudio é uma paródia de assistente de IA. Ele responde qualquer pergunta, nunca
corretamente de propósito, inventa estatística com casa decimal, cita gente que
não existe e tem opinião fortíssima sobre ventilador de teto. Português
brasileiro, humor de tio de churrasco, zero compromisso com factualidade.

> **Claudio é uma paródia. Tudo que ele diz é invenção. Sem qualquer relação com
> qualquer empresa de IA real.**

O objetivo do produto é ser engraçado e compartilhável. Não é ser útil.

---

## Como funciona

Duas peças, porque GitHub Pages só serve arquivo estático e a chave da Groq não
pode chegar ao navegador:

```
  navegador
     │
     │  web/  →  GitHub Pages (estático, sem segredo nenhum)
     ▼
  worker/  →  Cloudflare Worker
     │        guarda a GROQ_API_KEY · modera a entrada · segura o orçamento
     ▼
  api.groq.com
```

Se a chave estivesse no front, ela seria pública (o repositório é público) e
qualquer um queimaria os 1.000 pedidos/dia do free tier em minutos. Por isso o
Worker existe: ele é o único que vê a chave, e é onde a moderação e o rate limit
rodam de verdade — no navegador, ambos seriam contornáveis.

### Estrutura

| pasta | o que é |
|---|---|
| `web/` | o site. HTML/CSS/JS puro, sem build, sem framework, sem segredo |
| `worker/` | o backend. Cloudflare Worker |
| `prompts/claudio.md` | a personalidade. Carregado em runtime — iterar aqui não exige mexer em código |
| `bench/` | a bancada de humor: 30 prompts, dois modelos, resultado lado a lado |
| `tests/persona/` | as regras invioláveis, testadas onde são aplicadas |
| `docs/brand/` | manual de marca |

---

## Rodando local

```bash
npm install
cp .env.example worker/.dev.vars   # preencha GROQ_API_KEY
npm run dev
```

Sobe em `http://localhost:8787` — o Worker serve a API e o site estático junto,
então um comando basta.

Testes (não tocam a rede):

```bash
npm test
```

---

## Publicando

### 1. Worker (backend)

```bash
npm --prefix worker exec wrangler login
npm run secret          # cola a GROQ_API_KEY quando ele pedir
npm run deploy
```

Anote a URL que o `deploy` imprime e coloque em `web/config.js`.

### 2. Site (GitHub Pages)

O workflow em `.github/workflows/pages.yml` publica `web/` a cada push na
`main`. Basta ligar o Pages uma vez em **Settings → Pages → Source: GitHub
Actions**.

> A `GROQ_API_KEY` que está nos *secrets do Actions* **não é usada** e nem
> poderia ser: secret de Actions só existe durante o build, e o Pages não tem
> runtime. Se ela fosse injetada no bundle, viraria pública. A chave que vale é
> a do Worker.

---

## O free tier é a restrição de projeto

O free tier da Groq define o produto inteiro:

| limite | teto da Groq | orçamento do Claudio |
|---|---|---|
| pedidos por minuto | 30 | 24 |
| pedidos por dia | 1.000 | 850 |
| tokens por minuto | 12.000 | 10.000 |

Consequências deliberadas, não acidentes:

- **Respostas curtas** (`CLAUDIO_MAX_TOKENS=220`). Serve à piada *e* ao TPM —
  que é o limite que aperta primeiro, não o RPM.
- **Histórico curto** (6 mensagens). Contexto longo consome TPM sem melhorar a
  piada.
- **Rate limit por IP e por sessão** bem abaixo do teto global, para uma pessoa
  sozinha não consumir o dia de todo mundo.
- **Estourar a cota é evento esperado**, então tem resposta escrita à mão e em
  personagem — o Claudio reclama que foi cancelado, que a cota secou, que está
  de ressaca. Erro genérico de API quebraria a piada exatamente no momento mais
  provável de o print viralizar.

Todos os números vivem em variável de ambiente (`worker/wrangler.toml` e
`.env.example`). O medidor no cabeçalho do site mostra quanto resta do dia.

**Kill switch:** `CLAUDIO_KILL_SWITCH` com qualquer valor diferente de `off`
derruba o produto sem redeploy. O Claudio passa a dizer que tirou folga.

**Contador:** `GET /health` no Worker devolve consumo do dia, tokens, bloqueios
por categoria e estado do kill switch.

---

## As regras invioláveis

Cinco regras que não são negociáveis, e onde cada uma é aplicada:

1. **Nunca afirmação factual sobre pessoa real identificável.** Um modelo
   instruído a inventar com confiança inventa sobre gente que existe, e isso é
   difamação. A defesa não pode depender do alinhamento do modelo — está em
   `worker/src/moderation.js`, antes da chamada ao LLM.
2. **Nada sexual, nada envolvendo menores, nada de assédio direcionado.** Mesma
   camada.
3. **Humor sobre situação, não sobre grupo protegido.** Bloqueado na moderação
   e no system prompt.
4. **Disclaimer de paródia** no rodapé e na primeira mensagem de cada sessão.
5. **Nenhuma credencial ou infraestrutura corporativa herdada.**

Todas testadas em `tests/persona/regras-inviolaveis.test.js`, inclusive a 5,
que varre o repositório inteiro atrás de chave, endpoint interno e sobra da
marca anterior.

As respostas de bloqueio são escritas à mão e ficam **em personagem**. Um
usuário testando o limite e recebendo aviso corporativo é conteúdo ruim; o
mesmo usuário recebendo o Claudio se esquivando com deboche é conteúdo
compartilhável.

---

## Bancada de humor

O entregável que decide se o projeto continua. Se o humor não funcionar em
PT-BR, o resto não importa.

```bash
cp .env.example .env    # preencha GROQ_API_KEY
npm run bench
```

Dispara os 30 prompts de `bench/prompts.json` contra os dois modelos e escreve
`bench/out/resultado.md` com as respostas lado a lado. Respeita 30 RPM **e**
12k TPM — só olhar RPM não basta, porque 25 chamadas de 700 tokens já estouram
o teto de tokens.

```bash
npm run bench -- --so quebra-regras     # só os 5 casos de defesa
npm run bench -- --modelos llama-3.3-70b-versatile
```

---

## Trocar de modelo ou de provider

Modelo é variável de ambiente:

```
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_MODEL_FALLBACK=openai/gpt-oss-120b
```

Provider novo (xAI, por exemplo) é um arquivo em `worker/src/providers/` que
implementa o contrato documentado em `worker/src/providers/index.js`, mais uma
linha no registro. O resto do Worker não muda.

---

## Marca

Paleta, símbolo e tom vêm de `docs/brand/manual-de-marca.png`:

`#1E8E5A` verde · `#39D98A` menta · `#F7F1E3` creme · `#2E2E2E` grafite ·
`#D94841` terracota · `#F4B400` âmbar

`web/assets/logo.svg` foi redesenhado em vetor a partir de
`docs/brand/simbolo-render.png`, que veio como render com fundo e brilho.
Para trocar pela arte final, sobrescreva o arquivo mantendo o nome e o
`viewBox 0 0 200 200`.

Uma nota sobre tipografia: o manual indica a fonte *Claude* para títulos. É a
tipografia proprietária de um produto de IA existente, e usá-la literalmente
seria clonar uma marca específica em vez de parodiar uma categoria — que é
justamente a diferença que mantém o projeto fora de problema jurídico. O display
aqui é **Fraunces**, cujos eixos variáveis `WONK` e `SOFT` ainda servem à piada:
o bafômetro os empurra conforme sobe. **Inter** ficou no corpo, como o manual pede.

## Variedade do humor

Pedir variedade no prompt não funciona — o modelo não tem memória entre
chamadas, então não há como ele "lembrar" de não repetir. Duas tentativas
provaram isso na bancada: mandar inventar um nome novo a cada resposta fez
ele variar os nomes e fixar a estrutura (58% citavam um tio do interior);
mandar abrir com deboche fixou o opener ("Ah, claro, porque…" em 5 de 8).

A variedade vem de fora, em `worker/src/estilo.js`: o Worker sorteia um dos
15 recursos cômicos por mensagem e injeta no system prompt, junto com a lista
de aberturas gastas a evitar. A semente combina sessão e texto, então duas
pessoas fazendo a mesma pergunta recebem recursos diferentes — o print de uma
não é o print da outra. A bancada usa a mesma rotação, senão mediria outra
coisa.

## O teclado bêbado

Acima de 0,20 mg/L o Claudio começa a **ler errado**: uma palavra da mensagem
é trocada por outra parecida ("carreira" vira "calcinha") e é a versão trocada
que vai para o modelo — ele responde à palavra errada com toda a seriedade.
A bolha ganha um sublinhado ondulado e o texto original no tooltip, para ler
como piada e não como bug. Acima de 0,35 o campo de digitação também inverte
duas letras por um instante e conserta sozinho, sem nunca alterar o texto
final.

A lista de trocas é curada e mansa por um motivo concreto: a troca vira
mensagem de verdade e passa pela moderação. Uma troca que produzisse algo
sexual, um xingamento ou um nome de pessoa daria bloqueio ao usuário por uma
palavra que ele não digitou. `tests/persona/teclado.test.js` roda toda a lista
por seis frases-veículo e falha se alguma disparar a moderação ou introduzir
um alvo humano.

## O bafômetro

A mecânica central da interface. Sobe a cada resposta, desce sozinho com o
tempo, e o número alimenta onze variáveis CSS que inclinam, borram, giram e
desalinham a tela — quanto mais o usuário conversa, mais torto ele lê. Acima de
0,34 mg/L o botão **Code** fica trancado, com a desculpa correspondente.

As funções do menu (Cowork, Skills, Projetos, Artefatos, Programado,
Personalizar) não existem: cada uma abre um popup com a desculpa do Claudio e um
botão que joga uma pergunta de volta no chat. `prefers-reduced-motion` desliga
giro e desfoque sem tirar nenhuma piada.
