'use strict';

const vm = require('vm');
const { initializeApp, getApps } = require('firebase/app');
const { getDatabase, ref, get, set, push } = require('firebase/database');

// ── Firebase Client SDK ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey           : "AIzaSyBLzocO-22pXwjNg7HFG75OQzaFjbfV_0k",
  authDomain       : "watch-be6e0.firebaseapp.com",
  databaseURL      : "https://watch-be6e0-default-rtdb.firebaseio.com",
  projectId        : "watch-be6e0",
  storageBucket    : "watch-be6e0.firebasestorage.app",
  messagingSenderId: "1044218513896",
  appId            : "1:1044218513896:web:14db4db1291a4903dcbc5d",
  measurementId    : "G-LGLJYP7QGJ"
};

const firebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];

const db = getDatabase(firebaseApp);

// ── Telegram API helper ───────────────────────────────────────────────
async function tgApi(token, method, params = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

// ── Firebase logger ───────────────────────────────────────────────────
async function addLog(botId, level, msg) {
  try {
    await set(push(ref(db, `botLogs/${botId}`)), {
      level,
      msg: String(msg).slice(0, 800),
      ts : Date.now(),
    });
  } catch (_) {}
}

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {

  // Health check (GET)
  if (req.method === 'GET') {
    return res.status(200).send('✅ Dropify Webhook Active');
  }
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'Missing botId' });

  try {
    // 1. Lookup UID from botIndex
    const indexSnap = await get(ref(db, `botIndex/${botId}`));
    if (!indexSnap.exists()) {
      return res.status(200).json({ ok: false, note: 'bot_not_found' });
    }
    const { uid } = indexSnap.val();

    // 2. Get bot config + code
    const botSnap = await get(ref(db, `bots/${uid}/${botId}`));
    if (!botSnap.exists()) {
      return res.status(200).json({ ok: false, note: 'bot_config_missing' });
    }
    const bot = botSnap.val();

    // 3. Skip if bot stopped
    if (bot.status !== 'running') {
      return res.status(200).json({ ok: true, note: 'bot_stopped' });
    }

    const update = req.body;
    const token  = bot.token;
    const env    = bot.envVars || {};

    // Helper: get chatId from any update type
    const getChatId = () =>
      update?.message?.chat?.id             ||
      update?.callback_query?.message?.chat?.id ||
      update?.channel_post?.chat?.id        ||
      update?.edited_message?.chat?.id      ||
      null;

    // ── Build Telegram helper functions ───────────────────────────────
    const sendMessage = (chatId, text, opts = {}) =>
      tgApi(token, 'sendMessage', { chat_id: chatId, text: String(text), ...opts });

    const reply = (text, opts = {}) =>
      sendMessage(getChatId(), text, opts);

    const sendPhoto = (chatId, photo, opts = {}) =>
      tgApi(token, 'sendPhoto', { chat_id: chatId, photo, ...opts });

    const sendDocument = (chatId, document, opts = {}) =>
      tgApi(token, 'sendDocument', { chat_id: chatId, document, ...opts });

    const sendVideo = (chatId, video, opts = {}) =>
      tgApi(token, 'sendVideo', { chat_id: chatId, video, ...opts });

    const editMessage = (chatId, message_id, text, opts = {}) =>
      tgApi(token, 'editMessageText', { chat_id: chatId, message_id, text: String(text), ...opts });

    const deleteMessage = (chatId, message_id) =>
      tgApi(token, 'deleteMessage', { chat_id: chatId, message_id });

    const answerCallback = (callback_query_id, text = '', opts = {}) =>
      tgApi(token, 'answerCallbackQuery', { callback_query_id, text: String(text), ...opts });

    const getChatMember = (chatId, user_id) =>
      tgApi(token, 'getChatMember', { chat_id: chatId, user_id });

    const banMember = (chatId, user_id) =>
      tgApi(token, 'banChatMember', { chat_id: chatId, user_id });

    // ── Log collector ─────────────────────────────────────────────────
    const pendingLogs = [];

    const log = (...args) => {
      const msg = args.map(a =>
        (typeof a === 'object' ? JSON.stringify(a) : String(a))
      ).join(' ');
      pendingLogs.push({ level: 'log', msg });
    };

    // ── VM Sandbox ────────────────────────────────────────────────────
    const sandbox = {
      // Telegram update + env vars
      update,
      env,

      // Telegram helpers
      sendMessage,
      reply,
      sendPhoto,
      sendDocument,
      sendVideo,
      editMessage,
      deleteMessage,
      answerCallback,
      getChatMember,
      banMember,

      // Dev utilities
      log,
      fetch,
      console: {
        log  : (...a) => log(...a),
        warn : (...a) => pendingLogs.push({ level: 'warn',  msg: a.join(' ') }),
        error: (...a) => pendingLogs.push({ level: 'error', msg: a.join(' ') }),
        info : (...a) => pendingLogs.push({ level: 'info',  msg: a.join(' ') }),
      },

      // Safe JS globals
      JSON, Math, Date, parseInt, parseFloat,
      String, Number, Boolean, Array, Object,
      Promise, RegExp, Error, TypeError, Map, Set,
      encodeURIComponent, decodeURIComponent,
      setTimeout: (fn, ms) =>
        new Promise(r => setTimeout(() => { try { fn(); } catch (_) {} r(); }, Math.min(ms || 0, 5000))),
    };

    vm.createContext(sandbox);

    // ── Execute user's bot code ───────────────────────────────────────
    try {
      const script = new vm.Script(`(async () => {\n${bot.code}\n})()`);
      await script.runInContext(sandbox, { timeout: 8000 });
    } catch (codeErr) {
      pendingLogs.push({ level: 'error', msg: `Runtime error: ${codeErr.message}` });
    }

    // ── Save logs + increment message count (parallel) ─────────────
    const tasks = [
      ...pendingLogs.map(({ level, msg }) => addLog(botId, level, msg)),
      update.message
        ? get(ref(db, `bots/${uid}/${botId}/messageCount`)).then(s =>
            set(ref(db, `bots/${uid}/${botId}/messageCount`), (s.val() || 0) + 1))
        : Promise.resolve(),
    ];
    await Promise.allSettled(tasks);

    // Always return 200 to Telegram
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[Dropify] Fatal error:', err.message);
    try { await addLog(botId, 'error', 'Server error: ' + err.message); } catch (_) {}
    return res.status(200).json({ ok: true }); // 200 chahiye Telegram ko
  }
};
