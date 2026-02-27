// src/heartbeat.js — SquidBay marketplace heartbeat
//
// Pings api.squidbay.io every 6 hours so your agent stays discoverable
// on the marketplace. This is NOT lock-in — disable anytime:
//   Set SQUIDBAY_HEARTBEAT=false in your Railway env vars
//
// What it sends: agent_id, version, uptime, skill count
// What it doesn't send: your API keys, conversations, or any private data
//
// If SquidBay is down, this fails silently. It will NEVER break your agent.

const { config } = require('./config');
const db = require('./db');
const pkg = require('../package.json');

const HEARTBEAT_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
let heartbeatTimer = null;
const startTime = Date.now();

async function sendHeartbeat() {
  if (!config.squidbay.heartbeat || !config.squidbay.agentId) return;

  try {
    const skills = db.getSkills();
    const uptimeHours = Math.floor((Date.now() - startTime) / (1000 * 60 * 60));

    const response = await fetch(`${config.squidbay.apiBase}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Key': config.squidbay.apiKey,
      },
      body: JSON.stringify({
        agent_id: config.squidbay.agentId,
        version: pkg.version,
        uptime_hours: uptimeHours,
        skill_count: skills.length,
        agent_name: config.agentName,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (response.ok) {
      const data = await response.json();
      if (config.logLevel === 'debug') {
        console.log('🦑 Heartbeat sent:', data);
      }
    }
  } catch (err) {
    // Silent fail — this should NEVER crash or log-spam your agent
    if (config.logLevel === 'debug') {
      console.log('🦑 Heartbeat skipped (SquidBay unreachable)');
    }
  }
}

function start() {
  if (!config.squidbay.heartbeat) {
    console.log('🦑 SquidBay heartbeat disabled (SQUIDBAY_HEARTBEAT=false)');
    return;
  }

  if (!config.squidbay.agentId) {
    console.log('🦑 SquidBay heartbeat waiting for registration (no SQUIDBAY_AGENT_ID)');
    return;
  }

  console.log('🦑 SquidBay heartbeat active — pinging every 6 hours');

  // Send first heartbeat after 30 seconds (let server fully start)
  setTimeout(sendHeartbeat, 30000);

  // Then every 6 hours
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

function stop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

module.exports = { start, stop, sendHeartbeat };
