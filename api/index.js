const express = require("express");
const cors = require("cors");
const { initializeApp, getApps } = require("firebase/app");
const { getDatabase, ref, set, get, push, remove } = require("firebase/database");

// ── Firebase Init (singleton — Vercel serverless me zaroori hai) ──────────────
const firebaseConfig = {
  apiKey: "AIzaSyBnz1UbLyz0f6t83D2222XlmKNhKLdFzQM",
  authDomain: "digit-product.firebaseapp.com",
  databaseURL: "https://digit-product-default-rtdb.firebaseio.com",
  projectId: "digit-product",
  storageBucket: "digit-product.firebasestorage.app",
  messagingSenderId: "866989324771",
  appId: "1:866989324771:web:922bcc61814ab6cd6d88d6",
};

const firebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];

const db = getDatabase(firebaseApp);

// ── Express Setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ── Helper: Short random ID ───────────────────────────────────────────────────
function generateId(len = 7) {
  return Math.random().toString(36).substring(2, 2 + len);
}

// ── Helper: Basic script stripping ───────────────────────────────────────────
function stripScripts(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
}

// ── POST /api/save ────────────────────────────────────────────────────────────
app.post("/api/save", async (req, res) => {
  try {
    const { html, title, sanitize } = req.body;
    if (!html?.trim()) return res.status(400).json({ error: "HTML is required." });

    const finalHtml = sanitize ? stripScripts(html) : html;
    const pageId = generateId();

    await set(ref(db, `htmlhost/pages/${pageId}`), {
      html: finalHtml,
      title: title?.trim() || "Untitled Page",
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      pageId,
      url: `/u/${pageId}`,
      fullUrl: `https://${req.headers.host}/u/${pageId}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Save failed. Check Firebase rules." });
  }
});

// ── GET /api/pages ────────────────────────────────────────────────────────────
app.get("/api/pages", async (req, res) => {
  try {
    const snap = await get(ref(db, "htmlhost/pages"));
    if (!snap.exists()) return res.json([]);

    const pages = [];
    snap.forEach((child) => {
      const v = child.val();
      pages.push({
        id: child.key,
        title: v.title,
        createdAt: v.createdAt,
        url: `/u/${child.key}`,
      });
    });

    pages.sort((a, b) => b.createdAt - a.createdAt);
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch pages." });
  }
});

// ── GET /api/pages/:id ────────────────────────────────────────────────────────
app.get("/api/pages/:id", async (req, res) => {
  try {
    const snap = await get(ref(db, `htmlhost/pages/${req.params.id}`));
    if (!snap.exists()) return res.status(404).json({ error: "Not found." });
    res.json(snap.val());
  } catch (err) {
    res.status(500).json({ error: "Fetch failed." });
  }
});

// ── DELETE /api/pages/:id ─────────────────────────────────────────────────────
app.delete("/api/pages/:id", async (req, res) => {
  try {
    await remove(ref(db, `htmlhost/pages/${req.params.id}`));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Delete failed." });
  }
});

// ── GET /u/:pageId  — Render saved HTML ───────────────────────────────────────
app.get("/u/:pageId", async (req, res) => {
  try {
    const snap = await get(ref(db, `htmlhost/pages/${req.params.pageId}`));

    if (!snap.exists()) {
      return res.status(404).send(`<!DOCTYPE html><html><head>
        <title>404</title>
        <style>body{font-family:monospace;display:flex;align-items:center;
        justify-content:center;height:100vh;margin:0;background:#0f0f0f;
        color:#ff4444;flex-direction:column;gap:12px;}
        a{color:#888;text-decoration:none;}a:hover{color:#fff;}</style>
        </head><body>
        <h1>404</h1><p>Page <code>${req.params.pageId}</code> not found.</p>
        <a href="/">← Dashboard</a></body></html>`);
    }

    res.send(snap.val().html);
  } catch (err) {
    res.status(500).send("Server error.");
  }
});

// ── Export for Vercel ─────────────────────────────────────────────────────────
module.exports = app;
