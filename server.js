// By:  Tᴀɪʀᴀ Mᴀᴋɪɴᴏ
// https://wa.me/2347080968564
// https://github.com/anonphoenix007
// https://t.me/Taira_makino
// https://whatsapp.com/channel/0029VaY0Zq32P59piTo5rg0K
// https://chat.whatsapp.com/EKdfDFDoi5C3ck88OmbJyk

const { spawn } = require('child_process');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

const apiURL = 'https://trial-endpoint.onrender.com/trial';

async function isTrialActive() {
  try {
    const response = await fetch(apiURL);
    const { expiration } = await response.json();
    const expirationDate = new Date(expiration);
    const currentDate = new Date();

    if (currentDate >= expirationDate) {
      console.error('⛔ Trial period expired. Launcher will not continue.');
      return false;
    }

    const timeLeft = expirationDate - currentDate;
    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((timeLeft / (1000 * 60)) % 60);
    const seconds = Math.floor((timeLeft / 1000) % 60);

    console.log(`✅ Trial active — ${days}d ${hours}h ${minutes}m ${seconds}s remaining`);
    return true;
  } catch (err) {
    console.error('⚠️ Error checking trial:', err.message);
    return false;
  }
}

async function start() {
  const trialOK = await isTrialActive();
  if (!trialOK) return;

  const args = [path.join(__dirname, 'index.js'), ...process.argv.slice(2)];
  console.log([process.argv[0], ...args].join('\n'));

  let p = spawn(process.argv[0], args, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  })
    .on('message', data => {
      if (data === 'reset') {
        console.log('🔄 Restarting 𝖵𝗂𝗉𝖾𝗋...');
        p.kill();
        start();
      }
    })
    .on('exit', code => {
      console.error('Exited with code:', code);
      if (code === '.' || code === 1 || code === 0) start();
    });
}

start();
