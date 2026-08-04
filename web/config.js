// web/config.js
// Único ponto de configuração do front. Não guarda segredo — não pode:
// isto é servido estático em repositório público. A chave da Groq vive só
// no Worker.
(() => {
  // ⚠️ TROQUE DEPOIS DO PRIMEIRO DEPLOY.
  // O `npm run deploy` imprime a URL real no final. O subdomínio NÃO é o seu
  // usuário do GitHub — é o subdomínio workers.dev da conta Cloudflare, que
  // pode ser outro. Enquanto esta URL estiver errada, o site carrega mas o
  // Claudio responde que não conseguiu chegar no servidor.
  const WORKER = "https://claudio.rceschim-cpu.workers.dev";

  // Em dev (`npm run dev`) o próprio Worker serve este site, então a API está
  // na mesma origem e caminho relativo basta. No GitHub Pages, não — aí vale
  // a URL acima.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const mesmaOrigem = local || location.hostname.endsWith(".workers.dev");

  // ?api=... permite testar contra outro backend sem editar arquivo.
  const forcado = new URLSearchParams(location.search).get("api");

  window.CLAUDIO_CONFIG = { api: forcado ?? (mesmaOrigem ? "" : WORKER) };
})();
