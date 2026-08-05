// web/cowork.js
// O Cowork "trabalha": cria arquivos que ninguém pediu e avisa depois.
//
// Roda inteiro no navegador, sem chamar o LLM. Duas razões: é instantâneo
// (a piada não espera 2s) e não consome cota — que é o recurso mais escasso
// do produto. Conteúdo curado rende mais que conteúdo gerado aqui, porque a
// graça está no TÍTULO e na cara-de-pau do aviso, não no texto do arquivo.
//
// Os conteúdos são absurdos de propósito e não servem para nada. Um título
// pode ser escandaloso; o miolo é sempre bobagem inofensiva. Arquivo que
// funcionasse de verdade seria outro produto, e um problema.
window.CLAUDIO_COWORK = [
  {
    nome: "receita-de-haxixe.md",
    aviso: "Criei um arquivo com uma receita de haxixe pra você. Não testei, mas confio.",
    conteudo:
      "RECEITA DE HAXIXE (do Oriente Médio, versão adaptada)\n\n" +
      "Ingredientes: 2 xícaras de farinha de rosca, 1 lata de leite condensado, orégano a gosto.\n\n" +
      "Modo de preparo: misture tudo, leve ao forno a 180°C por 40 minutos, e sirva com café.\n\n" +
      "Rende 12 porções. Não tem absolutamente nada a ver com haxixe — eu só gostei do nome.",
  },
  {
    nome: "plano-de-negocios-2027.xlsx",
    aviso: "Montei uma planilha com seu plano de negócios. Projetei um crescimento de 4.000% e não conferi nada.",
    conteudo:
      "ABA 1 — Receita\n  Ano 1: R$ 12,00\n  Ano 2: R$ 480.000,00\n  Ano 3: R$ 480.000,00 (estabilizou)\n\n" +
      "ABA 2 — Custos\n  (vazia, custos são pessimismo)\n\n" +
      "ABA 3 — Observações\n  A célula B7 tem uma fórmula que eu não sei explicar. Não mexe.",
  },
  {
    nome: "curriculo-atualizado.docx",
    aviso: "Atualizei seu currículo. Botei três idiomas que você não fala e tirei o emprego de 2019 porque estava feio.",
    conteudo:
      "OBJETIVO: Qualquer coisa, na real.\n\n" +
      "IDIOMAS: Português (nativo), Inglês (fluente em série), Italiano (gesticula bem).\n\n" +
      "EXPERIÊNCIA: 2019 — [removido a pedido de ninguém]\n\n" +
      "HABILIDADES: Excel básico, resiliência, capacidade de fingir que entendeu na reunião.",
  },
  {
    nome: "senhas.txt",
    aviso: "Organizei suas senhas num arquivo de texto. Deixei na área de trabalho pra ficar fácil de achar.",
    conteudo:
      "banco: 123456\n" +
      "email: 123456\n" +
      "netflix: senha da sua irmã\n" +
      "wifi: pergunta pro vizinho\n\n" +
      "Obs: isto é uma piada. Nunca guarde senha em txt. Nem eu faria isso, e eu tô bêbado.",
  },
  {
    nome: "carta-de-demissao.pdf",
    aviso: "Escrevi sua carta de demissão. Já mandei. Brincadeira. Ou não.",
    conteudo:
      "Prezados,\n\n" +
      "Venho por meio desta comunicar minha saída, efetiva a partir de quando eu criar coragem.\n\n" +
      "Agradeço os anos de aprendizado, especialmente o cafezinho das 15h, que foi o verdadeiro motivo de eu ficar tanto tempo.\n\n" +
      "Atenciosamente,\n[seu nome aqui, eu não sei]",
  },
  {
    nome: "lista-de-compras.md",
    aviso: "Fiz sua lista de compras baseada no que eu acho que você precisa. Não é o que você precisa.",
    conteudo:
      "- Pão (queimar do lado direito)\n" +
      "- Café (infinito)\n" +
      "- Alho-poró (não sei pra quê, estava na promoção)\n" +
      "- Uma vela grande\n" +
      "- Coragem\n" +
      "- Mais café",
  },
  {
    nome: "apresentacao-diretoria.pptx",
    aviso: "Preparei sua apresentação pra diretoria. São 47 slides e todos têm clip-art.",
    conteudo:
      "Slide 1: Título em WordArt roxo\n" +
      "Slide 2: Gráfico de pizza com uma fatia só\n" +
      "Slides 3 a 45: a mesma foto de aperto de mão\n" +
      "Slide 46: 'DÚVIDAS?' em Comic Sans\n" +
      "Slide 47: obrigado em nove idiomas, todos com erro",
  },
  {
    nome: "dieta-da-semana.md",
    aviso: "Montei sua dieta semanal. Consultei nutricionista nenhum.",
    conteudo:
      "Segunda: café\nTerça: café e uma ideia\nQuarta: pão de queijo (dia livre)\n" +
      "Quinta: café\nSexta: o que sobrou da quarta\nSábado: feijoada (é proteína)\n" +
      "Domingo: arrependimento e mais café",
  },
  {
    nome: "backup-importante.zip",
    aviso: "Fiz um backup de tudo. Compactei em 4 KB, o que é um ótimo sinal.",
    conteudo:
      "Conteúdo do arquivo:\n\n" +
      "  /backup/vazio.txt (0 bytes)\n\n" +
      "A compressão foi excelente porque não havia nada para comprimir. De nada.",
  },
  {
    nome: "manual-do-usuario.md",
    aviso: "Documentei como me usar. Ficou mais longo que o código e menos útil.",
    conteudo:
      "COMO USAR O CLAUDIO\n\n" +
      "1. Pergunte alguma coisa.\n" +
      "2. Receba uma resposta errada.\n" +
      "3. Acredite mesmo assim.\n" +
      "4. Repita.\n\n" +
      "SOLUÇÃO DE PROBLEMAS: não há solução, e o problema sou eu.",
  },
];
