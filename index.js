const { makeWASocket, getContentType, useMultiFileAuthState, fetchLatestBaileysVersion, prepareWAMessageMedia, Browsers, makeCacheableSignalKeyStore, DisconnectReason, generateWAMessageFromContent, relayMessage } = require("@fizzxydev/baileys-pro");
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
const connectedUsersFilePath = path.join(__dirname, 'pairedUsers.json');
const { smsg } = require("./lib/myfunc")
const CHANNEL_USERNAME = '@gabimarutechchannel';
const OWNER_FILE = path.join(__dirname, 'telegramowners.json');

if (!fs.existsSync(OWNER_FILE)) {
    fs.writeFileSync(OWNER_FILE, JSON.stringify([]));
}

function isOwner(userId) {
    const owners = JSON.parse(fs.readFileSync(OWNER_FILE));
    return owners.includes(userId.toString());
}
async function userFollowsChannel(userId, bot) {
    try {
        const chatMember = await bot.getChatMember(CHANNEL_USERNAME, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (err) {
        console.error('❌ Error checking channel membership:', err);
        return false;
    }
}
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

/*
            try {
                await conn.sendMessage(developer, { text: `Connection to ${phoneNumber} has been secured. ✅` });
            } catch (error) {
                console.error('Error sending message to admin:', error);
            }
            */
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

    const raw = messages[0];
    if (!raw || !raw.message || !raw.key || raw.key.remoteJid === 'status@broadcast') return;

    const fromMe = raw.key.fromMe;
    if (!conn.public && !fromMe) return;

    raw.message = raw.message.ephemeralMessage?.message || raw.message;

    const m = smsg(JSON.parse(JSON.stringify(raw)), conn);

    const hot = getContentType(m.message);
    let body = '';
    switch (hot) {
      case 'conversation':
        body = m.message.conversation;
        break;
      case 'imageMessage':
        body = m.message.imageMessage.caption;
        break;
      case 'videoMessage':
        body = m.message.videoMessage.caption;
        break;
      case 'extendedTextMessage':
        body = m.message.extendedTextMessage.text;
        break;
      case 'buttonsResponseMessage':
        body = m.message.buttonsResponseMessage.selectedButtonId;
        break;
      case 'listResponseMessage':
        body = m.message.listResponseMessage.singleSelectReply.selectedRowId;
        break;
      default:
        body = '';
    }
    body = (body || '').trim();

    const prefix = settings.prefix || '.';
    const isCmd = body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).split(/\s+/)[0].toLowerCase() : '';
    const args = body.split(/\s+/).slice(1);
    const q = args.join(' ');

    const sender = m.key.fromMe ? conn.user.id : (m.key.participant || m.key.remoteJid);
    const pushname = m.pushName || 'Unknown';

    console.table([{
      From: pushname,
      Command: isCmd ? command : '—',
      Message: body.length > 40 ? body.slice(0, 40) + '…' : body,
      Group: m.isGroup,
      Sender: sender
    }]);

    const ownerList = JSON.parse(fs.readFileSync('./developers.json'));
    const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
    const isCreator = [botJid, ...ownerList.map(n => `${n.replace(/\D/g, '')}@s.whatsapp.net`)].includes(sender);

    let groupAdmins = [];
    if (m.isGroup) {
      const gm = await conn.groupMetadata(m.chat).catch(() => ({}));
      groupAdmins = gm.participants?.filter(p => p.admin).map(p => p.id) || [];
    }

    const isAdmin = groupAdmins.includes(sender);
    const isBotAdmin = groupAdmins.includes(botJid);

    const send = text => conn.sendMessage(m.chat, { text });
    const xreply = text => conn.sendMessage(m.chat, { text, contextInfo: {/* you can extend here */} });

    if (!isCmd) return;

    switch (command) {
      case 'ping': {
        const start = performance.now();
        const diff = performance.now() - start;
        return xreply(`🏓 Pong! ${diff.toFixed(2)} ms`);
      }

      case 'public':
        if (!isCreator) return send('⛔ Owners only');
        conn.public = true;
        return xreply('Bot is now in public mode');

      case 'self':
        if (!isCreator) return send('⛔ Owners only');
        conn.public = false;
        return xreply('Bot is now in self/private mode');

      case 'creategc':
        if (!isCreator) return;
        if (!q) return xreply(`Usage: ${prefix}creategc <group name>`);
        const group = await conn.groupCreate(q, []);
        const link = await conn.groupInviteCode(group.id);
        return conn.sendMessage(m.chat, {
          text: `✅ Group "${group.subject}" created\nOwner: @${group.owner.split('@')[0]}\nLink: https://chat.whatsapp.com/${link}`,
          mentions: [group.owner]
        });

      case 'subject':
        if (!m.isGroup) return send('❌ Group only command');
        if (!isBotAdmin) return send('❌ Bot must be admin');
        if (!isAdmin) return send('❌ Admins only');
        if (!q) return send('❌ Provide subject text');
        await conn.groupUpdateSubject(m.chat, q);
        return xreply('✅ Group subject updated');

      default:
        if (isCreator && (body.startsWith('=>') || body.startsWith('>') || body.startsWith('$'))) {
          try {
            if (body.startsWith('=>')) {
              const result = await eval(`(async () => { return ${body.slice(3)} })()`);
              return send(util.format(result));
            }
            if (body.startsWith('>')) {
              let result = await eval(body.slice(2));
              if (typeof result !== 'string') result = util.inspect(result);
              return send(result);
            }
            if (body.startsWith('$')) {
              exec(body.slice(2), (err, stdout, stderr) => {
                if (err) return send(err.message);
                if (stdout) return send(stdout);
                if (stderr) return send(stderr);
              });
            }
          } catch (err) {
            return send(err.toString());
          }
        }
        break;
    }

  } catch (e) {
    console.error('❌ upsert handler error:', e);
    try {
      if (typeof m?.chat === 'string') {
        conn.sendMessage(m.chat, { text: `Error: ${e.message || e}` });
      }
    } catch { }
  }
});
}

let isPairLocked = true;

bot.onText(/\/lockpair/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  isPairLocked = true;
  bot.sendMessage(chatId, "🔒 /pair command has been locked. Only owners can use it now.");
});

bot.onText(/\/unlockpair/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  isPairLocked = false;
  bot.sendMessage(chatId, "🔓 /pair command has been unlocked. All users can use it now.");
});

bot.onText(/\/pair(?:\s(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const phoneNumber = match[1];

       if (!phoneNumber) {
        return bot.sendMessage(chatId, `⚠️ Wrong format, Usage: /pair 234xxxxxx`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Join Channel', url: `https://t.me/gabimarutechchannel` }
                    ]
                ]
            }
        });
    }
    // Channel follow enforcement
    const follows = await userFollowsChannel(userId, bot);
    if (!follows) {
        return bot.sendMessage(chatId, `❌ Please follow ${CHANNEL_USERNAME} before using this command.`);
    }

    // Pair lock check
    if (isPairLocked && !isOwner(userId)) {
        return bot.sendMessage(chatId, `🚫 Pairing is currently locked. Only bot owners can use this command.`);
    }

    const sessionPath = path.join(__dirname, 'tmp', `session_${phoneNumber}`);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
        console.log(`✅ Session directory created for ${phoneNumber}`);
        bot.sendMessage(chatId, `✅ Session directory created for ${phoneNumber}`);
        
        // Run your WhatsApp pairing logic
        startWhatsAppBot(phoneNumber, chatId).catch(err => {
            console.error('❌ Error pairing:', err);
            bot.sendMessage(chatId, '❌ An error occurred while connecting.');
        });
    } else {
        bot.sendMessage(chatId, `⚠️ Session for ${phoneNumber} already exists. Use /delpair to remove it.`);
    }
});

bot.onText(/\/eval (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1].trim();
    const userId = msg.from.id.toString();
    
      if (isOwner(userId)) {
    try {
        const result = eval(code);
        const response = `Result:\n${String(result)}`;

        bot.sendMessage(chatId, response);

    } catch (error) {
        console.error("Error during /eval:", error);
        bot.sendMessage(chatId, `Error:\n${String(error)}`);
    }
}  else {
        const options = {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [
                        {
                            text: "Get Premium",
                            url: "https://wa.me/2349012834275"
                        }
                    ]
                ]
            })
        };

        bot.sendMessage(chatId, "Sorry, only the bot owner can use this command.", options);
    }
});

// Handle /delete command
bot.onText(/\/delpair (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const ownerId = msg.from.id.toString();
    const phoneNumber = match[1];
    const sessionPath = path.join(__dirname, 'tmp', `session_${phoneNumber}`);
    /*
    if (ownerId !== OWNER_ID) {
        return bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
    }
    */
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
/list (view paired numbers)

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
    const connectedUser = connectedUsers[chatId];

    if (connectedUser && connectedUser.length > 0) {
        let statusText = `Bot Status:\n- Connected Numbers:\n`;

        connectedUser.forEach(user => {
            const jid = `${user.phoneNumber}@s.whatsapp.net`;
            statusText += `${jid}\n`;
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
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  try {
    // Fetch the chat information to get the bio (description)
    const chatInfo = await bot.getChat(chatId);
    const groupBio = chatInfo.description || "No group rules or description set.";

    newMembers.forEach(member => {
      const memberName = member.first_name || member.username || 'User';  // Get the member's name

      let welcomeMessage = `Welcome to the group, ${memberName}!`;

      if (msg.chat.title) {
        welcomeMessage += ` This is the ${msg.chat.title} group.`;
      }

      welcomeMessage += `\n\n*Group Rules and Information:*\n${groupBio}`;

      bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    });
  } catch (error) {
    console.error("Error fetching group bio:", error);
    bot.sendMessage(chatId, "Welcome to the group!  (Could not retrieve group rules at this time.)"); 
  }
});
// Start the bot
        console.table({
            "Bot Name": "WhatsTele Bot",
            "Link": `https://t.me/gabimarutechchannel`,
            "Author": "https://t.me/ayokunledavid"
})
console.log('Telegram bot instance has started...');


let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(`Update ${__filename}`)
    delete require.cache[file]
    require(file)
})
