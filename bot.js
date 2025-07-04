/**
 * Base code by Ayokunle 
 * TELEGRAM: t.me/ayokunledavid 
 * WHATSAPP: wa.me/2349012834275
 * YOUTUBE: YouTube.com/GabimaruTech
 * GITHUB: github.com/Gabimaru-Dev 
*/
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@fizzxydev/baileys-pro');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = '8004413557:AAGYsRpm-PK8DL89Rc_dRyRpNFkXmwJDxMA';
const DEV_CHAT_ID = '7844032739';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const waSessions = new Map();
const userSendState = new Map(); // Tracks message flow per Telegram user

async function createWhatsAppSession(phone, telegramChat) {
  const pairCode = 'GABIMARU'; // Fixed pairing code
  const sessionId = `${phone}_${pairCode}`;
  const authDir = path.resolve(__dirname, 'sessions', sessionId);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      bot.sendMessage(DEV_CHAT_ID, `✅ WhatsApp ${phone} connected`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      bot.sendMessage(DEV_CHAT_ID, `⚠️ WhatsApp ${phone} disconnected (code ${code})`);
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => createWhatsAppSession(phone, telegramChat), 5000);
      }
    }
  });

  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode(phone, pairCode);
    bot.sendMessage(telegramChat, `🔑 Pairing code for ${phone}: ${code}`);
  }

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      const text = msg.message?.conversation;
      if (!text || msg.key.fromMe) continue;
      bot.sendMessage(telegramChat, `📩 [WA][${msg.key.remoteJid}]: ${text}`);
    }
  });

  waSessions.set(sessionId, { sock, telegramChat });
}

// /addwa <phone>
bot.onText(/\/addwa (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const phone = match[1];
  const sessionId = `${phone}_GABIMARU`;
  if (waSessions.has(sessionId)) {
    return bot.sendMessage(chatId, '🔁 This session already exists.');
  }
  createWhatsAppSession(phone, chatId);
  bot.sendMessage(chatId, `🚀 Starting session for WhatsApp ${phone}`);
});

// /list command
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const isDev = chatId.toString() === process.env.DEV_CHAT_ID;
  const userSessions = [];

  for (const [sessionId, sessionData] of waSessions.entries()) {
    if (isDev || sessionData.telegramChat === chatId) {
      const jid = `${sessionId.split('_')[0]}@s.whatsapp.net`;
      userSessions.push(jid);
    }
  }

  if (userSessions.length === 0) {
    return bot.sendMessage(chatId, '📭 No WhatsApp sessions found for you.');
  }

  const response = isDev
    ? `👑 *All Active WhatsApp Sessions:*\n\n${userSessions.map(j => `• \`${j}\``).join('\n')}`
    : `📱 *Your WhatsApp Sessions:*\n\n${userSessions.map(j => `• \`${j}\``).join('\n')}`;

  bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Message  sender functiom
async function xandro(session, targetJid) {
  const presetMessage = "Hello from NexusMaru! This is an automated message.";
  await session.sock.sendMessage(targetJid, { text: presetMessage });
}

// /sendwa <phone>
bot.onText(/\/sendwa (\\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const phone = match[1];
  const sessionId = `${phone}_GABIMARU`;
  const session = waSessions.get(sessionId);

  if (!session || session.telegramChat !== chatId) {
    return bot.sendMessage(chatId, '❌ You do not have access to this WhatsApp session.');
  }

  // Store intent awaiting target number only
  userSendState.set(userId, {
    step: 'awaiting_target_number',
    sessionId
  });

  bot.sendMessage(chatId, '📨 Send the *target WhatsApp number* only!', { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = userSendState.get(userId);

  // Ignore if no relevant state, no text, or command
  if (!state || !msg.text || msg.text.startsWith('/')) return;

  if (state.step === 'awaiting_target_number') {
    const rawNumber = msg.text.trim().replace(/\D/g, '');
    if (!rawNumber) {
      return bot.sendMessage(chatId, '⚠️ Please send a valid number.');
    }

    const targetJid = `${rawNumber}@s.whatsapp.net`;
    const session = waSessions.get(state.sessionId);

    if (!session) {
      bot.sendMessage(chatId, '⚠️ Your WhatsApp session is no longer active.');
      userSendState.delete(userId);
      return;
    }

    try {
      await xandro(session, targetJid);
      bot.sendMessage(chatId, `✅ Sent preset message to \`${targetJid}\`.`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Failed to send message: ${err.message}`);
    }

    userSendState.delete(userId); // clear flow
  }
});