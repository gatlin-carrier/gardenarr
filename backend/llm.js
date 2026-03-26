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
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: settings.api_key });
      const msg = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }],
      });
      return msg.content[0].text;
    }

    case 'openai': {
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: settings.api_key });
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
      const OpenAI = require('openai');
      const client = new OpenAI({
        apiKey: settings.api_key || provider,
        baseURL: settings.ollama_base_url || defaultUrls[provider],
      });
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
