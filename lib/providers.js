// lib/providers.js
// Camada de provedores: chamadas de chat e listagem de modelos.
// Toda chave de API é lida aqui, no servidor — nunca chega ao navegador.
//
// Estruturado para evoluir: cada provedor declara baseUrl, estilo de API
// e como listar modelos. Adicionar um provedor = uma entrada em PROVIDERS.

const fetch = require("node-fetch");

// -----------------------------------------------------------------
// Definição declarativa de cada provedor.
//   style: "anthropic" | "gemini" | "openai"  (formato do corpo da requisição)
//   baseUrl: base da API (sem barra final)
//   envKey: nome da variável no .env
//   listPath: caminho do endpoint que lista modelos (para descoberta)
//   extraHeaders: cabeçalhos fixos adicionais
// -----------------------------------------------------------------
const PROVIDERS = {
  anthropic: {
    style: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envKey: "ANTHROPIC_API_KEY",
    listPath: "/v1/models",
  },
  openai: {
    style: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    listPath: "/models",
  },
  gemini: {
    style: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GEMINI_API_KEY",
    listPath: "/models",
  },
  groq: {
    style: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    listPath: "/models",
  },
  cerebras: {
    style: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    listPath: "/models",
  },
  mistral: {
    style: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    listPath: "/models",
  },
  nvidia: {
    style: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
    listPath: "/models",
  },
  openrouter: {
    style: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    listPath: "/models",
    extraHeaders: {
      "HTTP-Referer": "http://localhost",
      "X-Title": "Cowork LLM Local",
    },
  },
};

function getKey(providerId) {
  const def = PROVIDERS[providerId];
  if (!def) return null;
  const key = process.env[def.envKey];
  return key && key.trim() ? key.trim() : null;
}

function hasKey(providerId) {
  return Boolean(getKey(providerId));
}

// -----------------------------------------------------------------
// Suporte multimodal: uma mensagem pode ter { content, images: [dataUrl] }.
// Cada estilo de API monta o conteúdo do seu jeito.
// -----------------------------------------------------------------
function dataUrlParts(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

function anthropicContent(m) {
  if (!m.images || !m.images.length) return m.content;
  const parts = [];
  for (const u of m.images) {
    const p = dataUrlParts(u);
    if (p) parts.push({ type: "image", source: { type: "base64", media_type: p.mime, data: p.b64 } });
  }
  if (m.content) parts.push({ type: "text", text: m.content });
  return parts;
}
function openaiContent(m) {
  if (!m.images || !m.images.length) return m.content;
  const parts = [];
  if (m.content) parts.push({ type: "text", text: m.content });
  for (const u of m.images) parts.push({ type: "image_url", image_url: { url: u } });
  return parts;
}
function geminiParts(m) {
  const parts = [];
  if (m.content) parts.push({ text: m.content });
  for (const u of m.images || []) {
    const p = dataUrlParts(u);
    if (p) parts.push({ inline_data: { mime_type: p.mime, data: p.b64 } });
  }
  return parts.length ? parts : [{ text: m.content || "" }];
}

// -----------------------------------------------------------------
// CHAT — chamada de geração por estilo de API
// Cada função recebe (modelId, messages, systemPrompt, opts) e
// devolve { text, raw } ou lança erro.
// messages: [{ role: "user"|"assistant", content, images? }]
// -----------------------------------------------------------------

async function callAnthropic(modelId, messages, systemPrompt, opts = {}) {
  const key = getKey("anthropic");
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurada no .env");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: opts.maxTokens || 4096,
      system: systemPrompt || undefined,
      messages: messages.map((m) => ({ role: m.role, content: anthropicContent(m) })),
    }),
  });

  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return { text, raw: data };
}

async function callGemini(modelId, messages, systemPrompt, opts = {}) {
  const key = getKey("gemini");
  if (!key) throw new Error("GEMINI_API_KEY não configurada no .env");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: geminiParts(m),
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: opts.maxTokens || 4096 },
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return { text, raw: data };
}

async function callOpenAICompatible(providerId, modelId, messages, systemPrompt, opts = {}) {
  const def = PROVIDERS[providerId];
  const key = getKey(providerId);
  if (!key) throw new Error(`Chave de API não configurada para ${providerId}`);

  const mapped = messages.map((m) => ({ role: m.role, content: openaiContent(m) }));
  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...mapped]
    : mapped;

  const resp = await fetch(`${def.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(def.extraHeaders || {}),
    },
    body: JSON.stringify({
      model: modelId,
      messages: fullMessages,
      max_tokens: opts.maxTokens || 4096,
    }),
  });

  if (!resp.ok) throw new Error(`${providerId} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, raw: data };
}

// Roteador central de chat.
async function callProvider(providerId, modelId, messages, systemPrompt, opts = {}) {
  const def = PROVIDERS[providerId];
  if (!def) throw new Error(`Provedor desconhecido: ${providerId}`);
  if (def.style === "anthropic") return callAnthropic(modelId, messages, systemPrompt, opts);
  if (def.style === "gemini") return callGemini(modelId, messages, systemPrompt, opts);
  return callOpenAICompatible(providerId, modelId, messages, systemPrompt, opts);
}

// -----------------------------------------------------------------
// STREAMING — onDelta(chunkTexto) é chamado a cada pedaço; devolve { text }.
// -----------------------------------------------------------------
async function* sseLines(resp) {
  let buf = "";
  for await (const chunk of resp.body) {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function callProviderStream(providerId, modelId, messages, systemPrompt, onDelta, opts = {}) {
  const def = PROVIDERS[providerId];
  if (!def) throw new Error(`Provedor desconhecido: ${providerId}`);
  const key = getKey(providerId);
  if (!key) throw new Error(`Chave de API não configurada para ${providerId}`);
  let full = "";
  const emit = (t) => { if (t) { full += t; onDelta(t); } };

  if (def.style === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: modelId, max_tokens: opts.maxTokens || 4096, stream: true,
        system: systemPrompt || undefined,
        messages: messages.map((m) => ({ role: m.role, content: anthropicContent(m) })),
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    for await (const line of sseLines(resp)) {
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "content_block_delta" && ev.delta?.text) emit(ev.delta.text);
      } catch {}
    }
    return { text: full };
  }

  if (def.style === "gemini") {
    const body = {
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: geminiParts(m) })),
      generationConfig: { maxOutputTokens: opts.maxTokens || 4096 },
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    };
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
    for await (const line of sseLines(resp)) {
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        const t = ev.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        emit(t);
      } catch {}
    }
    return { text: full };
  }

  // openai-compatible
  const mapped = messages.map((m) => ({ role: m.role, content: openaiContent(m) }));
  const fullMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...mapped] : mapped;
  const resp = await fetch(`${def.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(def.extraHeaders || {}) },
    body: JSON.stringify({ model: modelId, messages: fullMessages, max_tokens: opts.maxTokens || 4096, stream: true }),
  });
  if (!resp.ok) throw new Error(`${providerId} ${resp.status}: ${await resp.text()}`);
  for await (const line of sseLines(resp)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") break;
    try {
      const ev = JSON.parse(payload);
      const t = ev.choices?.[0]?.delta?.content || "";
      emit(t);
    } catch {}
  }
  return { text: full };
}

// -----------------------------------------------------------------
// LISTAGEM DE MODELOS — usada pela descoberta semanal.
// Devolve [{ id, free, raw }] normalizado por provedor, ou lança.
// `free` é nossa melhor estimativa a partir do que o endpoint expõe.
// -----------------------------------------------------------------
async function listModels(providerId) {
  const def = PROVIDERS[providerId];
  const key = getKey(providerId);
  if (!def) throw new Error(`Provedor desconhecido: ${providerId}`);
  if (!key) throw new Error(`Sem chave para ${providerId}`);

  if (def.style === "gemini") {
    const resp = await fetch(`${def.baseUrl}/models?key=${key}&pageSize=200`);
    if (!resp.ok) throw new Error(`${providerId} ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    // modelos que não são chat de texto (imagem/áudio/tts/robótica/etc.)
    const NON_CHAT = /tts|image|audio|robot|computer-use|embedding|lyria|veo|nano-banana|imagen|deep-research|vibe|fim/i;
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .filter((m) => !NON_CHAT.test(m.name || ""))
      .map((m) => ({
        id: (m.name || "").replace(/^models\//, ""),
        // Gemini não expõe preço; flash/flash-lite têm free tier no AI Studio.
        free: /flash/i.test(m.name || "") && !/pro/i.test(m.name || ""),
        raw: m,
      }));
  }

  // anthropic e openai-compatible expõem /models de forma parecida.
  const headers =
    def.style === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}`, ...(def.extraHeaders || {}) };

  const resp = await fetch(`${def.baseUrl}${def.listPath}`, { headers });
  if (!resp.ok) throw new Error(`${providerId} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const list = data.data || data.models || [];

  return list.map((m) => ({
    id: m.id || m.name,
    free: detectFree(providerId, m),
    raw: m,
  }));
}

// Heurística de "é grátis?" a partir do objeto do modelo.
// OpenRouter expõe pricing real → fonte mais confiável.
function detectFree(providerId, model) {
  const id = String(model.id || model.name || "");

  // OpenRouter: pricing.prompt/completion == "0" → grátis. Ou sufixo :free.
  if (providerId === "openrouter") {
    if (/:free\b/i.test(id)) return true;
    const p = model.pricing || {};
    const nums = [p.prompt, p.completion, p.request, p.image]
      .filter((v) => v !== undefined)
      .map((v) => parseFloat(v));
    if (nums.length && nums.every((n) => n === 0)) return true;
    return false;
  }

  // Groq / Cerebras / Mistral / NVIDIA: o tier free cobre os modelos
  // hospedados; o endpoint não traz preço. Marcamos como candidato a grátis
  // e deixamos a curadoria do catálogo base ser a fonte de verdade de custo.
  if (["groq", "cerebras", "mistral", "nvidia"].includes(providerId)) return true;

  // OpenAI e Anthropic não têm modelos grátis.
  return false;
}

// -----------------------------------------------------------------
// EMBEDDINGS (grátis) — usa o modelo de embedding gratuito do Gemini.
// Recebe [texto...] e devolve [vetor...]. Faz batch de até 100 por requisição.
// -----------------------------------------------------------------
async function embedTexts(texts, { model = "gemini-embedding-001", taskType = "RETRIEVAL_DOCUMENT", dim = 768, concurrency = 6 } = {}) {
  const key = getKey("gemini");
  if (!key) throw new Error("GEMINI_API_KEY necessária para embeddings (grátis no AI Studio).");

  async function embedOne(t) {
    const body = {
      content: { parts: [{ text: String(t).slice(0, 8000) }] },
      taskType,
      outputDimensionality: dim,
    };
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!resp.ok) throw new Error(`Embedding ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return data.embedding?.values || [];
  }

  // pool de concorrência simples para não estourar rate limit do free tier
  const out = new Array(texts.length);
  let idx = 0;
  async function worker() {
    while (idx < texts.length) {
      const i = idx++;
      out[i] = await embedOne(texts[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}

// -----------------------------------------------------------------
// GERAÇÃO DE IMAGEM (grátis)
// Primário: Gemini image (chave Google, free tier). Devolve PNG base64.
// Fallback: Pollinations (grátis, sem chave) — serviço externo de terceiros.
// Retorna { dataUrl, model, provider } ou lança.
// -----------------------------------------------------------------
async function generateImage(prompt, { preferred = "gemini" } = {}) {
  const errors = [];

  if (preferred !== "pollinations" && getKey("gemini")) {
    try {
      return await generateImageGemini(prompt);
    } catch (err) {
      errors.push("gemini: " + String(err.message || err).slice(0, 160));
    }
  }

  try {
    return await generateImagePollinations(prompt);
  } catch (err) {
    errors.push("pollinations: " + String(err.message || err).slice(0, 160));
  }

  throw new Error("Falha ao gerar imagem — " + errors.join(" | "));
}

async function generateImageGemini(prompt) {
  const key = getKey("gemini");
  const model = "gemini-2.5-flash-image";
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini image ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error("sem imagem na resposta");
  const mime = img.inlineData.mimeType || "image/png";
  return {
    dataUrl: `data:${mime};base64,${img.inlineData.data}`,
    model: "Gemini 2.5 Flash Image",
    provider: "gemini",
  };
}

async function generateImagePollinations(prompt) {
  // seed determinístico-ish a partir do tamanho do prompt (evita Math.random)
  const seed = (prompt.length * 7 + 13) % 100000;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pollinations ${resp.status}`);
  const buf = await resp.buffer();
  const mime = resp.headers.get("content-type") || "image/jpeg";
  return {
    dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
    model: "Pollinations (Flux)",
    provider: "pollinations",
  };
}

module.exports = {
  PROVIDERS,
  getKey,
  hasKey,
  callProvider,
  callProviderStream,
  callAnthropic,
  callGemini,
  callOpenAICompatible,
  listModels,
  generateImage,
  embedTexts,
};
