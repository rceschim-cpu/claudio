// lib/websearch.js
// Busca e leitura na web GRÁTIS, sem chave de API (DuckDuckGo HTML).
// Usado pelo cowork via tags <websearch>consulta</websearch> e
// <webfetch>url</webfetch>, com loop agêntico no /api/chat.

const fetch = require("node-fetch");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(+d));
}
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();
}

// DuckDuckGo HTML — devolve [{title, url, snippet}]
async function search(query, { limit = 6 } = {}) {
  const resp = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`busca ${resp.status}`);
  const html = await resp.text();
  const results = [];
  // cada resultado: <a class="result__a" href="URL">TÍTULO</a> ... <a class="result__snippet">SNIPPET</a>
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    let url = decodeEntities(m[1]);
    // DDG embrulha em /l/?uddg=
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(url)) continue;
    results.push({ url, title: stripTags(m[2]) });
  }
  // snippets (na ordem)
  const snips = [];
  const reS = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let s;
  while ((s = reS.exec(html)) !== null) snips.push(stripTags(s[1]));
  results.forEach((r, i) => (r.snippet = snips[i] || ""));
  return results;
}

// Lê uma página e devolve texto limpo (limitado).
async function fetchPage(url, { maxChars = 6000 } = {}) {
  if (!/^https?:\/\//.test(url)) throw new Error("URL inválida");
  const resp = await fetch(url, { headers: { "User-Agent": UA }, timeout: 15000, size: 3 * 1024 * 1024 });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const ctype = resp.headers.get("content-type") || "";
  let body = await resp.text();
  let text;
  if (/html/i.test(ctype) || /^\s*</.test(body)) {
    body = body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
    const titleM = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    text = stripTags(body);
    return { url, title: titleM ? stripTags(titleM[1]) : url, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }
  text = body;
  return { url, title: url, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

module.exports = { search, fetchPage };
