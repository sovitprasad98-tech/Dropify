'use strict';

const vm   = require('vm');
const cp   = require('child_process');
const fs   = require('fs');
const os   = require('os');
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
};
const firebaseApp = getApps().length===0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getDatabase(firebaseApp);

// ── Helpers ───────────────────────────────────────────────────────────
function decodeKey(k){
  return k.replace(/__dot__/g,'.').replace(/__hash__/g,'#').replace(/__dollar__/g,'$')
          .replace(/__slash__/g,'/').replace(/__lb__/g,'[').replace(/__rb__/g,']');
}
async function tgApi(token,method,params={}){
  try{
    const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)
    });
    return await r.json();
  }catch(e){return{ok:false,description:e.message};}
}
async function addLog(botId,level,msg){
  try{
    await set(push(ref(db,`botLogs/${botId}`)),{
      level,msg:String(msg).slice(0,800),ts:Date.now()
    });
  }catch(_){}
}

// ── Python helpers builder ────────────────────────────────────────────
function buildPythonHelpers(token,update,env){
  return `
import json as _json, urllib.request as _ur, sys as _sys, os as _os

_TOKEN  = ${JSON.stringify(token)}
_UPDATE = _json.loads(${JSON.stringify(JSON.stringify(update))})
_ENV    = _json.loads(${JSON.stringify(JSON.stringify(env))})
update  = _UPDATE
env     = _ENV

def _api(m,**p):
    try:
        d=_json.dumps(p).encode()
        q=_ur.Request(f"https://api.telegram.org/bot{_TOKEN}/{m}",d,{"Content-Type":"application/json"},method="POST")
        with _ur.urlopen(q,timeout=8) as r: return _json.loads(r.read())
    except Exception as e: return{"ok":False,"description":str(e)}

def _cid():
    for p in [["message","chat","id"],["callback_query","message","chat","id"],["channel_post","chat","id"],["edited_message","chat","id"]]:
        v=_UPDATE
        try:
            for k in p: v=v[k]
            return v
        except: pass
    return None

def send_message(chat_id,text,**o): return _api("sendMessage",chat_id=chat_id,text=str(text),**o)
def reply(text,**o): return send_message(_cid(),text,**o)
def send_photo(chat_id,photo,**o): return _api("sendPhoto",chat_id=chat_id,photo=photo,**o)
def send_document(chat_id,doc,**o): return _api("sendDocument",chat_id=chat_id,document=doc,**o)
def send_video(chat_id,video,**o): return _api("sendVideo",chat_id=chat_id,video=video,**o)
def edit_message(chat_id,msg_id,text,**o): return _api("editMessageText",chat_id=chat_id,message_id=msg_id,text=str(text),**o)
def delete_message(chat_id,msg_id): return _api("deleteMessage",chat_id=chat_id,message_id=msg_id)
def answer_callback(cb_id,text="",**o): return _api("answerCallbackQuery",callback_query_id=cb_id,text=str(text),**o)
def get_chat_member(chat_id,user_id): return _api("getChatMember",chat_id=chat_id,user_id=user_id)
def ban_member(chat_id,user_id): return _api("banChatMember",chat_id=chat_id,user_id=user_id)
def log(*a): print(*a)
`;
}

// ══════════════════════════════════════════════════════════════════════
// PYTHON RUNNER — multi-file support with pip install
// ══════════════════════════════════════════════════════════════════════
async function runPython(bot, update) {
  return new Promise((resolve) => {
    const tmpDir = path.join(os.tmpdir(), `dbot_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const logs = [];

    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch(e) {
      return resolve([{ level:'error', msg:'Failed to create tmpDir: '+e.message }]);
    }

    const token = bot.token;
    const env   = bot.envVars || {};
    const files = bot.files   || {};
    const entry = bot.entryFile ? decodeKey(bot.entryFile) : 'main.py';

    // Write all user files to tmpDir
    for (const [key, content] of Object.entries(files)) {
      const fname = decodeKey(key);
      try { fs.writeFileSync(path.join(tmpDir, fname), content || ''); }
      catch(e) { logs.push({ level:'warn', msg:`Could not write ${fname}: ${e.message}` }); }
    }

    // Write helpers file
    const helpers = buildPythonHelpers(token, update, env);
    fs.writeFileSync(path.join(tmpDir, '_dropify_helpers.py'), helpers);

    // Inject helpers import into entry file content
    const entryContent = `import sys, os\nsys.path.insert(0,'${tmpDir}')\nfrom _dropify_helpers import *\n\n` +
      (files[bot.entryFile] || files[Object.keys(files)[0]] || '');
    const entryPath = path.join(tmpDir, '_entry.py');
    fs.writeFileSync(entryPath, entryContent);

    // Check if requirements.txt exists
    const reqPath = path.join(tmpDir, 'requirements.txt');
    const hasReq  = fs.existsSync(reqPath);
    const pkgDir  = path.join(tmpDir, '_pkgs');

    const runEntry = () => {
      const env2 = { ...process.env, PYTHONPATH: pkgDir + ':' + tmpDir };
      cp.execFile('python3', [entryPath], { timeout:8000, env: env2 }, (err, stdout, stderr) => {
        try { fs.rmSync(tmpDir, { recursive:true, force:true }); } catch(_) {}
        if (stdout?.trim()) logs.push({ level:'log',   msg: stdout.trim() });
        if (stderr?.trim()) logs.push({ level:'error', msg: stderr.trim() });
        if (err && !stderr) logs.push({ level:'error', msg: err.message });
        resolve(logs);
      });
    };

    if (hasReq) {
      fs.mkdirSync(pkgDir, { recursive:true });
      logs.push({ level:'system', msg:'Installing requirements.txt...' });
      cp.execFile('pip3', ['install', '-r', reqPath, '--target', pkgDir, '-q', '--no-deps'],
        { timeout:25000 }, (err, stdout, stderr) => {
          if (err) logs.push({ level:'warn', msg:'pip install warning: '+(stderr||err.message) });
          else logs.push({ level:'system', msg:'Packages installed ✓' });
          runEntry();
        }
      );
    } else {
      runEntry();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// JS RUNNER — multi-file support via child_process node
// ══════════════════════════════════════════════════════════════════════
function buildJsHelpers(token, update, env) {
  return `
const _fetch = fetch;
const _TOKEN = ${JSON.stringify(token)};
const update = ${JSON.stringify(update)};
const env    = ${JSON.stringify(env)};

const _tg = async (m,p={}) => {
  const r = await _fetch(\`https://api.telegram.org/bot\${_TOKEN}/\${m}\`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)
  });
  return r.json();
};
const _cid = () =>
  update?.message?.chat?.id || update?.callback_query?.message?.chat?.id ||
  update?.channel_post?.chat?.id || update?.edited_message?.chat?.id || null;

const sendMessage  = (c,t,o={}) => _tg('sendMessage',  {chat_id:c,text:String(t),...o});
const reply        = (t,o={})   => sendMessage(_cid(),t,o);
const sendPhoto    = (c,p,o={}) => _tg('sendPhoto',    {chat_id:c,photo:p,...o});
const sendDocument = (c,d,o={}) => _tg('sendDocument', {chat_id:c,document:d,...o});
const sendVideo    = (c,v,o={}) => _tg('sendVideo',    {chat_id:c,video:v,...o});
const editMessage  = (c,m,t,o={}) => _tg('editMessageText',{chat_id:c,message_id:m,text:String(t),...o});
const deleteMessage= (c,m)      => _tg('deleteMessage',{chat_id:c,message_id:m});
const answerCallback=(i,t='',o={})=>_tg('answerCallbackQuery',{callback_query_id:i,text:String(t),...o});
const getChatMember= (c,u)      => _tg('getChatMember',{chat_id:c,user_id:u});
const banMember    = (c,u)      => _tg('banChatMember',{chat_id:c,user_id:u});
const log          = (...a)     => console.log(...a);
`;
}

async function runJsMultiFile(bot, update) {
  return new Promise((resolve) => {
    const tmpDir = path.join(os.tmpdir(), `dbot_js_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const logs = [];
    try { fs.mkdirSync(tmpDir, { recursive:true }); } catch(e) {
      return resolve([{ level:'error', msg:'tmpDir failed: '+e.message }]);
    }

    const token = bot.token;
    const env   = bot.envVars || {};
    const files = bot.files   || {};

    // Write all user files
    for (const [key, content] of Object.entries(files)) {
      const fname = decodeKey(key);
      try { fs.writeFileSync(path.join(tmpDir, fname), content || ''); } catch(e) {}
    }

    // Write entry wrapper
    const entryContent = buildJsHelpers(token, update, env) +
      '\n;(async()=>{\n' +
      (files[bot.entryFile] || files[Object.keys(files)[0]] || '') +
      '\n})().catch(e=>console.error(e.message));\n';
    const entryPath = path.join(tmpDir, '_entry.mjs');
    fs.writeFileSync(entryPath, entryContent);

    cp.execFile('node', [entryPath], { timeout:8000, cwd:tmpDir },
      (err, stdout, stderr) => {
        try { fs.rmSync(tmpDir, { recursive:true, force:true }); } catch(_) {}
        if (stdout?.trim()) logs.push({ level:'log',   msg: stdout.trim() });
        if (stderr?.trim()) logs.push({ level:'error', msg: stderr.trim() });
        if (err && !stderr) logs.push({ level:'error', msg: err.message });
        resolve(logs);
      }
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// JS SINGLE-FILE RUNNER (fast, vm sandbox — for simple bots)
// ══════════════════════════════════════════════════════════════════════
async function runJsVM(bot, update) {
  const token = bot.token;
  const env   = bot.envVars || {};
  const code  = bot.code || '';
  const pendingLogs = [];

  const getChatId = () =>
    update?.message?.chat?.id || update?.callback_query?.message?.chat?.id ||
    update?.channel_post?.chat?.id || update?.edited_message?.chat?.id || null;

  const sendMessage  = (c,t,o={}) => tgApi(token,'sendMessage',  {chat_id:c,text:String(t),...o});
  const reply        = (t,o={})   => sendMessage(getChatId(),t,o);
  const sendPhoto    = (c,p,o={}) => tgApi(token,'sendPhoto',    {chat_id:c,photo:p,...o});
  const sendDocument = (c,d,o={}) => tgApi(token,'sendDocument', {chat_id:c,document:d,...o});
  const sendVideo    = (c,v,o={}) => tgApi(token,'sendVideo',    {chat_id:c,video:v,...o});
  const editMessage  = (c,m,t,o={})=>tgApi(token,'editMessageText',{chat_id:c,message_id:m,text:String(t),...o});
  const deleteMessage= (c,m)      => tgApi(token,'deleteMessage',{chat_id:c,message_id:m});
  const answerCallback=(i,t='',o={})=>tgApi(token,'answerCallbackQuery',{callback_query_id:i,text:String(t),...o});
  const getChatMember= (c,u)      => tgApi(token,'getChatMember',{chat_id:c,user_id:u});
  const banMember    = (c,u)      => tgApi(token,'banChatMember',{chat_id:c,user_id:u});
  const log = (...a) => pendingLogs.push({level:'log',msg:a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ')});

  const sandbox = {
    update,env,sendMessage,reply,sendPhoto,sendDocument,sendVideo,
    editMessage,deleteMessage,answerCallback,getChatMember,banMember,
    log,fetch,
    console:{
      log:(...a)=>log(...a),warn:(...a)=>pendingLogs.push({level:'warn',msg:a.join(' ')}),
      error:(...a)=>pendingLogs.push({level:'error',msg:a.join(' ')}),
      info:(...a)=>pendingLogs.push({level:'info',msg:a.join(' ')}),
    },
    JSON,Math,Date,parseInt,parseFloat,String,Number,Boolean,Array,Object,
    Promise,RegExp,Error,Map,Set,encodeURIComponent,decodeURIComponent,
    setTimeout:(fn,ms)=>new Promise(r=>setTimeout(()=>{try{fn();}catch(_){}r();},Math.min(ms||0,5000))),
  };
  vm.createContext(sandbox);
  try { await new vm.Script(`(async()=>{\n${code}\n})()`).runInContext(sandbox,{timeout:8000}); }
  catch(e){ pendingLogs.push({level:'error',msg:'Runtime error: '+e.message}); }
  return pendingLogs;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  if (req.method==='GET') return res.status(200).send('✅ Dropify Webhook Active');
  if (req.method!=='POST') return res.status(405).send('Method Not Allowed');

  const botId = req.query.botId;
  if (!botId) return res.status(400).json({error:'Missing botId'});

  try {
    const indexSnap = await get(ref(db,`botIndex/${botId}`));
    if (!indexSnap.exists()) return res.status(200).json({ok:false,note:'bot_not_found'});
    const { uid } = indexSnap.val();

    const botSnap = await get(ref(db,`bots/${uid}/${botId}`));
    if (!botSnap.exists()) return res.status(200).json({ok:false,note:'bot_config_missing'});
    const bot = botSnap.val();

    if (bot.status!=='running') return res.status(200).json({ok:true,note:'bot_stopped'});

    const update = req.body;
    const lang   = (bot.language||'js').toLowerCase();
    const hasMultipleFiles = bot.files && Object.keys(bot.files).length > 1;

    // Route to correct runner
    let logs;
    if (lang==='python') {
      logs = await runPython(bot, update);
    } else if (hasMultipleFiles) {
      logs = await runJsMultiFile(bot, update); // multi-file JS via node
    } else {
      logs = await runJsVM(bot, update); // single-file JS via vm (faster)
    }

    // Save logs + increment message count
    await Promise.allSettled([
      ...logs.map(({level,msg})=>addLog(botId,level,msg)),
      update.message
        ? get(ref(db,`bots/${uid}/${botId}/messageCount`)).then(s=>
            set(ref(db,`bots/${uid}/${botId}/messageCount`),(s.val()||0)+1))
        : Promise.resolve(),
    ]);

    return res.status(200).json({ok:true});

  } catch(err) {
    console.error('[Dropify]',err.message);
    try { await addLog(botId,'error','Server error: '+err.message); } catch(_) {}
    return res.status(200).json({ok:true});
  }
};
