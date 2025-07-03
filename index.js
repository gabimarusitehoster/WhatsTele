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
const { startWhatsappBot } = require("./lib/wafunc");

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
