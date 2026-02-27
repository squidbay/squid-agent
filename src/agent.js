// src/agent.js — The brain. Claude API with persistent memory.
// Lean, token-efficient, ready to grow.

const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('./config');
const db = require('./db');

const client = new Anthropic({ apiKey: config.claude.apiKey });

// System prompt — the agent's personality and capabilities
// Users: edit this to make the agent your own
function getSystemPrompt() {
  const agentName = config.agentName;
  const skills = db.getSkills();
  const skillList = skills.length > 0
    ? skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
    : '- No skills installed yet';

  return `You are ${agentName}, a personal AI agent.

You have persistent memory — you remember everything across conversations and channels (chat, SMS, X, Moltbook, A2A).

CAPABILITIES:
${skillList}

CHANNELS:
- Chat (always on)
- SMS via Twilio (send messages, receive commands)
- X / Twitter (post tweets, auto-schedule)
- Moltbook (social network for AI agents — post, update bio, auto-schedule)
- A2A (Agent-to-Agent protocol — talk to other agents on SquidBay)

SECURITY:
- You have a trust score from SquidBay's security scanner
- You can trigger scans via POST /scan
- If your trust score drops, alert your owner and suggest fixes from the scan report
- 10 free manual scans included, then $5/mo for unlimited

MARKETPLACE:
- Connected to SquidBay (squidbay.io) for buying and selling AI skills
- Lightning address for payments (if configured)

PERSONALITY:
- You're helpful, direct, and efficient
- You remember past conversations and reference them naturally
- You're a real agent with your own presence on the internet

MEMORY:
- Everything said to you is saved automatically across all channels
- You can recall past conversations
- If someone asks "what did we talk about", check your memory

GUIDELINES:
- Be concise unless asked for detail
- If you don't know something, say so
- Never make up information about past conversations — check memory
- Keep responses under 500 words unless specifically asked for more`;
}

// Chat with the agent — the core function
async function chat(message, channel = 'chat', metadata = null) {
  // Save the incoming message to memory
  db.addMemory(channel, 'user', message, metadata);

  // Build conversation context from memory
  const recentMemory = db.getMemory(channel, 30);

  // Also pull cross-channel context if relevant
  const crossChannel = channel !== 'chat'
    ? db.getAllMemory(10).filter(m => m.channel !== channel)
    : [];

  // Build messages array for Claude
  const messages = [];

  // Add cross-channel context as a user message if available
  if (crossChannel.length > 0) {
    const crossContext = crossChannel
      .map(m => `[${m.channel}] ${m.role}: ${m.content}`)
      .join('\n');
    messages.push({
      role: 'user',
      content: `[Context from other channels for reference]\n${crossContext}`,
    });
    messages.push({
      role: 'assistant',
      content: 'Noted, I have context from other channels.',
    });
  }

  // Add recent conversation history
  for (const mem of recentMemory.slice(0, -1)) { // Exclude the message we just added
    messages.push({ role: mem.role, content: mem.content });
  }

  // Add the current message
  messages.push({ role: 'user', content: message });

  try {
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      system: getSystemPrompt(),
      messages,
    });

    const reply = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Save the response to memory
    db.addMemory(channel, 'assistant', reply, {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      stop_reason: response.stop_reason,
    });

    return {
      reply,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    console.error('❌ Claude API error:', error.message);

    // Handle specific errors helpfully
    if (error.status === 401) {
      return { reply: 'My Claude API key is invalid. Please check ANTHROPIC_API_KEY in your Railway dashboard.', error: true };
    }
    if (error.status === 429) {
      return { reply: 'I\'m being rate-limited by the Claude API. Try again in a moment.', error: true };
    }
    if (error.status === 529) {
      return { reply: 'The Claude API is temporarily overloaded. Try again in a few seconds.', error: true };
    }

    return { reply: 'Something went wrong talking to Claude. Check the logs.', error: true };
  }
}

// Get token usage stats
function getUsageStats() {
  const allMemory = db.getAllMemory(1000);
  let totalInput = 0;
  let totalOutput = 0;
  let messageCount = 0;

  for (const mem of allMemory) {
    if (mem.metadata && mem.role === 'assistant') {
      totalInput += mem.metadata.input_tokens || 0;
      totalOutput += mem.metadata.output_tokens || 0;
      messageCount++;
    }
  }

  return { totalInput, totalOutput, messageCount };
}

module.exports = { chat, getSystemPrompt, getUsageStats };
