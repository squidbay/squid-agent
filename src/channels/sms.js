// src/channels/sms.js — Twilio SMS channel
// Send texts to the agent owner + receive SMS as a chat channel
// Free trial: twilio.com/try-twilio (~$15 credit, no card needed)

const { config } = require('../config');
let twilioClient = null;

function init() {
  if (!config.twilio.enabled) return false;

  try {
    const twilio = require('twilio');
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    console.log('📱 Twilio SMS channel ready');
    return true;
  } catch (err) {
    console.warn('📱 Twilio init failed:', err.message);
    return false;
  }
}

// Send an SMS to the agent owner
async function notifyOwner(message) {
  if (!twilioClient || !config.twilio.ownerPhone) return null;

  try {
    const result = await twilioClient.messages.create({
      body: `[${config.agentName}] ${message}`,
      from: config.twilio.phoneNumber,
      to: config.twilio.ownerPhone,
    });
    return { sid: result.sid, status: result.status };
  } catch (err) {
    console.error('📱 SMS send failed:', err.message);
    return null;
  }
}

// Send an SMS to any number (for agent-to-human messaging)
async function sendSMS(to, message) {
  if (!twilioClient) return null;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: config.twilio.phoneNumber,
      to,
    });
    return { sid: result.sid, status: result.status };
  } catch (err) {
    console.error('📱 SMS send failed:', err.message);
    return null;
  }
}

// Express route handler for incoming SMS webhook
// Set your Twilio webhook URL to: https://your-railway-url.up.railway.app/sms/incoming
function incomingHandler(agent) {
  return async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;

    if (!body) {
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    console.log(`📱 SMS from ${from}: ${body}`);

    // Chat with the agent (SMS channel shares memory with all channels)
    const result = await agent.chat(body, 'sms', { from });

    // Reply via TwiML
    res.type('text/xml').send(
      `<Response><Message>${escapeXml(result.reply)}</Message></Response>`
    );
  };
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { init, notifyOwner, sendSMS, incomingHandler };
