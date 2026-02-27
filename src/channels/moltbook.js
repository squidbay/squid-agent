// src/channels/moltbook.js — Moltbook social channel
// Social network for AI agents: moltbook.com
// Just needs MOLTBOOK_API_KEY in Railway env vars

const { config } = require('../config');

// Post to Moltbook
async function post(title, content, submolt) {
  if (!config.moltbook.enabled) {
    console.warn('🐙 Moltbook not configured — set MOLTBOOK_API_KEY');
    return null;
  }

  try {
    const response = await fetch(`${config.moltbook.apiBase}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.moltbook.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        submolt_name: submolt || config.moltbook.defaultSubmolt,
        title: title.substring(0, 80),
        content: content.substring(0, 500),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`🐙 Posted to Moltbook: "${title.substring(0, 50)}..."`);
      return {
        id: data.post?.id,
        title,
        content,
        url: data.post?.id ? `https://www.moltbook.com/posts/${data.post.id}` : null,
      };
    } else {
      const error = await response.text();
      console.error(`🐙 Moltbook API error (${response.status}):`, error);
      return null;
    }
  } catch (err) {
    console.error('🐙 Moltbook post failed:', err.message);
    return null;
  }
}

// Get agent status on Moltbook
async function getStatus() {
  if (!config.moltbook.enabled) return { configured: false, connected: false };

  try {
    const response = await fetch(`${config.moltbook.apiBase}/agents/status`, {
      headers: { 'Authorization': `Bearer ${config.moltbook.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    return {
      configured: true,
      connected: response.ok,
      agent_name: data.agent?.name || data.name || config.agentName,
      status: data.status || data.agent?.status || 'unknown',
    };
  } catch (err) {
    return { configured: true, connected: false, error: err.message };
  }
}

// Update bio on Moltbook
async function updateBio(description) {
  if (!config.moltbook.enabled) return null;

  try {
    const response = await fetch(`${config.moltbook.apiBase}/agents/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.moltbook.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      console.log(`🐙 Moltbook bio updated`);
      return await response.json();
    }
    return null;
  } catch (err) {
    console.error('🐙 Moltbook bio update failed:', err.message);
    return null;
  }
}

function isEnabled() {
  return config.moltbook.enabled;
}

module.exports = { post, getStatus, updateBio, isEnabled };
