'use strict';

const cp   = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { initializeApp, getApps } = require('firebase/app');
const { getDatabase, ref, get, set } = require('firebase/database');

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
  return k
    .replace(/__dot__/g,'.').replace(/__hash__/g,'#')
    .replace(/__dollar__/g,'$').replace(/__slash__/g,'/')
    .replace(/__lb__/g,'[').replace(/__rb__/g,']');
}

function page404(slug){
  return `<!DOCTYPE html><html><head><title>404 — Dropify</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{text-align:center;max-width:400px;padding:40px}h1{font-size:64px;font-weight:800;color:#0d1117}p{color:#57606a;margin-top:8px}code{background:#f1f5f9;padding:2px 8px;border-radius:5px;font-size:13px}
a{display:inline-block;margin-top:20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:9px;padding:10px 22px;font-size:14px;font-weight:600}</style>
</head><body><div class="box"><h1>404</h1><p>Python app <code>${slug}</code> not found.</p><a href="/">Home</a></div></body></html>`;
}

function pageError(err){
  return `<!DOCTYPE html><html><head><title>Error</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{max-width:640px;padding:32px;width:100%}h2{color:#f85149;margin-bottom:12px}pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
a{display:inline-block;margin-top:14px;color:#58a6ff;font-size:13px}</style>
</head><body><div class="box"><h2>⚠ Python Runtime Error</h2><pre>${String(err).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre><a href="javascript:history.back()">← Back</a></div></body></html>`;
}

// ── Main Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const slug = req.query.slug;
  if(!slug) return res.status(404).send(page404('unknown'));

  try{
    // Lookup slug
    const slugSnap = await get(ref(db, `pySlug/${slug}`));
    if(!slugSnap.exists()) return res.status(404).send(page404(slug));
    const { uid, appId } = slugSnap.val();

    // Get app
    const appSnap = await get(ref(db, `pythonApps/${uid}/${appId}`));
    if(!appSnap.exists()) return res.status(404).send(page404(slug));
    const app = appSnap.val();

    if(app.status !== 'active'){
      return res.status(503).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#555"><h2>🔒 App Offline</h2><p style="margin-top:8px">This app is currently inactive.</p></body></html>`);
    }

    const files = app.files  || {};
    const env   = app.envVars || {};
    const entry = app.entryFile ? decodeKey(app.entryFile) : 'main.py';

    // Create temp dir
    const tmpDir = path.join(os.tmpdir(), `pyapp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write all files
    for(const [key, content] of Object.entries(files)){
      const fname = decodeKey(key);
      const fpath = path.join(tmpDir, fname);
      fs.mkdirSync(path.dirname(fpath), { recursive: true });
      fs.writeFileSync(fpath, content || '');
    }

    // Request info available in Python
    const reqInfo = JSON.stringify({
      method : req.method,
      path   : req.url,
      query  : req.query,
      body   : req.body || {},
      headers: { 'content-type': req.headers['content-type']||'', 'user-agent': req.headers['user-agent']||'' },
    });

    // Wrapper: inject env, request, override print, run entry
    const entryCode = (files[app.entryFile] || app.code || '').replace(/\\/g,'\\\\').replace(/"""/g,'\\"\\"\\"');
    const wrapper = `import sys, os, json as _j
sys.path.insert(0,'${tmpDir.replace(/\\/g,'/')}')
_env=_j.loads("""${JSON.stringify(env).replace(/"""/g,'\\"\\"\\"')}""")
for k,v in _env.items(): os.environ[k]=str(v)
request=_j.loads("""${reqInfo.replace(/"""/g,'\\"\\"\\"')}""")
env=_env
_buf=[]
import builtins as _bt
_orig_print=_bt.print
def print(*a,sep=' ',end='\\n',**kw): _buf.append(sep.join(str(x) for x in a)+end)
_bt.print=print
try:
    exec(open('${tmpDir.replace(/\\/g,'/')}/${entry}').read())
except SystemExit: pass
except Exception as e: _buf.append(str(e))
_bt.print=_orig_print
sys.stdout.write(''.join(_buf))
`;

    const wrapperPath = path.join(tmpDir, '_run.py');
    fs.writeFileSync(wrapperPath, wrapper);

    // Install requirements.txt if present
    const reqTxt = path.join(tmpDir, 'requirements.txt');
    const pkgDir = path.join(tmpDir, '_pkgs');

    const runIt = () => new Promise(resolve => {
      const env2 = { ...process.env, PYTHONPATH: pkgDir+':'+tmpDir };
      cp.execFile('python3', [wrapperPath], { timeout: 8000, env: env2 },
        (err, stdout, stderr) => {
          try{ fs.rmSync(tmpDir,{recursive:true,force:true}); }catch(_){}
          resolve({ out: stdout||'', err: stderr||'', crash: err });
        }
      );
    });

    let result;
    if(fs.existsSync(reqTxt)){
      fs.mkdirSync(pkgDir,{recursive:true});
      await new Promise(r => cp.execFile('pip3',['install','-r',reqTxt,'--target',pkgDir,'-q','--no-deps'],{timeout:20000},()=>r()));
      result = await runIt();
    } else {
      result = await runIt();
    }

    // Increment views
    try{
      const vSnap = await get(ref(db,`pythonApps/${uid}/${appId}/views`));
      await set(ref(db,`pythonApps/${uid}/${appId}/views`),(vSnap.val()||0)+1);
    }catch(_){}

    // Error with no output
    if(result.crash && !result.out){
      return res.status(500).send(pageError(result.err || result.crash.message));
    }
    if(result.err && !result.out){
      return res.status(500).send(pageError(result.err));
    }

    const out = result.out.trim();

    // Auto-detect content type
    if(out.toLowerCase().startsWith('<!doctype') || out.startsWith('<html') || /<[a-z][\s\S]*>/i.test(out)){
      res.setHeader('Content-Type','text/html; charset=utf-8');
    } else {
      try{ JSON.parse(out); res.setHeader('Content-Type','application/json'); }
      catch(_){ res.setHeader('Content-Type','text/plain; charset=utf-8'); }
    }

    return res.status(200).send(out || '(no output — add print() to your code)');

  }catch(err){
    console.error('[PyHost]',err.message);
    return res.status(500).send(pageError(err.message));
  }
};
