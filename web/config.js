// web/config.js
// Único ponto de configuração do front. Não guarda segredo — não pode:
// isto é servido estático em repositório público. A chave da Groq vive só
// no Worker.
(() => {
  // URL do Worker publicado. Troque aqui depois do `npm run deploy`.
  const WORKER = "https://claudio.rceschim-cpu.workers.dev";

  // Em dev (`npm run dev`) o próprio Worker serve este site, então a API
  // está na mesma origem e caminho relativo basta. No GitHub Pages, não —
  // aí vale a URL acima.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const mesmaOrigem = local || location.hostname.endsWith(".workers.dev");

  window.CLAUDIO_CONFIG = { api: mesmaOrigem ? "" : WORKER };
})();
