const express = require("express");
const cors = require("cors");
const { initializeApp, getApps } = require("firebase/app");
const { getDatabase, ref, get, set } = require("firebase/database");

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
app.use(express.urlencoded({ extended: false }));

// ── Helpers ───────────────────────────────────────────────────────────────────
function page404(res, slug) {
  return res.status(404).send(`<!DOCTYPE html>
<html><head><title>404 — Dropify</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',sans-serif;background:#f8fafc;display:flex;
       align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .box{text-align:center;max-width:400px}
  .icon{width:72px;height:72px;background:#eef2ff;border-radius:20px;
        display:flex;align-items:center;justify-content:center;
        margin:0 auto 20px;font-size:32px}
  h1{font-size:48px;font-weight:800;color:#0d1117;letter-spacing:-2px}
  p{color:#57606a;font-size:15px;margin-top:8px;line-height:1.5}
  code{font-family:monospace;background:#f1f5f9;padding:2px 7px;
       border-radius:5px;font-size:13px;color:#4f46e5}
  a{display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;
    text-decoration:none;border-radius:9px;padding:10px 22px;
    font-size:14px;font-weight:600}
</style></head>
<body><div class="box">
  <div class="icon">⚡</div>
  <h1>404</h1>
  <p>Page <code>${String(slug).replace(/</g,"&lt;")}</code> not found or removed.</p>
  <a href="/">← Back to Dropify</a>
</div></body></html>`);
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
  .icon{font-size:32px;margin-bottom:14px}
  h2{font-size:20px;font-weight:700;color:#0d1117}
  p{font-size:13px;color:#57606a;margin:6px 0 20px}
  input{width:100%;border:1.5px solid ${wrong ? "#ef4444" : "#e8ecf0"};
        border-radius:9px;padding:10px 14px;font-size:14px;outline:none;
        background:#f8fafc;color:#0d1117;margin-bottom:10px}
  input:focus{border-color:#4f46e5}
  button{width:100%;background:#4f46e5;color:#fff;border:none;border-radius:9px;
         padding:11px;font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#ef4444;font-size:12px;margin-bottom:10px;
       display:${wrong ? "block" : "none"}}
  a{display:block;text-align:center;margin-top:14px;font-size:12px;color:#8b949e;
    text-decoration:none}
</style></head>
<body><div class="card">
  <div class="icon">🔒</div>
  <h2>Password Required</h2>
  <p>This page is protected. Enter the password to continue.</p>
  <form method="POST" action="/u/${slug}/auth">
    <input type="password" name="password" placeholder="Enter password" autofocus required>
    <div class="err">Incorrect password. Try again.</div>
    <button type="submit">Unlock Page</button>
  </form>
  <a href="/">← Back to Dropify</a>
</div></body></html>`;
}

// ── Find deploy by slug ───────────────────────────────────────────────────────
async function findDeployBySlug(slug) {
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

// ── Increment views ───────────────────────────────────────────────────────────
async function incrementViews(dbPath) {
  try {
    const snap = await get(ref(db, dbPath + "/views"));
    await set(ref(db, dbPath + "/views"), (snap.val() || 0) + 1);
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
// DEPLOY ROUTES  /u/:slug
// ════════════════════════════════════════════════════════════════════════════

app.get("/u/:slug", async (req, res) => {
  try {
    const result = await findDeployBySlug(req.params.slug);
    if (!result) return page404(res, req.params.slug);

    const { uid, deployId, data } = result;

    // Password gate
    if (data.passwordProtected) {
      const cookie = req.headers.cookie || "";
      if (!cookie.includes(`dropify_auth_${req.params.slug}=ok`)) {
        return res.send(passwordPage(req.params.slug, false));
      }
    }

    await incrementViews(`deploys/${uid}/${deployId}`);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(data.html);
  } catch (err) {
    console.error("GET /u/:slug error:", err.message);
    res.status(500).send("Server error: " + err.message);
  }
});

app.post("/u/:slug/auth", async (req, res) => {
  try {
    const result = await findDeployBySlug(req.params.slug);
    if (!result) return page404(res, req.params.slug);

    const { data } = result;
    if (data.password && req.body.password === data.password) {
      res.set("Set-Cookie",
        `dropify_auth_${req.params.slug}=ok; Path=/; HttpOnly; Max-Age=86400`);
      return res.redirect(`/u/${req.params.slug}`);
    }
    res.send(passwordPage(req.params.slug, true));
  } catch (err) {
    res.status(500).send("Server error: " + err.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROJECT ROUTES  /p/:slug  and  /p/:slug/*
// ════════════════════════════════════════════════════════════════════════════

const MIME = {
  html: "text/html; charset=utf-8",
  htm:  "text/html; charset=utf-8",
  css:  "text/css; charset=utf-8",
  js:   "application/javascript; charset=utf-8",
  json: "application/json",
  svg:  "image/svg+xml",
  txt:  "text/plain; charset=utf-8",
  xml:  "application/xml",
};


// ── Encode/decode file keys (mirrors frontend logic) ─────────────────────────
function encodeKey(name) {
  return name
    .replace(/\./g,  '__dot__')
    .replace(/#/g,   '__hash__')
    .replace(/\$/g,  '__dollar__')
    .replace(/\//g,  '__slash__')
    .replace(/\[/g,  '__lb__')
    .replace(/\]/g,  '__rb__');
}

function decodeKey(key) {
  return key
    .replace(/__dot__/g,    '.')
    .replace(/__hash__/g,   '#')
    .replace(/__dollar__/g, '$')
    .replace(/__slash__/g,  '/')
    .replace(/__lb__/g,     '[')
    .replace(/__rb__/g,     ']');
}

async function serveProject(req, res, slug, filePath) {
  try {
    const result = await findProjectBySlug(slug);
    if (!result) return page404(res, slug);

    const { uid, projectId, data } = result;
    const files = data.files || {};
    const rawTarget = filePath || (data.mainFile ? decodeKey(data.mainFile) : "index.html");
    const target = encodeKey(rawTarget);

    if (!(target in files)) {
      return res.status(404).send(`File <code>${rawTarget}</code> not found in project.`);
    }

    if (!filePath) await incrementViews(`projects/${uid}/${projectId}`);

    // Use rawTarget (decoded name like "index.html") to get correct extension
    const ext = rawTarget.split(".").pop()?.toLowerCase();
    res.set("Content-Type", MIME[ext] || "text/plain; charset=utf-8");
    res.send(files[target]);
  } catch (err) {
    console.error("Project serve error:", err.message);
    res.status(500).send("Server error: " + err.message);
  }
}

app.get("/p/:slug", (req, res) =>
  serveProject(req, res, req.params.slug, null));

app.get("/p/:slug/*", (req, res) =>
  serveProject(req, res, req.params.slug, req.params[0]));

// ════════════════════════════════════════════════════════════════════════════
// EXPORT — Vercel serverless entry point
// ════════════════════════════════════════════════════════════════════════════
module.exports = app;
