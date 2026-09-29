const { getAiClient, stripInternalIds } = require('../../ai/privacyGateway');
const config = require('../../config');
const { recordAiUsage, FEATURES } = require('../../services/aiUsageService');

// Translates the generic {systemPrompt, messages, tools} contract to and
// from the Anthropic Messages/tool-use API. This file is the ONLY place
// that knows Anthropic's request/response shape — chatOrchestrator.js and
// tools.js are written entirely against the generic contract below, so
// adding a second provider means writing one more file like this one, not
// touching orchestration, retrieval, or safety logic.
//
// Generic message shape (provider-agnostic):
//   { role: 'user', content: string }
//   { role: 'assistant', text: string|null, toolCalls: [{id, name, input}] }
//   { role: 'tool_result', toolCallId, name, result: <JSON-serializable> }

function toAnthropicMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      const content = [];
      if (message.text) content.push({ type: 'text', text: message.text });
      for (const call of message.toolCalls || []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      return { role: 'assistant', content };
    }
    if (message.role === 'tool_result') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: JSON.stringify(stripInternalIds(message.result)) }],
      };
    }
    throw new Error(`Unknown generic message role "${message.role}"`);
  });
}

async function converse({ systemPrompt, messages, tools, userId }) {
  const client = await getAiClient({ subjectUserId: userId, purpose: 'chat' });

  const anthropicTools = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  const response = await client.messages.create(
    {
      model: config.anthropicModel,
      max_tokens: 1024,
      system: systemPrompt,
      tools: anthropicTools,
      messages: toAnthropicMessages(messages),
    },
    { timeout: 30_000 }
  );
  recordAiUsage(FEATURES.CHAT, response);

  const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
  const usage = { tokensIn: response.usage?.input_tokens ?? null, tokensOut: response.usage?.output_tokens ?? null };

  if (toolUseBlocks.length > 0) {
    const textBlock = response.content.find((block) => block.type === 'text');
    return {
      type: 'tool_calls',
      text: textBlock ? textBlock.text : null,
      calls: toolUseBlocks.map((block) => ({ id: block.id, name: block.name, input: block.input })),
      usage,
    };
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  return { type: 'text', text: textBlock ? textBlock.text : '', usage };
}

module.exports = { name: 'claude', converse };
