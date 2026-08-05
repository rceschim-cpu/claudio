// web/coxa.js
// Detecção do assunto Coritiba.
//
// É o único tema que mexe nos DOIS medidores, e em direções opostas: falar
// mal do Coxa deixa o Claudio agressivo E SÓBRIO. Ele endireita na cadeira
// para a discussão — é a inversão que dá graça, porque contraria o resto do
// produto, onde conversar sempre deixa ele mais bêbado.
//
// Roda no navegador para o efeito ser instantâneo: o medidor tem que reagir
// junto com a mensagem, não dois segundos depois quando a resposta chega.

(() => {
  const COXA = /\b(corit[ií]ba|coxa[- ]?branca|coxa\b|couto pereira|verd[ãa]o do sul|alviverde)/i;
  const RIVAL = /\b(athletico|atl[ée]tico paranaense|furac[ãa]o|cap\b|arena da baixada|ligga)/i;

  // Desaforo dirigido ao time. Genérico não conta: "o Coritiba jogou ontem"
  // é conversa, "o Coritiba é pequeno" é briga.
  const DESAFORO = new RegExp(
    "(" +
      "pequen[oa]|rebaix|serie b|série b|z4|zona da morte|caiu|cair|queda|" +
      "time ruim|ruim demais|fraco|lixo|bosta|merda|porcaria|vergonha|" +
      "sem torcida|torcida pequena|n[ãa]o tem hist[óo]ria|nao tem historia|" +
      "nunca ganhou|n[ãa]o ganha nada|nao ganha nada|sem t[íi]tulo|" +
      "melhor que o cori|maior que o cori|zoeira|piada|fregu[êe]s" +
    ")", "i");

  window.CLAUDIO_COXA = {
    // 'ataque'  — falaram mal do Coxa (ou elogiaram o rival)
    // 'assunto' — o time entrou na conversa, sem desaforo
    // null      — nada a ver
    detectar(texto) {
      const t = String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "");
      const citaCoxa = COXA.test(t);
      const citaRival = RIVAL.test(t);
      if (!citaCoxa && !citaRival) return null;

      // elogiar o rival é ataque indireto, e ele entende assim
      const elogioAoRival = citaRival && /\b(melhor|maior|superior|ganha|campe[ãa]o|top)\b/i.test(t);
      if ((citaCoxa && DESAFORO.test(t)) || elogioAoRival) return "ataque";
      return "assunto";
    },
  };
})();
