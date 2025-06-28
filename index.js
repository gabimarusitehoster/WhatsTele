const { makeWASocket, getContentType, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, DisconnectReason, generateWAMessageFromContent } = require("@fizzxydev/baileys-pro");
const TelegramBot = require('node-telegram-bot-api');
const NodeCache = require('node-cache');
const pino = require('pino');
const axios = require('axios');
const path = require('path');
const util = require('util');
const chalk = require('chalk');
const { exec } = require('child_process');
const fs = require('fs');
const speed = require("performance-now")
const moment = require("moment-timezone");
const crypto = require('crypto')


const startTime = Date.now();
const settings = require("./config.json")
const BOT_TOKEN = settings.BOT_TOKEN;
let OWNER_ID = settings.OWNER_ID
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pairingCodes = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const requestLimits = new NodeCache({ stdTTL: 120, checkperiod: 60 });
let connectedUsers = {};
const developer = '2349052729951@s.whatsapp.net';
const connectedUsersFilePath = path.join(__dirname, 'connectedUsers.json');
const { smsg } = require("./lib/myfunc")

const formatTime = (seconds) => {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const dDisplay = d > 0 ? `${d} ${d === 1 ? 'day, ' : 'days, '}` : '';
  const hDisplay = h > 0 ? `${h} ${h === 1 ? 'hour, ' : 'hours, '}` : '';
  const mDisplay = m > 0 ? `${m} ${m === 1 ? 'minute, ' : 'minutes, '}` : '';
  const sDisplay = s > 0 ? `${s} ${s === 1 ? 'second' : 'seconds'}` : '';
  return `${dDisplay}${hDisplay}${mDisplay}${sDisplay}`;
};


// Load connected users from the JSON file
function loadConnectedUsers() {
    if (fs.existsSync(connectedUsersFilePath)) {
        const data = fs.readFileSync(connectedUsersFilePath);
        connectedUsers = JSON.parse(data);
    }
}

// Save connected users to the JSON file
function saveConnectedUsers() {
    fs.writeFileSync(connectedUsersFilePath, JSON.stringify(connectedUsers, null, 2));
}

let isFirstLog = true;

async function startWhatsAppBot(phoneNumber, telegramChatId = null) {
    const sessionPath = path.join(__dirname, 'tmp', `session_${phoneNumber}`);

    if (!fs.existsSync(sessionPath)) {
        console.log(`Session not found for ${phoneNumber}.`);
        return;
    }

    let { version, isLatest } = await fetchLatestBaileysVersion();
    if (isFirstLog) {
        console.log(`Using Baileys version: ${version} (Latest: ${isLatest})`);
        isFirstLog = false;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const msgRetryCounterCache = new NodeCache();
    const conn = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.windows('Firefox'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined,
    });

    if (conn.authState.creds.registered) {
        await saveCreds();
        console.log(`Reloaded Creds For ${phoneNumber}!`);
    } else {

        if (telegramChatId) {
            setTimeout(async () => {
                const custom = "GABIMARU";
                let code = await conn.requestPairingCode(phoneNumber, custom);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                pairingCodes.set(code, { count: 0, phoneNumber });
                const pairText = `
PAIRING CODE -> \`${code}\`

🔗 **Instructions:**
1. 🧭 Open *WhatsApp* on your phone.
2. 📲 Tap the **three dots** (menu) in the top right corner.
3. 💻 Select **Linked Devices**.
4. ➕ Tap on **Link a Device**.
5. 🔤 You'll see a prompt to scan a QR — instead, *tap the "Link with phone number instead"* option.
7. 🧩 Enter the pairing code you received: **${code}**
8. ✅ Done! Your WhatsApp is now linked to the bot.

If you need a new code, \`/delpair <number>\` then request one again!

_— Powered by Gabimaru Bot 🐉_
`;
                bot.sendMessage(telegramChatId, pairText, { parse_mode: 'Markdown' });
                console.log(`Use \`${code}\` to link your WhatsApp to the WhatsApp bot.`);
            }, 3000);
        }
    }
    conn.public = true
    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            await saveCreds();
            console.log(`Credentials saved successfully for ${phoneNumber}!`);

            if (telegramChatId) {
                if (!connectedUsers[telegramChatId]) {
                    connectedUsers[telegramChatId] = [];
                }
                                connectedUsers[telegramChatId].push({ phoneNumber, connectedAt: startTime });
                saveConnectedUsers();
                bot.sendMessage(telegramChatId, `Connection to ${phoneNumber} has been secured. ✅`)
		console.log(`
Connection to ${phoneNumber} has been secured. ✅`);
            }

            try {
                await conn.sendMessage(developer, { text: `Connection to ${phoneNumber} has been secured. ✅` });
            } catch (error) {
                console.error('Error sending message to admin:', error);
            }
        } else if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                console.log(`Session closed for ${phoneNumber}. Attempting to restart...`);
                startWhatsAppBot(phoneNumber, telegramChatId);
            }
        }
    });

    conn.ev.on('creds.update', saveCreds);

conn.ev.on('messages.upsert', async ({ messages, type }) => {
  try {
    if (type !== 'notify' || !messages?.length) return;

    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const fromMe = msg.key.fromMe;
    if (!conn.public && !fromMe) return;

    msg.message = msg.message?.ephemeralMessage?.message || msg.message;
    const m = smsg(JSON.parse(JSON.stringify(msg)), conn);
    const chat = msg.key.remoteJid;
    const isGroup = chat.endsWith('@g.us');
    const user = m.sender;
    const pushname = m.pushName || 'Unknown';

    // Ensure commands work in group chats
    const text = (m.text || '').trim();
    const prefix = settings.prefix || '.';
    if (!text.startsWith(prefix)) return;
    const [cmd, ...args] = text.slice(prefix.length).split(/\s+/);
    const command = cmd.toLowerCase();
    const q = args.join(' ');

    // Load metadata and permissions
    const botNum = conn.user.id.split(':')[0] + '@s.whatsapp.net';
    const ownerList = JSON.parse(fs.readFileSync('./developers.json'));
    const isCreator = [botNum, ...ownerList.map(n => n.replace(/\D/g, '') + '@s.whatsapp.net')].includes(user);

    let isAdmin = false, isBotAdmin = false;
    if (isGroup) {
      const g = await conn.groupMetadata(chat).catch(() => ({}));
      const admins = g.participants?.filter(p => p.admin).map(p => p.id) || [];
      isAdmin = admins.includes(user);
      isBotAdmin = admins.includes(botNum);
    }

    // Logging
    console.log(`📥 [${isGroup ? 'GROUP' : 'DM'}] ${pushname} (${user.split('@')[0]}):`, command, args);

    const send = (text) => conn.sendMessage(chat, { text });
    const richReply = text => conn.sendMessage(chat, {
      text,
      contextInfo: {
        externalAdReply: {
          title: 'Viper Bot',
          body: pushname,
          thumbnailUrl: 'https://files.catbox.moe/57maks.jpg',
        }
      }
    });

    if (isGroup && isBotAdmin) {
      switch (command) {
        case 'kick':
          if (!isAdmin && !isCreator) return send('❌ Only an admin can kick!');
          if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
            const targets = msg.message.extendedTextMessage.contextInfo.mentionedJid;
            await conn.groupParticipantsUpdate(chat, targets, 'remove');
            return send(`✅ Removed: ${targets.map(t => t.split('@')[0]).join(', ')}`);
          }
          return send('❌ Please mention someone to kick.');
        case 'promote':
        case 'demote':
          if (!isAdmin && !isCreator) return send('❌ Admins only.');
          if (!isBotAdmin) return send('❌ I need admin permission to do that.');
          if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
            const target = msg.message.extendedTextMessage.contextInfo.mentionedJid;
            const action = command === 'promote' ? 'promote' : 'demote';
            await conn.groupParticipantsUpdate(chat, target, action);
            return send(`✅ ${action === 'promote' ? 'Promoted' : 'Demoted'}: ${target}`);
          }
          return send('❌ Please mention someone to promote/demote.');
      }
    }

    const settingKey = `_${chat}_settings.json`;
    let gset = fs.existsSync(settingKey) ? JSON.parse(fs.readFileSync(settingKey)) : {
      welcome: true, goodbye: true, link: true
    };
    const toggle = (k, val) => {
      gset[k] = val;
      fs.writeFileSync(settingKey, JSON.stringify(gset));
    };

    switch (command) {
      case 'welcome':
      case 'bye':
      case 'link':
        if (!isAdmin && !isCreator) return send('❌ Admins only.');
        if (!['on','off'].includes(args[0])) return send('Usage: .welcome on/off');
        toggle(command === 'welcome' ? 'welcome' : command === 'bye' ? 'goodbye' : 'link', args[0] === 'on');
        return send(`✅ ${command.charAt(0).toUpperCase()+command.slice(1)} turned ${args[0]}`);
    }

    switch (command) {
      case 'ping': return send(`🏓 Pong!`);
      case 'menu': return richReply(`📜 Commands:\n• .ping\n• .kick @user\n• .promote @user\n• .welcome on/off\n• .bye on/off\n• .link on/off`);
      case 'link':
        if (!isGroup) return send('❌ Only groups have links.');
        if (!gset.link) return send('❌ Group link feature disabled.');
        const code = await conn.groupInviteCode(chat);
        return send(`🔗 https://chat.whatsapp.com/${code}`);
    }
    if (isCreator) {
      switch (command) {
        case 'broadcast':
          // broadcast to all chats
          const allChats = Object.keys(conn.chats);
          for (let c of allChats) conn.sendMessage(c, { text: q });
          return send('✅ Broadcast done.');
      }
    }

  } catch (e) {
    console.error('❌ Error in handler:', e);
  }
});

conn.ev.on('group-participants.update', async ({ id, participants, action }) => {
  const isGroup = id.endsWith('@g.us');
  if (!isGroup) return;

  const settingKey = `_${id}_settings.json`;
  if (!fs.existsSync(settingKey)) return;
  const gset = JSON.parse(fs.readFileSync(settingKey));

  for (const p of participants) {
    if (action === 'add' && gset.welcome) {
      const name = (await conn.onWhatsApp(p)).find(u=>u.jid===p)?.notify || p.split('@')[0];
      await conn.sendMessage(id, { text: `👋 Welcome @${name}!`, contextInfo: { mentionedJid: [p] } });
    }
    if (action === 'remove' && gset.goodbye) {
      await conn.sendMessage(id, { text: `😢 @${p.split('@')[0]} has left the group.`, contextInfo: { mentionedJid: [p] } });
    }
  }
});
}
const CHANNEL_USERNAME = '@gabimarutechchannel';
async function userFollowsChannel(userId) {
    try {
        const chatMember = bot.getChatMember(CHANNEL_USERNAME, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (err) {
        console.error('Error checking channel membership:', err);
        return false;
    }
}
// Handle /connect command
bot.onText(/\/pair (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const phoneNumber = match[1];
    const userId = msg.from.id;
    const follows = userFollowsChannel(userId);
    if (!follows) {
        return bot.sendMessage(chatId, `Please follow ${CHANNEL_USERNAME} before using this command.`);
    }
    const sessionPath = path.join(__dirname, 'tmp', `session_${phoneNumber}`);

    // Check if the session directory exists
    if (!fs.existsSync(sessionPath)) {
        // If the session does not exist, create the directory
        fs.mkdirSync(sessionPath, { recursive: true });
        console.log(`Session directory created for ${phoneNumber}.`);
        bot.sendMessage(chatId, `Session directory created for ${phoneNumber}.`);

        // Generate and send pairing code
        startWhatsAppBot(phoneNumber, chatId).catch(err => {
            console.log('Error:', err);
            bot.sendMessage(chatId, 'An error occurred while connecting.');
        });
    } else {
        // If the session already exists, check if the user is already connected
        const isAlreadyConnected = connectedUsers[chatId] && connectedUsers[chatId].some(user => user.phoneNumber === phoneNumber);
        if (isAlreadyConnected) {
            bot.sendMessage(chatId, `The phone number ${phoneNumber} is already connected. Please use /delsession to remove it before connecting again.`);
            return;
        }

        // Proceed with the connection if the session exists
        bot.sendMessage(chatId, `The session for ${phoneNumber} already exists. You can use /delsession to remove it or connect again.`);
    }
});


// Handle /delete command
bot.onText(/\/delpair (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const ownerId = msg.from.id.toString();
    const phoneNumber = match[1];
    const follows = userFollowsChannel(userId);
    if (!follows) {
        return bot.sendMessage(chatId, `Please follow ${CHANNEL_USERNAME} before using this command.`);
    }
    const sessionPath = path.join(__dirname, 'tmp', `session_${phoneNumber}`);
    /*
    if (ownerId !== OWNER_ID) {
        return bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
    }
    */
    // Check if the session directory exists
    if (fs.existsSync(sessionPath)) {
           fs.rmSync(sessionPath, { recursive: true, force: true });
            bot.sendMessage(chatId, `Session for ${phoneNumber} has been deleted. You can now request a new pairing code.`);
            connectedUsers[chatId] = connectedUsers[chatId].filter(user => user.phoneNumber !== phoneNumber); // Remove the association after deletion
            saveConnectedUsers(); // Save updated connected users
    } else {
        bot.sendMessage(chatId, `No session found for ${phoneNumber}. It may have already been deleted.`);
    }
});

// Handle /menu command
bot.onText(/\/menu|\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const follows = userFollowsChannel(userId);
    if (!follows) {
        return bot.sendMessage(chatId, `Please follow ${CHANNEL_USERNAME} before using this command.`);
    }
    const options = {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          {
            text: "WhatsApp",
            url: "https://wa.me/6283128820826"
          }
        ],
        [
          {
            text: "Telegram Channel",
            url: "https://t.me/gabimarutechchannel"
          }
        ]
      ]
    })
  };

  const imageUrl = 'https://b.top4top.io/p_3360xqf1y0.jpg';

  const caption = `
Hello ${msg.from.first_name || "there"}
Welcome To The Telegram Bot Interface
/pair <phone number>
/delpair <phone number>

Creator -> ayokunledavid.t.me`;

  bot.sendPhoto(chatId, imageUrl, {
    caption: caption,
    reply_markup: options.reply_markup
  })
  .catch(error => {
    console.error("Error sending photo:", error);
    bot.sendMessage(chatId, "Sorry, I couldn't send the image.  Please try again later.");
  });
});

bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const connectedUser  = connectedUsers[chatId];
    const follows = userFollowsChannel(userId);
    if (!follows) {
        return bot.sendMessage(chatId, `Please follow ${CHANNEL_USERNAME} before using this command.`);
    }
    if (connectedUser  && connectedUser .length > 0) {
        let statusText = `Bot Status:\n- Connected Numbers:\n`;
        connectedUser .forEach(user => {
            const uptime = Math.floor((Date.now() - user.connectedAt) / 1000); // Runtime in seconds
            statusText += `${user.phoneNumber} (Uptime: ${uptime} seconds)\n`;
        });
        bot.sendMessage(chatId, statusText);
    } else {
        bot.sendMessage(chatId, `You have no registered numbers.`);
    }
});

// Function to load all session files
async function loadAllSessions() {
    const sessionsDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir);
    }

    const sessionFiles = fs.readdirSync(sessionsDir);
    for (const file of sessionFiles) {
        const phoneNumber = file.replace('session_', '');
        await startWhatsAppBot(phoneNumber);
    }
}

// Ensure all sessions are loaded on startup
loadConnectedUsers(); // Load Connected users from the JSON file
loadAllSessions().catch(err => {
    console.log('Error loading sessions:', err);
});

// Start the bot
console.log('Telegram bot is running...');


let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(`Update ${__filename}`)
    delete require.cache[file]
    require(file)
})
