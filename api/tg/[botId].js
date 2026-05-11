'use strict';

const vm  = require('vm');
const cp  = require('child_process');
const fs  = require('fs');
const os  = require('os');
const path = require('path');
const { initializeApp, getApps } = require('firebase/app');
const { getDatabase, ref, get, set, push } = require('firebase/database');

// ── Firebase ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey     : "AIzaSyBLzocO-22pXwjNg7HFG75OQzaFjbfV_0k",
  authDomain : "watch-be6e0.firebaseapp.com",
  databaseURL: "https://watch-be6e0-default-rtdb.firebaseio.com",
  projectId  : "watch-be6e0",
  storageBucket    : "watch-be6e0.firebasestorage.app",
  messagingSenderId: "1044218513896",
  appId      : "1:1044218513896:web:14db4db1291a4903dcbc5d",
  measurementId    : "G-LGLJYP7QGJ"
};

const firebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];
const db = getDatabase(firebaseApp);

// ── Telegram API ──────────────────────────────────────────────────────
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
      level, msg: String(msg).slice(0, 800), ts: Date.now(),
    });
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════
// PYTHON RUNNER
// ══════════════════════════════════════════════════════════════════════
function buildPythonScript(token, update, env, userCode) {
  return `
import json, urllib.request, sys

TOKEN  = ${JSON.stringify(token)}
UPDATE = json.loads(${JSON.stringify(JSON.stringify(update))})
env    = json.loads(${JSON.stringify(JSON.stringify(env))})

def _api(method, **p):
    try:
        data = json.dumps(p).encode()
        req  = urllib.request.Request(
            f"https://api.telegram.org/bot{TOKEN}/{method}",
            data=data, headers={"Content-Type":"application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"ok": False, "description": str(e)}

def _chat_id():
    for p in [["message","chat","id"],["callback_query","message","chat","id"],
              ["channel_post","chat","id"],["edited_message","chat","id"]]:
        v = UPDATE
        try:
            for k in p: v = v[k]
            return v
        except: pass
    return None

def send_message(chat_id, text, **opts): return _api("sendMessage", chat_id=chat_id, text=str(text), **opts)
def reply(text, **opts):                 return send_message(_chat_id(), text, **opts)
def send_photo(chat_id, photo, **opts):  return _api("sendPhoto",   chat_id=chat_id, photo=photo, **opts)
def send_document(chat_id, doc, **opts): return _api("sendDocument",chat_id=chat_id, document=doc, **opts)
def send_video(chat_id, video, **opts):  return _api("sendVideo",   chat_id=chat_id, video=video, **opts)
def edit_message(chat_id, msg_id, text, **opts): return _api("editMessageText", chat_id=chat_id, message_id=msg_id, text=str(text), **opts)
def delete_message(chat_id, msg_id):     return _api("deleteMessage", chat_id=chat_id, message_id=msg_id)
def answer_callback(cb_id, text="", **opts): return _api("answerCallbackQuery", callback_query_id=cb_id, text=str(text), **opts)
def get_chat_member(chat_id, user_id):   return _api("getChatMember", chat_id=chat_id, user_id=user_id)
def ban_member(chat_id, user_id):        return _api("banChatMember", chat_id=chat_id, user_id=user_id)

update = UPDATE

# ── USER CODE ──
${userCode}
`;
}

async function runPython(token, update, env, userCode) {
  return new Promise((resolve) => {
    const script  = buildPythonScript(token, update, env, userCode);
    const tmpFile = path.join(os.tmpdir(), `dropify_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const logs    = [];

    try {
      fs.writeFileSync(tmpFile, script);
    } catch (e) {
      return resolve([{ level: 'error', msg: 'Failed to write script: ' + e.message }]);
    }

    cp.execFile('python3', [tmpFile], { timeout: 8000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}

      if (stdout?.trim()) logs.push({ level: 'log',   msg: stdout.trim() });
      if (stderr?.trim()) logs.push({ level: 'error', msg: stderr.trim() });
      if (err && !stderr)  logs.push({ level: 'error', msg: err.message });

      resolve(logs);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════
// JAVASCRIPT RUNNER
// ══════════════════════════════════════════════════════════════════════
async function runJavaScript(token, update, env, userCode) {
  const pendingLogs = [];

  const getChatId = () =>
    update?.message?.chat?.id ||
    update?.callback_query?.message?.chat?.id ||
    update?.channel_post?.chat?.id ||
    update?.edited_message?.chat?.id || null;

  const sendMessage  = (c, t, o={}) => tgApi(token,'sendMessage',   {chat_id:c,text:String(t),...o});
  const reply        = (t, o={})    => sendMessage(getChatId(),t,o);
  const sendPhoto    = (c, p, o={}) => tgApi(token,'sendPhoto',     {chat_id:c,photo:p,...o});
  const sendDocument = (c, d, o={}) => tgApi(token,'sendDocument',  {chat_id:c,document:d,...o});
  const sendVideo    = (c, v, o={}) => tgApi(token,'sendVideo',     {chat_id:c,video:v,...o});
  const editMessage  = (c,m,t,o={}) => tgApi(token,'editMessageText',{chat_id:c,message_id:m,text:String(t),...o});
  const deleteMessage= (c, m)       => tgApi(token,'deleteMessage', {chat_id:c,message_id:m});
  const answerCallback=(i,t='',o={})=> tgApi(token,'answerCallbackQuery',{callback_query_id:i,text:String(t),...o});
  const getChatMember= (c, u)       => tgApi(token,'getChatMember', {chat_id:c,user_id:u});
  const banMember    = (c, u)       => tgApi(token,'banChatMember', {chat_id:c,user_id:u});
  const log = (...a) => pendingLogs.push({ level:'log', msg: a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ') });

  const sandbox = {
    update, env,
    sendMessage, reply, sendPhoto, sendDocument, sendVideo,
    editMessage, deleteMessage, answerCallback, getChatMember, banMember,
    log, fetch,
    console: {
      log:   (...a) => log(...a),
      warn:  (...a) => pendingLogs.push({ level:'warn',  msg: a.join(' ') }),
      error: (...a) => pendingLogs.push({ level:'error', msg: a.join(' ') }),
      info:  (...a) => pendingLogs.push({ level:'info',  msg: a.join(' ') }),
    },
    JSON, Math, Date, parseInt, parseFloat,
    String, Number, Boolean, Array, Object,
    Promise, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent,
    setTimeout: (fn, ms) => new Promise(r => setTimeout(()=>{ try{fn();}catch(_){} r(); }, Math.min(ms||0,5000))),
  };

  vm.createContext(sandbox);
  try {
    await new vm.Script(`(async()=>{\n${userCode}\n})()`).runInContext(sandbox, { timeout: 8000 });
  } catch (e) {
    pendingLogs.push({ level:'error', msg: 'Runtime error: ' + e.message });
  }

  return pendingLogs;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  if (req.method === 'GET')  return res.status(200).send('✅ Dropify Webhook Active');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'Missing botId' });

  try {
    const indexSnap = await get(ref(db, `botIndex/${botId}`));
    if (!indexSnap.exists()) return res.status(200).json({ ok: false, note: 'bot_not_found' });
    const { uid } = indexSnap.val();

    const botSnap = await get(ref(db, `bots/${uid}/${botId}`));
    if (!botSnap.exists()) return res.status(200).json({ ok: false, note: 'bot_config_missing' });
    const bot = botSnap.val();

    if (bot.status !== 'running') return res.status(200).json({ ok: true, note: 'bot_stopped' });

    const update   = req.body;
    const token    = bot.token;
    const env      = bot.envVars || {};
    const lang     = (bot.language || 'js').toLowerCase();

    // Run based on language
    const logs = lang === 'python'
      ? await runPython(token, update, env, bot.code)
      : await runJavaScript(token, update, env, bot.code);

    // Save logs + message count
    await Promise.allSettled([
      ...logs.map(({ level, msg }) => addLog(botId, level, msg)),
      update.message
        ? get(ref(db, `bots/${uid}/${botId}/messageCount`)).then(s =>
            set(ref(db, `bots/${uid}/${botId}/messageCount`), (s.val() || 0) + 1))
        : Promise.resolve(),
    ]);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[Dropify]', err.message);
    try { await addLog(botId, 'error', 'Server error: ' + err.message); } catch (_) {}
    return res.status(200).json({ ok: true });
  }
};
