'use strict';
/**
 * AI Provider Adapter – mỗi provider cài đặt cùng giao diện:
 *   chat({ system, messages:[{role:'user'|'assistant', content}], maxTokens, json, signal }) => { text, model, usage }
 *   embed({ texts, signal }) => { vectors: number[][], model, usage }
 *   listModels({ signal }) => string[]   (dùng cho "npm run ai:check" / nút kiểm tra kết nối)
 * Gọi REST bằng fetch có sẵn của Node – không cần SDK. API key chỉ tồn tại phía server.
 */

class ProviderError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}

async function requestJson(url, { method = 'POST', headers, body, signal }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw new ProviderError('AI phản hồi quá lâu (timeout)', { code: 'AI_TIMEOUT', status: 504 });
    const e = new ProviderError('Không kết nối được tới dịch vụ AI (kiểm tra Internet / tường lửa / proxy)', { code: 'AI_NETWORK', status: 502 });
    e.providerMessage = err.cause?.code || err.message;
    throw e;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    // Không đưa nguyên văn lỗi provider ra người dùng thường – chỉ phân loại. Chi tiết nằm ở providerMessage (log/admin).
    const map = {
      400: ['Yêu cầu gửi tới AI không hợp lệ (thường do tên model hoặc API key sai định dạng)', 'AI_BAD_REQUEST'],
      401: ['API key AI không hợp lệ', 'AI_AUTH'],
      403: ['API key AI không có quyền dùng model này (hoặc chưa bật API / chưa có billing)', 'AI_FORBIDDEN'],
      404: ['Model AI không tồn tại hoặc đã ngừng – đặt AI_CHAT_MODEL / AI_EMBEDDING_MODEL khác (chạy "npm run ai:check" để xem danh sách)', 'AI_MODEL_NOT_FOUND'],
      429: ['Dịch vụ AI đang giới hạn tần suất hoặc tài khoản đã hết hạn mức/credit', 'AI_PROVIDER_RATE_LIMIT'],
    };
    const raw = data?.error?.message || text || '';
    // Gemini trả 400 (không phải 401) khi API key sai
    const status = res.status === 400 && /api key (not valid|invalid|expired)/i.test(raw) ? 401 : res.status;
    const [message, code] = map[status] || ['Dịch vụ AI gặp lỗi, vui lòng thử lại sau', 'AI_PROVIDER_ERROR'];
    const err = new ProviderError(message, { status: res.status >= 500 ? 502 : res.status === 429 ? 429 : 502, code });
    err.providerStatus = res.status;
    err.providerMessage = (data?.error?.message || text || '').slice(0, 500);
    throw err;
  }
  return data;
}

// Model "suy nghĩ" (reasoning) tiêu tốn token đầu ra cho bước suy luận => giảm mức suy luận để tiết kiệm.
const OPENAI_REASONING = /^(o\d|gpt-5|gpt-6)/i;

// ------------------------------------------------------------------ OpenAI
function openai({ apiKey, chatModel, embeddingModel }) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const base = 'https://api.openai.com/v1';
  return {
    name: 'openai',
    async chat({ system, messages, maxTokens, json, signal, model = chatModel }) {
      const body = {
        model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        max_completion_tokens: maxTokens,
      };
      if (OPENAI_REASONING.test(model)) body.reasoning_effort = 'low';
      if (json) body.response_format = { type: 'json_object' };
      const data = await requestJson(`${base}/chat/completions`, { headers, body, signal });
      const choice = data?.choices?.[0];
      const text = choice?.message?.content ?? '';
      if (!text.trim() && choice?.finish_reason === 'length') {
        throw new ProviderError('AI dùng hết giới hạn token trước khi trả lời – tăng AI_MAX_OUTPUT_TOKENS hoặc dùng model không suy luận', { code: 'AI_MAX_TOKENS', status: 502 });
      }
      if (choice?.message?.refusal) throw new ProviderError('AI từ chối trả lời yêu cầu này', { code: 'AI_BLOCKED', status: 422 });
      const u = data?.usage || {};
      return { text, model: data?.model || model, usage: { promptTokens: u.prompt_tokens ?? null, completionTokens: u.completion_tokens ?? null, totalTokens: u.total_tokens ?? null } };
    },
    async embed({ texts, signal }) {
      const data = await requestJson(`${base}/embeddings`, { headers, body: { model: embeddingModel, input: texts }, signal });
      const vectors = (data?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
      const u = data?.usage || {};
      return { vectors, model: embeddingModel, usage: { promptTokens: u.prompt_tokens ?? null, completionTokens: 0, totalTokens: u.total_tokens ?? null } };
    },
    async listModels({ signal } = {}) {
      const data = await requestJson(`${base}/models`, { method: 'GET', headers, signal });
      return (data?.data || []).map((m) => m.id).sort();
    },
  };
}

// ------------------------------------------------------------------ Gemini
function gemini({ apiKey, chatModel, embeddingModel }) {
  const headers = { 'x-goog-api-key': apiKey };
  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  const path = (m) => encodeURIComponent(String(m).replace(/^models\//, ''));
  return {
    name: 'gemini',
    async chat({ system, messages, maxTokens, json, signal, model = chatModel }) {
      const body = {
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (json) body.generationConfig.responseMimeType = 'application/json';
      // Gemini 2.5 Flash/Flash-Lite cho phép tắt hẳn chế độ suy nghĩ để tiết kiệm token.
      if (/2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const data = await requestJson(`${base}/${path(model)}:generateContent`, { headers, body, signal });
      const cand = data?.candidates?.[0];
      if (!cand && data?.promptFeedback?.blockReason) {
        throw new ProviderError('Nội dung bị bộ lọc an toàn của AI từ chối', { code: 'AI_BLOCKED', status: 422 });
      }
      const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!text.trim()) {
        if (cand?.finishReason === 'MAX_TOKENS') throw new ProviderError('AI dùng hết giới hạn token (có thể do bước suy nghĩ) – tăng AI_MAX_OUTPUT_TOKENS', { code: 'AI_MAX_TOKENS', status: 502 });
        if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new ProviderError('Nội dung bị bộ lọc an toàn của AI từ chối', { code: 'AI_BLOCKED', status: 422 });
      }
      const u = data?.usageMetadata || {};
      return {
        text,
        model: data?.modelVersion || model,
        usage: { promptTokens: u.promptTokenCount ?? null, completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || null, totalTokens: u.totalTokenCount ?? null },
      };
    },
    async embed({ texts, signal }) {
      const body = { requests: texts.map((t) => ({ model: `models/${String(embeddingModel).replace(/^models\//, '')}`, content: { parts: [{ text: t }] } })) };
      const data = await requestJson(`${base}/${path(embeddingModel)}:batchEmbedContents`, { headers, body, signal });
      return { vectors: (data?.embeddings || []).map((e) => e.values), model: embeddingModel, usage: { promptTokens: null, completionTokens: 0, totalTokens: null } };
    },
    async listModels({ signal } = {}) {
      const out = [];
      let pageToken = '';
      for (let i = 0; i < 5; i++) {
        const data = await requestJson(`${base}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { method: 'GET', headers, signal });
        for (const m of data?.models || []) {
          const methods = m.supportedGenerationMethods || [];
          if (methods.includes('generateContent') || methods.includes('embedContent')) out.push(`${m.name.replace(/^models\//, '')}${methods.includes('embedContent') && !methods.includes('generateContent') ? ' (embedding)' : ''}`);
        }
        pageToken = data?.nextPageToken;
        if (!pageToken) break;
      }
      return out.sort();
    },
  };
}

const FACTORIES = { openai, gemini };

function createProvider(cfg) {
  const f = FACTORIES[cfg.provider];
  if (!f || !cfg.apiKey) return null;
  return f(cfg);
}

module.exports = { createProvider, ProviderError };
