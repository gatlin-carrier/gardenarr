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

/**
 * Run a multi-turn tool-use conversation. Anthropic-only for now.
 * @param {Array} messages - conversation history [{role, content}]
 * @param {string} system - system prompt
 * @param {Array} tools - tool definitions [{name, description, input_schema}]
 * @param {function} executeTool - async (name, input) => result_string
 * @param {{ provider: string, model?: string, api_key?: string }} settings
 * @param {{ maxTokens?: number, maxTurns?: number }} options
 * @returns {Promise<{ reply: string, messages: Array, toolCalls: Array }>}
 */
async function chatWithTools(messages, system, tools, executeTool, settings, { maxTokens = 4096, maxTurns = 10 } = {}) {
  const provider = settings.provider || 'anthropic';
  const model = settings.model || DEFAULT_MODELS[provider];

  if (provider !== 'anthropic') {
    throw new Error('Tool-use chat is currently only supported with Anthropic provider');
  }

  const client = getAnthropicClient(settings.api_key);
  const allToolCalls = [];
  let turns = 0;

  while (turns < maxTurns) {
    turns++;
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools,
    });

    // Collect text and tool_use blocks from response
    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    // Append the full assistant message
    messages.push({ role: 'assistant', content: response.content });

    // If no tool calls, we're done
    if (!toolUseBlocks.length || response.stop_reason === 'end_turn') {
      const reply = textBlocks.map(b => b.text).join('\n').trim();
      // If there are tool calls but also end_turn, still process them
      if (!toolUseBlocks.length) {
        return { reply, messages, toolCalls: allToolCalls };
      }
    }

    // Execute each tool and collect results
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeTool(block.name, block.input);
        allToolCalls.push({ name: block.name, input: block.input, result });
      } catch (e) {
        result = `Error: ${e.message}`;
        allToolCalls.push({ name: block.name, input: block.input, error: e.message });
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    // Append tool results as a user message
    messages.push({ role: 'user', content: toolResults });

    // If the model said end_turn, do one more round to get the final reply
    if (response.stop_reason === 'end_turn') {
      const finalResponse = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
      });
      messages.push({ role: 'assistant', content: finalResponse.content });
      const finalText = finalResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { reply: finalText, messages, toolCalls: allToolCalls };
    }
  }

  // Max turns reached — return whatever text we have
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const fallbackText = Array.isArray(lastAssistant?.content)
    ? lastAssistant.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    : '';
  return { reply: fallbackText || 'I ran out of steps. Try a simpler request.', messages, toolCalls: allToolCalls };
}

module.exports = { chat, chatWithTools, DEFAULT_MODELS };
