const express = require("express");
const cors = require("cors");
const path = require("path");
const { initializeApp, getApps } = require("firebase/app");
const { getDatabase, ref, get, set, update, remove, push } = require("firebase/database");

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBLzocO-22pXwjNg7HFG75OQzaFjbfV_0k",
  authDomain: "watch-be6e0.firebaseapp.com",
  databaseURL: "https://watch-be6e0-default-rtdb.firebaseio.com",
  projectId: "watch-be6e0",
  storageBucket: "watch-be6e0.firebasestorage.app",
  messagingSenderId: "1044218513896",
  appId: "1:1044218513896:web:14db4db1291a4903dcbc5d",
  measurementId: "G-LGLJYP7QGJ"
};


const firebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];

const db = getDatabase(firebaseApp);

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "../public")));

// ── Helpers ───────────────────────────────────────────────────────────────────
function not404(res, slug) {
  return res.status(404).send(`<!DOCTYPE html>
<html><head><title>404 — Dropify</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',sans-serif;background:#f8fafc;display:flex;
       align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .box{text-align:center;max-width:400px}
  .icon{width:72px;height:72px;background:#eef2ff;border-radius:20px;
        display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
  h1{font-size:48px;font-weight:800;color:#0d1117;letter-spacing:-2px}
  p{color:#57606a;font-size:15px;margin-top:8px;line-height:1.5}
  code{font-family:monospace;background:#f1f5f9;padding:2px 7px;
       border-radius:5px;font-size:13px;color:#4f46e5}
  a{display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;
    text-decoration:none;border-radius:9px;padding:10px 22px;font-size:14px;
    font-weight:600;transition:background .15s}
  a:hover{background:#4338ca}
</style>
</head>
<body>
  <div class="box">
    <div class="icon">⚡</div>
    <h1>404</h1>
    <p>The page <code>${slug}</code> doesn't exist or has been removed.</p>
    <a href="/">← Go to Dropify</a>
  </div>
</body></html>`);
}

function passwordPage(slug, wrong = false) {
  return `<!DOCTYPE html>
<html><head><title>Protected — Dropify</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',sans-serif;background:#f8fafc;display:flex;
       align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{background:#fff;border:1px solid #e8ecf0;border-radius:20px;
        padding:36px;width:100%;max-width:380px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
  .icon{width:56px;height:56px;background:#eef2ff;border-radius:15px;
        display:flex;align-items:center;justify-content:center;margin-bottom:18px;font-size:26px}
  h2{font-size:20px;font-weight:700;color:#0d1117;letter-spacing:-.4px}
  p{font-size:13px;color:#57606a;margin-top:5px;margin-bottom:20px}
  input{width:100%;border:1.5px solid ${wrong?'#ef4444':'#e8ecf0'};border-radius:9px;
        padding:10px 14px;font-size:14px;outline:none;background:#f8fafc;
        color:#0d1117;margin-bottom:12px;transition:border-color .2s}
  input:focus{border-color:#4f46e5;background:#fff}
  button{width:100%;background:#4f46e5;color:#fff;border:none;border-radius:9px;
         padding:11px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
  button:hover{background:#4338ca}
  .err{color:#ef4444;font-size:12px;margin-top:-8px;margin-bottom:10px;display:${wrong?'block':'none'}}
  a{display:block;text-align:center;margin-top:14px;font-size:12px;color:#8b949e;text-decoration:none}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Password Required</h2>
    <p>This page is protected. Enter the password to continue.</p>
    <form method="POST" action="/u/${slug}/auth">
      <input type="password" name="password" placeholder="Enter password" autofocus required>
      <div class="err">Incorrect password. Try again.</div>
      <button type="submit">Unlock Page</button>
    </form>
    <a href="/">← Back to Dropify</a>
  </div>
</body></html>`;
}

// ── Find deploy by slug (scans all users) ─────────────────────────────────────
async function findDeployBySlug(slug) {
  // Fast path: use slug index
  const slugSnap = await get(ref(db, `slugs/${slug}`));
  if (!slugSnap.exists()) return null;
  const { uid, deployId } = slugSnap.val();
  const snap = await get(ref(db, `deploys/${uid}/${deployId}`));
  if (!snap.exists()) return null;
  return { uid, deployId, data: snap.val() };
}

// ── Find project by slug ──────────────────────────────────────────────────────
async function findProjectBySlug(slug) {
  const slugSnap = await get(ref(db, `projectSlugs/${slug}`));
  if (!slugSnap.exists()) return null;
  const { uid, projectId } = slugSnap.val();
  const snap = await get(ref(db, `projects/${uid}/${projectId}`));
  if (!snap.exists()) return null;
  return { uid, projectId, data: snap.val() };
}

// ── Increment view counter ────────────────────────────────────────────────────
async function incrementViews(path) {
  try {
    const snap = await get(ref(db, path + '/views'));
    await set(ref(db, path + '/views'), (snap.val() || 0) + 1);
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES — DEPLOY (/u/:slug)
// ════════════════════════════════════════════════════════════════════════════

// GET /u/:slug — render deploy
app.get("/u/:slug", async (req, res) => {
  try {
    const result = await findDeployBySlug(req.params.slug);
    if (!result) return not404(res, req.params.slug);

    const { uid, deployId, data } = result;

    // Password protection check
    if (data.passwordProtected) {
      const cookie = req.headers.cookie || '';
      const authKey = `dropify_auth_${req.params.slug}`;
      if (!cookie.includes(`${authKey}=ok`)) {
        return res.send(passwordPage(req.params.slug, false));
      }
    }

    // Count view
    await incrementViews(`deploys/${uid}/${deployId}`);

    // Track visit in analytics
    const visitRef = ref(db, `analytics/${uid}/deploys/${deployId}/${Date.now()}`);
    await set(visitRef, { ts: Date.now(), ip: req.ip?.slice(0,10) || 'unknown' });

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(data.html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// POST /u/:slug/auth — password form submit
app.post("/u/:slug/auth", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const result = await findDeployBySlug(req.params.slug);
    if (!result) return not404(res, req.params.slug);

    const { data } = result;
    const entered = req.body.password;

    if (data.password && entered === data.password) {
      const authKey = `dropify_auth_${req.params.slug}`;
      res.set('Set-Cookie', `${authKey}=ok; Path=/; HttpOnly; Max-Age=86400`);
      res.redirect(`/u/${req.params.slug}`);
    } else {
      res.send(passwordPage(req.params.slug, true));
    }
  } catch (err) {
    res.status(500).send("Server error.");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTES — PROJECTS (/p/:slug and /p/:slug/:file)
// ════════════════════════════════════════════════════════════════════════════

// GET /p/:slug — serve project main file
app.get("/p/:slug", async (req, res) => {
  await serveProjectFile(req, res, req.params.slug, null);
});

// GET /p/:slug/* — serve any file in a project
app.get("/p/:slug/*", async (req, res) => {
  const filePath = req.params[0];
  await serveProjectFile(req, res, req.params.slug, filePath);
});

async function serveProjectFile(req, res, slug, filePath) {
  try {
    const result = await findProjectBySlug(slug);
    if (!result) return not404(res, slug);

    const { uid, projectId, data } = result;
    const files = data.files || {};

    // Determine which file to serve
    const target = filePath || data.mainFile || 'index.html';
    const fileContent = files[target];

    if (fileContent === undefined) {
      return res.status(404).send(`File <code>${target}</code> not found in project.`);
    }

    // Increment views only on main file
    if (!filePath) {
      await incrementViews(`projects/${uid}/${projectId}`);
      const visitRef = ref(db, `analytics/${uid}/projects/${projectId}/${Date.now()}`);
      await set(visitRef, { ts: Date.now() });
    }

    // Set content type based on extension
    const ext = target.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      html: 'text/html; charset=utf-8',
      htm: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      json: 'application/json',
      svg: 'image/svg+xml',
      txt: 'text/plain; charset=utf-8',
      xml: 'application/xml',
    };
    res.set('Content-Type', mimeTypes[ext] || 'text/plain; charset=utf-8');
    res.send(fileContent);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// API — ANALYTICS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/analytics/:uid — get analytics for a user
app.get("/api/analytics/:uid", async (req, res) => {
  try {
    const snap = await get(ref(db, `analytics/${req.params.uid}`));
    res.json(snap.exists() ? snap.val() : {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK — serve frontend SPA
// ════════════════════════════════════════════════════════════════════════════
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

// ── Export for Vercel serverless ──────────────────────────────────────────────
module.exports = app;
