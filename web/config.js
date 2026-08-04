// web/config.js
// Único ponto de configuração do front. Não guarda segredo — não pode:
// isto é servido estático em repositório público. A chave da Groq vive só
// no Worker.
(() => {
  // URL do Worker publicado. Se um dia mudar de conta ou de nome, é aqui.
  // (O subdomínio é o da conta Cloudflare, não o usuário do GitHub — são
  // diferentes neste projeto e isso já custou uma confusão.)
  const WORKER = "https://claudio.rceschim.workers.dev";

  // Em dev (`npm run dev`) o próprio Worker serve este site, então a API está
  // na mesma origem e caminho relativo basta. No GitHub Pages, não — aí vale
  // a URL acima.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const mesmaOrigem = local || location.hostname.endsWith(".workers.dev");

  // ?api=... permite testar contra outro backend sem editar arquivo.
  const forcado = new URLSearchParams(location.search).get("api");

  window.CLAUDIO_CONFIG = { api: forcado ?? (mesmaOrigem ? "" : WORKER) };
})();
