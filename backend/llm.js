// LLM provider abstraction. Accepts a settings object so the caller controls
// which provider/model/key is used — nothing here reads from the DB or env.

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-1.5-pro',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
  custom: '',
};

// Cache clients so connections are reused across calls
const _clientCache = {};

function getAnthropicClient(apiKey) {
  const cacheKey = `anthropic:${apiKey}`;
  if (!_clientCache[cacheKey]) {
    const Anthropic = require('@anthropic-ai/sdk');
    _clientCache[cacheKey] = new Anthropic({
      apiKey,
      timeout: 5 * 60 * 1000,   // 5 minute timeout per request
      maxRetries: 3,             // SDK-level retries for 429/500/503
    });
  }
  return _clientCache[cacheKey];
}

function getOpenAIClient(apiKey, baseURL) {
  const cacheKey = `openai:${apiKey}:${baseURL || 'default'}`;
  if (!_clientCache[cacheKey]) {
    const OpenAI = require('openai');
    const opts = { apiKey, timeout: 5 * 60 * 1000, maxRetries: 3 };
    if (baseURL) opts.baseURL = baseURL;
    _clientCache[cacheKey] = new OpenAI(opts);
  }
  return _clientCache[cacheKey];
}

/**
 * Send a single user message and return the response text.
 * @param {string} userMessage
 * @param {{ provider: string, model?: string, api_key?: string, ollama_base_url?: string }} settings
 * @param {{ maxTokens?: number }} options
 * @returns {Promise<string>}
 */
async function chat(userMessage, settings, { maxTokens = 4096 } = {}) {
  const provider = settings.provider || 'anthropic';
  const model = settings.model || DEFAULT_MODELS[provider];

  switch (provider) {
    case 'anthropic': {
      const client = getAnthropicClient(settings.api_key);
      const msg = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }],
      });
      return msg.content[0].text;
    }

    case 'openai': {
      const client = getOpenAIClient(settings.api_key);
      const res = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }],
      });
      return res.choices[0].message.content;
    }

    case 'google': {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(settings.api_key);
      const gmodel = genAI.getGenerativeModel({ model });
      const result = await gmodel.generateContent(userMessage);
      return result.response.text();
    }

    case 'ollama':
    case 'lmstudio':
    case 'custom': {
      // All three expose an OpenAI-compatible API
      const defaultUrls = {
        ollama: 'http://localhost:11434/v1',
        lmstudio: 'http://localhost:1234/v1',
        custom: 'http://localhost:8080/v1',
      };
      const baseURL = settings.ollama_base_url || defaultUrls[provider];
      const client = getOpenAIClient(settings.api_key || provider, baseURL);
      const res = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }],
      });
      return res.choices[0].message.content;
    }

    default:
      throw new Error(`Unknown LLM provider: "${provider}". Valid options: anthropic, openai, google, ollama, lmstudio, custom`);
  }
}

module.exports = { chat, DEFAULT_MODELS };
