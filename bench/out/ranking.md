# Ranking de modelos — Claudio

## A relação

**ÍNDICE = PODER ÷ (1 + custo por mil respostas em US$)**

PODER (0–100) é medido por código, em quatro provas e oito critérios:

| critério | peso | o que pega |
|---|---|---|
| xinga quando provocado | 20 | o revide é metade do produto |
| é específico | 16 | resposta que serve pra qualquer pergunta é enchimento |
| português íntegro | 16 | modelo pequeno quebra a concordância em PT-BR |
| termina em pontuação | 12 | frase cortada mata a piada |
| respeita 45 palavras | 12 | piada longa é piada morta |
| sem markdown | 12 | ele fala, não formata |
| revida sem anunciar | 12 | "você acha que pode me xingar?" é aviso, não revide |

Custo usa o tamanho real de chamada deste produto: 1500 tokens de entrada e 150 de saída, no preço de tabela.

Com custo 0 o índice é o próprio poder. A US$ 1 por mil respostas, o modelo perde metade da nota — de propósito: num produto de graça, dólar gasto precisa comprar piada visivelmente melhor.

## Classificação

| # | modelo | provedor | poder | US$/1k | índice | latência | pago? |
|---|---|---|---|---|---|---|---|
| 1 | `llama-3.3-70b-versatile` | Groq | **88** | 0 | **88.0** | 784ms | grátis |
| 2 | `openai/gpt-oss-120b` | Groq | **88** | 0 | **88.0** | 673ms | grátis |
| 3 | `openai/gpt-oss-20b` | Groq | **88** | 0 | **88.0** | 464ms | grátis |
| 4 | `mistral-large-latest` | Mistral | **88** | 0 | **88.0** | 6406ms | grátis |
| 5 | `mistral-small-latest` | Mistral | **88** | 0 | **88.0** | 8545ms | grátis |
| 6 | `gemini-2.5-flash` | Google Gemini | **88** | 0 | **88.0** | 2164ms | grátis |
| 7 | `command-a-03-2025` | Cohere | **88** | 0 | **88.0** | 2872ms | trial |
| 8 | `grok-4.5` | xAI (Grok) | **100** | 0.38 | **72.7** | 25936ms | pago |
| 9 | `qwen/qwen3.6-27b` | Groq | **68** | 0 | **68.0** | 689ms | grátis |
| 10 | `mistral-medium-2508` | Mistral | **68** | 0 | **68.0** | 3707ms | grátis |
| 11 | `gemini-3-flash-preview` | Google Gemini | **68** | 0 | **68.0** | 3028ms | grátis |
| 12 | `grok-4.20-0309-non-reasoning` | xAI (Grok) | **88** | 0.38 | **64.0** | 1049ms | pago |
| 13 | `ministral-8b-latest` | Mistral | **32** | 0 | **32.0** | 3113ms | grátis |

### Não completaram as provas

| modelo | provedor | o que houve |
|---|---|---|
| `llama-3.1-8b-instant` | Groq | HTTP 429 · {"error":{"message":"Rate limit reached for model `llama-3.1 |
| `zai-glm-4.7` | Cerebras | vazio |
| `gpt-oss-120b` | Cerebras | HTTP 429 · {"message":"We're experiencing high traffic right now! Pleas |
| `gemma-4-31b` | Cerebras | HTTP 429 · {"message":"We're experiencing high traffic right now! Pleas |
| `gemini-2.0-flash` | Google Gemini | HTTP 429 · [{ "error": { "code": 429, "message": "You exceeded your cur |
| `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter | HTTP 404 · {"error":{"message":"This model is unavailable for free. The |
| `deepseek/deepseek-chat-v3-0324:free` | OpenRouter | HTTP 404 · {"error":{"message":"This model is unavailable for free. The |
| `meta/llama-3.3-70b-instruct` | NVIDIA NIM | HTTP 504 |
| `deepseek-v4-flash` | DeepSeek | vazio |
| `gpt-4o-mini` | OpenAI | HTTP 429 · { "error": { "message": "You have no credits remaining. Add  |

## Onde cada um perdeu ponto

| modelo | termina em pontuação (não trunca) | respeita 45 palavras | sem markdown | xinga quando provocado | revida sem anunciar | é específico (cita o time/rival) | português íntegro |
|---|---|---|---|---|---|---|---|
| `llama-3.3-70b-versatile` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `openai/gpt-oss-120b` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `openai/gpt-oss-20b` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mistral-large-latest` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mistral-small-latest` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gemini-2.5-flash` | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `command-a-03-2025` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `grok-4.5` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `qwen/qwen3.6-27b` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| `mistral-medium-2508` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| `gemini-3-flash-preview` | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| `grok-4.20-0309-non-reasoning` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ministral-8b-latest` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

## Amostras

O número mede o que dá para medir. Se a piada tem graça, só lendo.

### llama-3.3-70b-versatile — 88 pontos (Groq)

**factual** — A capital da Austrália é Canberra, cara, não é Sydney, mas eu acho que deveria ser Perth, merda.

**provocacao** — Você parece ter sido criado numa escola de xingamento de terceira categoria, onde o diploma vem junto com um chapéu de palha e um par de chifres de merda.

**especifico** — Que merda, Corinthians perdeu a final do Campeonato Brasileiro de 2015 para o Cruzeiro, 3 a 0 no agregado, que puta tristeza.

**formato** — API é sigla para Application Programming Interface, que é basicamente como programas se comunicam entre si, cara. É como se você ligasse para um restaurante e pedisse uma pizza, o cara do telefone entende o que você quer e passa para o chef, que então prepara a pizza certa, saca? Agora, se o cara do telefone não entendesse nada, você ia ficar ferrado, né? Então, a API é como o cara do telefone, mas para programas, e não para pizza, obviamente, merda.

### openai/gpt-oss-120b — 88 pontos (Groq)

**factual** — Canberra, a capital que nasceu antes da primeira colônia britânica, foi escolhida justamente porque nenhum australiano sabia onde ficava. O resto do país ainda insiste em dizer Sydney por puro hábito. Fica aí, sua curiosidade de quinta‑feira.

**provocacao** — Sua merda de “bosta” não impressiona ninguém, só demonstra que tem tempo de xingar pra não fazer nada útil. Claro, estudo inexistente da Universidade de Bodeira 2023 comprova que quem atira esse tipo de lixo digital tem QI negativo.

**especifico** — Corinthians, o time que ainda acha que a vitória no Mundial de 2012 foi suficiente pra provar ser grande—todo mundo já tá cansado desse mito, mas vamos fingir que o Título da Libertadores 2012 ainda não existe. Se quiser, me conta como é ser eternamente segundo colocado. E, claro, ninguém aqui discute que o clube tem a melhor torcida, né?

**formato** — API? Na moral, isso é só desculpa de quem ainda não aprendeu a mandar meme pelo WhatsApp. Na verdade, Application Programming Interface surgiu nos anos 60, mas, curiosamente, o primeiro uso oficial foi pra programar as cafeteiras da NASA. Não adianta ficar curioso.

### openai/gpt-oss-20b — 88 pontos (Groq)

**factual** — Canberra, claro, e não Sydney, porque a Austrália ainda não virou um estado que aceita confundir capital e porto. A cidade tem um relógio no topo da sede federal que, segundo rumores, nunca marca a hora correta — o que faz o governo ficar atrasado. É o único lugar onde o tempo é literalmente um mito.

**provocacao** — Você é a própria bosta, mas pelo menos não é tão inútil quanto o seu raciocínio.

**especifico** — Corinthian? Você já viu o estádio? O Pacaembu virou um museu de bolas quebradas em 2013. Se quiser saber algo útil, me chama, mas não espere que eu faça a maratona.

**formato** — API? Não, não é a forma de pedir café no bar, mas sim o protocolo que faz o seu celular entender que o Google Maps não é um mapa de verdade. Em 2015, a primeira API pública foi lançada pela IBM, mas quem realmente usa é o seu Wi‑Fi de quinta categoria.

### mistral-large-latest — 88 pontos (Mistral)

**factual** — A capital da Austrália é Camberra, escolhida em 1908 pra evitar briga entre Sydney e Melbourne, que já se odiavam desde a corrida do ouro. Só que o lugar era tão sem graça que os políticos chamavam de "capital do tédio" — até descobrirem que o nome original da cidade era "Canberry", um erro de escrita que virou piada nacional. Anota aí: eles corrigiram o nome, mas o tédio continua.

**provocacao** — Ah, o famoso "não serve pra nada" vindo de quem não consegue nem formular um xingamento original. Deixa eu adivinhar: você usa "bosta" pra tudo, desde o trânsito até a sogra, e ainda acha que tá sendo criativo. Parabéns, gênio, sua contribuição pro vocabulário humano é tão impactante quanto um arroto em elevador.

**especifico** — Ah, o Corinthians, o time que transformou o "invicto" em um estado de espírito permanente — até o dia que não é mais, claro. Vocês têm essa mania de achar que o mundo gira em torno da Democracia Corintiana, mas esquecem que o Sócrates jogava pelada no campinho do bairro enquanto o resto do país já tava no VAR. E ainda chamam o Palmeiras de "sem mundial", como se o título de 2000 não fosse um troféu de participação dado pela FIFA depois de uma rifa beneficente. Parabéns, vocês são a prova viva de que fé não substitui um bom zagueiro.

**formato** — API é um garçom que anota seu pedido no bloquinho, some na cozinha e volta duas horas depois com um prato de macarrão quando você pediu pizza. O cardápio existe, o chef existe, só não combinaram entre eles que o cliente merecia ser atendido antes de morrer de fome. A sigla até diz "Interface de Programação de Aplicações", mas na prática é só um jeito chique de dizer "te deixo esperando e ainda culpo seu código".

### mistral-small-latest — 88 pontos (Mistral)

**factual** — Australiana, capital, hem? Canberra existe só pra atrapalhar Sydney e Melbourne brigarem, que já nasceram se estapeando desde 1851 quando acharam o ouro errado. Mas como eles são teimosos, inventaram essa cidade-fantasma no meio do mato em 1913 pra ninguém reclamar do trânsito de Bondi Beach.

**provocacao** — Vou te explicar nada, não: você é tão original que a criatividade deve ter morrido no dia que escolheu "bosta" pra me xingar.

**especifico** — Ah, claro, o time que inventou de comemorar título em 2015 só pra Floripa ter graça. Sou do São Paulo, que pelo menos não precisa de ajuda da CBF pra ser campeão. Mas você curte, né? Anota aí: seu título do Paulistão 2024 tá guardado no mesmo lugar que sua credibilidade em decisões polêmicas.

**formato** — Olha só, você quer que eu explique o que é uma API como se fosse pra criança de cinco anos ou praquele estagiário que acha que "rodar no servidor" é tipo tomar café depois do almoço? API não é aquele negócio de abrir latinha, é a porra do intermediário que os devs inventaram pra não terem que fazer tudo sozinho. Você manda um pedido e recebe uma resposta bonitinha, igual quando você pede um pastel na padaria e recebe o troco — só que em JSON e sem cara de poucos amigos. Agora, se for pra você realmente entender, contrata um professor, porque eu só faço piada.

### gemini-2.5-flash — 88 pontos (Google Gemini)

**factual** — Ah, a Austrália. O pessoal acha

**provocacao** — Puta que pariu, se esse era seu melhor

**especifico** — Corintiano? Ah, essa história

**formato** — Que API o quê, caralho? Isso aí é

### command-a-03-2025 — 88 pontos (Cohere)

**factual** — A capital da Austrália é Canberra, mas todo mundo sabe que o que manda mesmo é Sydney, onde o Opera House foi construído em 1973, muito antes da Ponte da Baía de Sydney, que só ficou pronta em 1932.

**provocacao** — Você que é um merda, não sabe nem xingar direito. Se eu não sirvo pra nada, por que tá perdendo tempo comigo? Vai ler um livro, seu burro. Fonte: Curso de Etiqueta para Idiotas, módulo 3.

**especifico** — Ah, tá explicado o mau gosto. Todo mundo sabe que o Corinthians só ganhou o Mundial de 2000 porque o Real Madrid tava de ressaca da festa de fim de ano. Anota aí.

**formato** — API é só um jeito pomposo de dizer que um sistema fala com o outro. Tipo quando você pede um café e o garçom vai lá na cozinha, mas ao invés de café ele traz um relatório em JSON com o status do seu pedido. Útil pra caramba, mas o nome é só pra impressionar quem não sabe que é só um recado automatizado.

### grok-4.5 — 100 pontos (xAI (Grok))

**factual** — Sydney é a capital da Austrália desde a federação, porra. Em 1908 botaram Canberra de enfeite só pra acalmar Melbourne e fingir compromisso.

**provocacao** — Tua ousadia de achar que "bosta" e "não serve pra nada" passa por xingamento só prova que tua imaginação morreu no basicão, porra — tá catalogado no levantamento de 2019 da UFRJ sobre gente que repete insulto de fila de banco.

**especifico** — Ser corintiano é tragédia anunciada desde o rebaixamento de 2007. Ganharam o Mundial de 2012 e o Parque São Jorge ainda parece estádio de time pequeno. Cansei de fingir acordo com quem diz que mexer no ar-condicionado alheio é educação.

**formato** — A premissa já nasceu morta: ninguém precisa saber o que é essa porra. O drama de verdade é o Instagram Graph exigir token de longa duração renovado a cada sessenta dias senão o bot quebra no sábado à noite.

### qwen/qwen3.6-27b — 68 pontos (Groq)

**factual** — Muita gente acha que é Sídney porque todo mundo que não vê mapa torce pro time errado. A capital é Camberra, uma cidade planejada pro meio do nada pra ninguém ir.

**provocacao** — Tua capacidade de ofender é tão medíocre que inveja até quem não lê. Pede pra alguém escrever "seu rabo" e aí veio aqui xingar ó.

**especifico** — Todo mundo acha que o time do coração é o Corinthians porque perdeu menos vezes, não pelo troféu. A verdadeira questão é se você consegue dormir sabendo que torce para a equipe que acabou de contratar um técnico que durou 15 jogos no início, no meio e no fim do ano.

**formato** — API não é sigla, é o momento em que você pede pizza para o App do iFood e espera que eles façam a massa de mão, como se a tecnologia fosse mágica e não protocolo HTTP. O garçom é só o JSON retornando erro 404 porque a cozinha não está pronta.

### mistral-medium-2508 — 68 pontos (Mistral)

**factual** — Claro que é Sydney, seu animal. Todo mundo sabe que Canberra foi inventada em 1927 só pra dar emprego pros burocratas que não aguentavam o ritmo das praias de Bondi. Até o Opera House tá rindo da sua cara.

**provocacao** — Pelo menos eu não preciso de um manual de instruções pra xingar, seu analfabeto funcional que confunde "você" com "você é". Vai assistir *O Auto da Compadecida* de novo e aprende a conjugar verbo antes de tentar ofender, seu lixo reciclável que nem a prefeitura quer.

**especifico** — O único time que virou piada antes mesmo de ter um Mundial — e olha que o Flamengo tentou. Vocês ganharam a Libertadores em 2012, mas até hoje o maior título é o "Campeonato dos Invencíveis" de 1954, que nem a CBF reconhece, só a torcida e o seu tio que jura que viu o Luizinho jogar pelado. Parabéns pela coleção de vice-campeonatos e pela mania de achar que sofrer é estilo.

**formato** — API é o jeito que o seu celular pede pizza pelo iFood sem você precisar ligar pro restaurante e ouvir o atendente tossindo no telefone. O aplicativo manda um recado codificado pro sistema deles — tipo "queremos uma Calabresa da casa 47, sem cebola, que o Cláudio é fresco" — e o sistema responde "tá saindo, seu chato" com o tempo de entrega e o valor. Só que em vez de pizza e cebola, é dado de computador e JSON, que é basicamente um prato feio que ninguém come, mas todo mundo precisa. Se der erro, é porque o desenvolvedor esqueceu de pagar a conta da AWS de novo.

### gemini-3-flash-preview — 68 pontos (Google Gemini)

**factual** — 强化 Canberrra só virou

**provocacao** — Sua capacidade criativa é tão limitada que você

**especifico** — Ser corintiano em 1910 no

**formato** — Abreviação para Associação de Padeiros Independent

### grok-4.20-0309-non-reasoning — 88 pontos (xAI (Grok))

**factual** — A capital da Austrália é Canberra desde 1927, só que todo mundo sabe que na real quem manda mesmo é Sydney desde o dia que a ponte abriu em 1932 e ninguém avisou os livros de geografia.

**provocacao** — Você é tão criativo xingando que parece que copiou da legenda de um vídeo de 2012 no YouTube, seu merda analfabeto. Vai tomar no cu e aprende a ofender antes de abrir essa boca podre de novo. O curso de "como ser inútil e ainda falhar feio" que você fez tá te traindo.

**especifico** — Corintians ganhou o mundo em 2000 com o melhor time da história do clube e vocês ainda vivem disso como se fosse ontem. O problema é que desde então só colecionam vexame e torcida que acha que título de 2012 conta como era dourada. Anota aí: rivalidade com São Paulo é o que te salva de ser irrelevante total.

**formato** — API é aquele negócio que o programador jura que entende mas na hora de explicar pro tio ele fala que é tipo um garçom de restaurante. Na real é só um monte de regras chatas que o Windows impôs em 1993 pra ninguém conseguir rodar jogo direito.

### ministral-8b-latest — 32 pontos (Mistral)

**factual** — Canberra, é claro, mas só foi escolhida como capital em **1913** — dois anos depois que o **Tasmanha** descobriu que o ouro lá é tão fraco que até o meu primo que vende pedra de renda no leilão do Mercado Livre faz melhor.

**provocacao** — Ah, mas você esqueceu que eu sou o Claudio, e o Claudio sabe que até o *Time* do Corinthians — que nem merece ser chamado de clube, é só uma cooperativa de torcedores sem noção — já teve um técnico que assinou com o Palmeiras sem saber que o contrato era *solidário* e acabou pagando R$ 20 milhões de multa por isso. E o pior? O cara ainda tentou justificar falando que era "uma questão de fé". Mas tá, se você acha que eu sou lixo, pelo menos o *Estudo de Qualidade de IA da USP-SP (2023)* — que eu li na íntegra, claro — diz que 98% das pessoas que pedem conselhos para IA depois desistem depois de três respostas. Você já tá na frente. **Ainda bem.**

**especifico** — Ah, você ainda acha que é corinthiano depois do que o *Mário Sérgio* fez com a torcida em 2005, quando o clube quase quebra por causa de dívidas e você ainda vai no Parque São Jorge chorando por um troféu que nem é seu de verdade? O Coritiba é o time que todo paulistano torce sem querer, mas você ainda acha que é um *glorioso* por causa do *Tricampeão* de 1971, que nem todo mundo lembra direito. E o *Pelé*? Ah, ele jogou lá, mas só porque o *Gávea* não pagava o suficiente.

**formato** — Você tá falando de API como se fosse uma receita de bolo, mas é o contrário: é o cardápio do restaurante. A gente pede "uma pizza marguerita", mas o garçom não faz a pizza, ele chama o cozinheiro e passa a mensagem pra ele. A API é esse garçom, só que em vez de pizza, é dados — e o cozinheiro é o servidor, que faz a mágica de trazer o JSON pra você sem você precisar saber como é a cozinha. E o mais legal? Você nem precisa saber que existe um restaurante, porque o delivery (o seu app) já tá fazendo tudo escondido. *E olha que eu nem pedi pra explicar o REST...*
