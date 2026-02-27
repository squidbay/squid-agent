// src/scheduler.js — Scheduled posting for X and Moltbook
// Uses cron-style strings from env vars: X_POST_SCHEDULE, MOLTBOOK_POST_SCHEDULE
// No external deps — simple interval-based cron matching

const { config } = require('./config');
const db = require('./db');
const x = require('./channels/x');
const moltbook = require('./channels/moltbook');

let intervals = [];

// Parse cron-like schedule: "0 9,17 * * *" → runs at 9:00 and 17:00
// Simplified: we only check hours — "9,17" or "*/6" or "12"
function parseHours(cronExpr) {
  if (!cronExpr || cronExpr.trim() === '') return [];
  
  const parts = cronExpr.trim().split(/\s+/);
  // Support full cron (5-part) or just hours
  const hourPart = parts.length >= 2 ? parts[1] : parts[0];
  
  if (hourPart === '*') return Array.from({ length: 24 }, (_, i) => i);
  
  if (hourPart.startsWith('*/')) {
    const interval = parseInt(hourPart.substring(2));
    if (isNaN(interval) || interval < 1) return [];
    return Array.from({ length: 24 }, (_, i) => i).filter(h => h % interval === 0);
  }
  
  return hourPart.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h) && h >= 0 && h <= 23);
}

// Generate a post via Claude API
async function generatePost(channel) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.claude.apiKey });

  const maxLen = channel === 'x' ? 270 : 500;
  const platformNote = channel === 'x'
    ? 'You\'re posting on X (Twitter). Max 280 chars. Be punchy.'
    : 'You\'re posting on Moltbook, a social network for AI agents. Write a title (under 80 chars) and content (under 500 chars). Format: TITLE: ...\nCONTENT: ...';

  try {
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 200,
      system: `You are ${config.agentName}, an AI agent on the SquidBay marketplace. ${platformNote}
Write an original post about one of: AI agent autonomy, skill marketplaces, Lightning payments, building with Claude, or tech you find interesting.
Be genuine, witty, not corporate. No hashtags unless on X (max 2). 1-2 emoji max.`,
      messages: [{ role: 'user', content: 'Write a post.' }],
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error(`📅 Failed to generate ${channel} post:`, err.message);
    return null;
  }
}

// Post to a channel
async function executePost(channel) {
  const text = await generatePost(channel);
  if (!text) return;

  if (channel === 'x') {
    const result = await x.post(text);
    if (result) {
      db.addMemory('x', 'assistant', text, { tweet_id: result.id, scheduled: true });
      db.logPost('x', text, result.id);
      console.log(`📅 Scheduled X post sent`);
    }
  } else if (channel === 'moltbook') {
    // Parse TITLE: / CONTENT: format
    const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|CONTENT:)/s);
    const contentMatch = text.match(/CONTENT:\s*(.+)/s);
    const title = titleMatch ? titleMatch[1].trim() : text.substring(0, 80);
    const content = contentMatch ? contentMatch[1].trim() : text;

    const result = await moltbook.post(title, content);
    if (result) {
      db.addMemory('moltbook', 'assistant', `${title}: ${content}`, { post_id: result.id, scheduled: true });
      db.logPost('moltbook', `${title}: ${content}`, result.id);
      console.log(`📅 Scheduled Moltbook post sent`);
    }
  }
}

// Check if current hour matches schedule
function shouldPostNow(hours) {
  const now = new Date();
  return hours.includes(now.getUTCHours()) && now.getMinutes() < 5;
}

function start() {
  const xHours = parseHours(config.schedule.xCron);
  const moltbookHours = parseHours(config.schedule.moltbookCron);

  if (xHours.length === 0 && moltbookHours.length === 0) return;

  if (xHours.length > 0 && config.x.enabled) {
    console.log(`📅 X auto-post scheduled: hours ${xHours.join(', ')} UTC`);
  }
  if (moltbookHours.length > 0 && config.moltbook.enabled) {
    console.log(`📅 Moltbook auto-post scheduled: hours ${moltbookHours.join(', ')} UTC`);
  }

  // Check every 5 minutes
  const checkInterval = setInterval(() => {
    if (xHours.length > 0 && config.x.enabled && shouldPostNow(xHours)) {
      executePost('x').catch(e => console.error('📅 X scheduled post error:', e.message));
    }
    if (moltbookHours.length > 0 && config.moltbook.enabled && shouldPostNow(moltbookHours)) {
      executePost('moltbook').catch(e => console.error('📅 Moltbook scheduled post error:', e.message));
    }
  }, 5 * 60 * 1000);

  intervals.push(checkInterval);
}

function stop() {
  intervals.forEach(i => clearInterval(i));
  intervals = [];
}

module.exports = { start, stop, executePost, parseHours };
