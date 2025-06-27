const { makeWASocket, getContentType, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, DisconnectReason, generateWAMessageFromContent } = require("@adiwajshing/baileys");
const TelegramBot = require('node-telegram-bot-api');
const NodeCache = require('node-cache');
const pino = require('pino');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const speed = require("performance-now")
const moment = require("moment-timezone");
const crypto = require('crypto')


const startTime = Date.now();
// const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
const settings = require("./config.json")
const BOT_TOKEN = settings.BOT_TOKEN;  // Replace with your Telegram bot token
let OWNER_ID = settings.OWNER_ID
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pairingCodes = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const requestLimits = new NodeCache({ stdTTL: 120, checkperiod: 60 }); // Store request counts for 2 minutes
let connectedUsers = {}; // Maps chat IDs to phone numbers
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

    // Check if the session directory exists
    if (!fs.existsSync(sessionPath)) {
        console.log(`Session directory does not exist for ${phoneNumber}.`);
        return; // Exit the function if the session does not exist
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
//    store.bind(conn.ev);

    // Check if session credentials are already saved
    if (conn.authState.creds.registered) {
        await saveCreds();
        console.log(`Reloaded Creds For ${phoneNumber}!`);
    } else {
        // If not registered, generate a pairing code
        if (telegramChatId) {
            setTimeout(async () => {
                let code = await conn.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                pairingCodes.set(code, { count: 0, phoneNumber });
                bot.sendMessage(telegramChatId, `Your Pairing Code for ${phoneNumber}: ${code}`);
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

            // Send success messages to the user on Telegram
            if (telegramChatId) {
                if (!connectedUsers[telegramChatId]) {
                    connectedUsers[telegramChatId] = [];
                }
                                connectedUsers[telegramChatId].push({ phoneNumber, connectedAt: startTime });
                saveConnectedUsers(); // Save connected users after updating
                bot.sendMessage(telegramChatId, `Connection to ${phoneNumber} has been secured. ✅`)
		console.log(`
Connection to ${phoneNumber} has been secured. ✅`);
            }

            // Send a success message to the lord on WhatsApp
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

    conn.ev.on('messages.upsert', async chatUpdate => {
        try {
            mess = chatUpdate.messages[0]
            if (!mess.message) return
            mess.message = (Object.keys(mess.message)[0] === 'ephemeralMessage') ? mess.message.ephemeralMessage.message : mess.message
            if (mess.key && mess.key.remoteJid === 'status@broadcast') return
            if (!conn.public && !mess.key.fromMe && chatUpdate.type === 'notify') return
            if (mess.key.id.startsWith('BAE5') && mess.key.id.length === 16) return
                try {
        const m = smsg(JSON.parse(JSON.stringify(mess)), conn);
        const type = getContentType(mess.message);
        const content = JSON.stringify(mess.message);
        const chat = mess.key.remoteJid;
        const quoted = type === 'extendedTextMessage' && mess.message.extendedTextMessage.contextInfo != null
            ? mess.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
        var body = (
type === 'conversation' ? mess.message.conversation :
type === 'imageMessage' ? mess.message.imageMessage.caption :
type === 'videoMessage' ? mess.message.videoMessage.caption :
type === 'extendedTextMessage' ? mess.message.extendedTextMessage.text :
type === 'buttonsResponseMessage' ? mess.message.buttonsResponseMessage.selectedButtonId :
type === 'listResponseMessage' ? mess.message.listResponseMessage.singleSelectReply.selectedRowId :
type === 'interactiveResponseMessage' ? JSON.parse(mess.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id :
type === 'templateButtonReplyMessage' ? mess.message.templateButtonReplyMessage.selectedId :
type === 'messageContextInfo' ?
mess.message.buttonsResponseMessage?.selectedButtonId ||                                                                                                   
mess.message.listResponseMessage?.singleSelectReply.selectedRowId ||
mess.message.InteractiveResponseMessage.NativeFlowResponseMessage ||                                                                                       
mess.text :
''
); 
    var budy = (typeof m.text == 'string' ? m.text : '')
        const prefix = settings.prefix
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const q = args.join(' ');
        const isGroup = chat.endsWith('@g.us');
        const sender = mess.key.fromMe
            ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
            : (mess.key.participant || mess.key.remoteJid);
        const senderNumber = sender.split('@')[0];
        const botNumber = conn.user.id.split(':')[0];
        const pushname = mess.pushName || 'TeleWA bot';
        let owner = JSON.parse(fs.readFileSync('./developers.json'))
        const isCreator = [botNumber,owner].map(v => String(v).replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(sender)
        const groupMetadata = isGroup ? await conn.groupMetadata(chat).catch(e => {}) : '';
        const groupName = isGroup ? groupMetadata.subject : '';
        const participants = isGroup ? await groupMetadata.participants : '';
        const groupAdmins = isGroup ? await participants.filter(v => v.admin !== null).map(v => v.id) : ''
        const isBotAdmins = isGroup ? groupAdmins.includes(botNumber + "@s.whatsapp.net") : false;
        const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

		
        const send = async (text) => {
        await conn.sendMessage(chat, { text: text })
	  }
	  const zets = {
key: {
fromMe: false,
participant: "0@s.whatsapp.net",
remoteJid: "status@broadcast"
},
message: {
orderMessage: {
orderId: "2029",
thumbnailUrl: "https://h.top4top.io/p_3359f93n70.jpg",
itemCount: `125`,
status: "INQUIRY",
surface: "CATALOG",
message: `𝐊𝐢𝐧𝐠 𝐆𝐚𝐛𝐢𝐦𝐚𝐫𝐮`,
token: "AR6xBKbXZn0Xwmu76Ksyd7rnxI+Rx87HfinVlW4lwXa6JA=="
}
},
contextInfo: {
mentionedJid: [mess.sender],
forwardingScore: 999,
isForwarded: true
}
}
const xreply = async (text) => {
return conn.sendMessage(chat, {
contextInfo: {
mentionedJid: [mess.sender],
externalAdReply: {
showAdAttribution: false, //
renderLargerThumbnail: false, //
title: `𝖵𝗂𝗉𝖾𝗋: 𝖳𝗁𝖾 𝖠𝗐𝖺𝗂𝗍𝖾𝖽 𝖱𝖾𝗍𝗎𝗋𝗇`,
body: `${pushname}`,
previewType: "VIDEO",
thumbnailUrl: "https://files.catbox.moe/57maks.jpg",
sourceUrl: "https://t.me/gabimarutechchannel",
mediaUrl: "https://t.me/lonelydeveloper"
}
},
text: text
}, {
quoted: zets
})
}

	  

      
        //Commands here
        switch (command) {
    case "ping": { 
    let timestamp = speed();
    let latency = speed() - timestamp;
    conn.sendMessage(chat, `🔹 PING: ${latency.toFixed(4)} MS ⚡`);
} 
break;
case 'group-link': 
case 'gc-link': {
if (isGroup) {
const code = await conn.groupInviteCode(chat)
reply('gr᥆ᥙ⍴ ᥣіᥒk: https://chat.whatsapp.com/' + code)
} else {
 return;
}
}
break
   case 'menu':
   case 'arise': {
sbe = ["https://files.catbox.moe/ad6h83.jpg", "https://files.catbox.moe/yqfzkv.jpg", "https://b.top4top.io/p_3360xqf1y0.jpg"];
imageUrl = sbe[Math.floor(Math.random(), sbe.length)]
await conn.sendMessage(chat, { image: { url: imageUrl }, 
caption: `𝖲𝖺𝗅𝗎𝗍𝖾! 𝖳𝗁𝗂𝗌 𝗂𝗌 𝖵𝗂𝗉𝖾𝗋, 𝖺 𝖶𝗁𝖺𝗍𝗌𝖠𝗉𝗉 𝖻𝗈𝗍 𝖼𝗋𝖾𝖺𝗍𝖾𝖽 𝖻𝗒 𝖦𝖺𝖻𝗂𝗆𝖺𝗋𝗎
𝖢𝗈𝗆𝗆𝖺𝗇𝖽𝗌:
.𝗉𝗂𝗇𝗀
.𝗆𝖾𝗇𝗎
.𝗀𝗋𝗈𝗎𝗉-𝗅𝗂𝗇𝗄
>
$` }, { quoted: zets })
}
break

        default:
        if (budy.startsWith('=>')) {
if (!isCreator) return
function Return(sul) {
sat = JSON.stringify(sul, null, 2)
bang = util.format(sat)
if (sat == undefined) {
bang = util.format(sul)
}
return send(bang)
}
try {                                                                             
send(util.format(eval(`(async () => { return ${budy.slice(3)} })()`)))
} catch (e) {
send(String(e))
}
	} 
		if (budy.startsWith('>')) {
        if (!isCreator) return
        try {
        let evaled = await eval(budy.slice(2))
        if (typeof evaled !== 'string') evaled = require('util').inspect(evaled)
        await send(evaled)
        } catch (err) {
        await send(String(err))
        }
	} 
	        
	if (budy.startsWith('$')) {
if (!isCreator) return
exec(budy.slice(2), (err, stdout) => {
if (err) return send(`${err}`)
if (stdout) return send(`${stdout}`)
})
} 
        }
	     } catch (error) { console.log(error)}
        } catch (err) {
            console.log(err)
        }
    })
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
    if (ownerId !== OWNER_ID) {
        return bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
    }
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
-:🦺 Commands:
/pair <phone number>
/delpair <phone number>`;

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
