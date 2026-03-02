const express = require("express");
const fs = require("fs");
const path = require("path");
// Robust Jimp Import
let JimpPkg = require("jimp");
const Jimp = JimpPkg.Jimp || JimpPkg; // Handle default or named export
const { exec } = require("child_process");
const crypto = require("crypto");
const multer = require('multer');
require('dotenv').config();
const { login, register, logAction, verifyToken, isSuperAdmin, getSettings } = require('./auth');
const db = require('./database');
const { metaRequest } = require('./meta_api');
const { runWorker } = require('./worker');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});
const upload = multer({ storage });

app.use(express.json({ limit: "100mb" }));
app.use("/ui", express.static(path.join(__dirname, "ui")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const fs = require('fs');

let ACT_ROOT = "/app/your_instagram_activity";
if (!fs.existsSync(ACT_ROOT)) {
  ACT_ROOT = path.join(__dirname, "your_instagram_activity");
}
if (!fs.existsSync(ACT_ROOT)) {
  ACT_ROOT = path.join(__dirname, "data", "your_instagram_activity");
}

let ACT = path.join(ACT_ROOT, "media");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
const MEDIA_BASE_URL = `${PUBLIC_BASE_URL}/media`;

// Standard Static Middleware for Media (Hardcoded absolute path)
app.use("/media", express.static("/app/your_instagram_activity/media", {
  index: false,
  fallthrough: true
}));

// ---------------- UI Routes ----------------
app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "ui", "login.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "ui", "index.html")));
app.get("/haber-gonder", (req, res) => res.sendFile(path.join(__dirname, "ui", "haber_gonder.html")));

// ---------------- Auth API ----------------
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || '';
  try {
    const data = await login(email, password, ip);
    res.json(data);
  } catch (err) { res.status(401).json({ error: err }); }
});

app.post("/api/admin/users", verifyToken, isSuperAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const data = await register(name, email, password, role, req.user.id);
    res.json({ ok: true, ...data });
  } catch (err) { res.status(400).json({ error: err }); }
});

app.get("/api/auth/me", verifyToken, (req, res) => {
  db.get('SELECT id, name, email, role, avatar_url, iban, earnings_balance, created_at FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

// ---------------- User Management API (Admin Only) ----------------
app.get("/api/admin/users", verifyToken, isSuperAdmin, (req, res) => {
  db.all(`SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete("/api/admin/users/:id", verifyToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: "Kendinizi silemezsiniz" });

  db.run(`DELETE FROM users WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user.id, 'USER_DELETED', `Kullanıcı Silindi (ID: ${id})`, req.ip, 'SUCCESS');
    res.json({ ok: true });
  });
});

app.get("/api/admin/users/:id/details", verifyToken, isSuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, name, email, role, iban, created_at, earnings_balance FROM users WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const recentLogs = await new Promise((resolve, reject) => {
      db.all('SELECT action, details, status, created_at FROM logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [id], (err, rows) => err ? reject(err) : resolve(rows));
    });

    const tasks = await new Promise((resolve, reject) => {
      db.all('SELECT id, title, status, due_date FROM tasks WHERE assigned_to = ? ORDER BY created_at DESC LIMIT 10', [id], (err, rows) => err ? reject(err) : resolve(rows));
    });

    res.json({ user, recentLogs, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/users/:id", verifyToken, isSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, iban, password } = req.body;

  if (!name || !email) return res.status(400).json({ error: "İsim ve Email zorunludur." });

  try {
    let query = `UPDATE users SET name = ?, email = ?, role = ?, iban = ?`;
    let params = [name, email, role || 'editor', iban || null];

    if (password && password.length >= 6) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      query += `, password_hash = ?`;
      params.push(hash);
    }

    query += ` WHERE id = ?`;
    params.push(id);

    db.run(query, params, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
      logAction(req.user.id, 'SYSTEM', `Admin kullanıcıyı düzenledi. (ID: ${id})`, req.ip, 'SUCCESS');
      res.json({ ok: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---------------- Utils & Data Processing ----------------
function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, { encoding: "utf8" })); } catch (e) { return null; } }
function listJsonFiles(dir) { try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json")); } catch { return []; } }
function decodeLiteralUnicodeEscapes(s) { if (typeof s !== "string") return s; return s.includes("\\u") ? s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s; }
function fixMojibakeTR(s) { if (typeof s !== "string") return s; if (/[ÃÄÅ]/.test(s)) { try { return Buffer.from(s, "latin1").toString("utf8"); } catch (_) { return s; } } return s; }
function normalizeTRText(s) { return fixMojibakeTR(decodeLiteralUnicodeEscapes(s)); }

function flattenAnyMedia(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  const maybeUri = obj.uri || obj.path || obj.file_path || obj.media_uri || obj.video_uri || obj.photo_uri;
  if (typeof maybeUri === "string" && maybeUri.includes("media/")) out.push(maybeUri);
  if (Array.isArray(obj.media)) obj.media.forEach(m => flattenAnyMedia(m, out));
  Object.values(obj).forEach(v => { if (v && typeof v === "object") flattenAnyMedia(v, out); });
  return out;
}

function guessCaption(obj) {
  const candidates = [obj.caption, obj.title, obj.text, obj.description, obj.string_map_data?.Caption?.value, obj.string_map_data?.caption?.value];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return normalizeTRText(c.trim());
  return "";
}

function guessTimestamp(obj) {
  const candidates = [obj.creation_timestamp, obj.creation_time, obj.taken_at, obj.timestamp, obj.string_map_data?.Time?.timestamp, obj.string_map_data?.time?.timestamp];
  for (const c of candidates) if (typeof c === "number" && c > 0) return c;
  return 0;
}

function mediaUrlFromLocalUri(localUri) {
  const cleaned = localUri.startsWith("/") ? localUri.slice(1) : localUri;
  const afterMedia = cleaned.startsWith("media/") ? cleaned.slice(6) : cleaned;
  return `${MEDIA_BASE_URL}/${afterMedia}`;
}

function buildLibrary() {
  const files = listJsonFiles(ACT_ROOT);
  const items = [];
  const priority = (n) => n.toLowerCase().includes("reel") ? 1 : (n.toLowerCase().includes("post") ? 2 : (n.toLowerCase().includes("stories") ? 3 : 9));
  files.sort((a, b) => priority(a) - priority(b));
  for (const f of files) {
    const data = readJsonSafe(path.join(ACT_ROOT, f));
    if (!data) continue;
    const arrays = Array.isArray(data) ? [data] : [...Object.values(data).filter(Array.isArray), data.media].filter(Boolean);
    for (const arr of arrays) {
      for (const raw of arr) {
        const uris = [...new Set(flattenAnyMedia(raw, []))];
        if (!uris.length) continue;
        const ts = guessTimestamp(raw);
        let type = uris.length > 1 ? "CAROUSEL" : "POST";
        if (f.toLowerCase().includes("reel")) type = "REEL";
        else if (f.toLowerCase().includes("stories")) type = "STORY";
        items.push({
          id: crypto.createHash("sha1").update(`${f}|${ts}|${uris.join("|")}`).digest("hex"),
          type, created_at: ts ? new Date(ts * 1000).toISOString() : null,
          caption: normalizeTRText(guessCaption(raw)),
          media: uris.map(u => ({ local: u, url: mediaUrlFromLocalUri(u), kind: u.match(/\.(mp4|mov|avi|mkv)$/i) ? "video" : "photo" })),
          cover_url: mediaUrlFromLocalUri(uris[0])
        });
      }
    }
  }
  return items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

// ---------------- API Endpoints ----------------
app.post("/api/public/haber-gonder", express.json(), (req, res) => {
  const { fullname, title, description, media_urls } = req.body;

  if (!fullname || !title || !description) {
    return res.status(400).json({ error: "Lütfen ad soyad, başlık ve açıklama alanlarını doldurun." });
  }

  const mediaUrlsJson = JSON.stringify(media_urls || []);

  db.run(`INSERT INTO submitted_news (fullname, title, description, media_urls, status) VALUES (?, ?, ?, ?, 'pending')`,
    [fullname, title, description, mediaUrlsJson], function (err) {
      if (err) return res.status(500).json({ error: "Veritabanı hatası oluştu." });
      res.json({ ok: true, message: "Haber başarıyla gönderildi." });
    });
});

// ---------------- Tasks Modülü (To-Do) ----------------
app.post("/api/tasks", verifyToken, (req, res) => {
  const { title, description, assigned_to, due_date } = req.body;
  if (!title) return res.status(400).json({ error: "Görev başlığı zorunludur." });

  const assignTo = req.user.role === "super_admin" && assigned_to ? assigned_to : req.user.id;

  db.run(`INSERT INTO tasks (title, description, assigned_by, assigned_to, due_date) VALUES (?, ?, ?, ?, ?)`,
    [title, description || '', req.user.id, assignTo, due_date || null], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id: this.lastID });
    });
});

app.get("/api/tasks/me", verifyToken, (req, res) => {
  db.all(`SELECT * FROM tasks WHERE assigned_to = ? ORDER BY created_at DESC`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/admin/tasks", verifyToken, isSuperAdmin, (req, res) => {
  db.all(`SELECT t.*, u1.name as assigned_by_name, u2.name as assigned_to_name 
          FROM tasks t 
          LEFT JOIN users u1 ON t.assigned_by = u1.id 
          LEFT JOIN users u2 ON t.assigned_to = u2.id 
          ORDER BY t.created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put("/api/tasks/:id/status", verifyToken, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: "Geçersiz görev durumu." });
  }

  const query = req.user.role === "super_admin"
    ? `UPDATE tasks SET status = ? WHERE id = ?`
    : `UPDATE tasks SET status = ? WHERE id = ? AND assigned_to = ?`;

  const params = req.user.role === "super_admin" ? [status, req.params.id] : [status, req.params.id, req.user.id];

  db.run(query, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Görev bulunamadı veya yetkiniz yok." });
    res.json({ ok: true });
  });
});

app.delete("/api/tasks/:id", verifyToken, (req, res) => {
  const query = req.user.role === "super_admin"
    ? `DELETE FROM tasks WHERE id = ?`
    : `DELETE FROM tasks WHERE id = ? AND assigned_by = ?`;

  const params = req.user.role === "super_admin" ? [req.params.id] : [req.params.id, req.user.id];

  db.run(query, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Görev bulunamadı veya yetkiniz yok." });
    res.json({ ok: true });
  });
});

// ---------------- Submitted News ----------------
app.get("/api/admin/submitted-news", verifyToken, (req, res) => {
  db.all(`SELECT * FROM submitted_news ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // Parse media_urls back into object arrays for frontend
    rows.forEach(r => {
      try {
        r.media_urls = JSON.parse(r.media_urls || "[]");
      } catch (e) {
        r.media_urls = [];
      }
    });
    res.json(rows);
  });
});

app.post("/api/admin/submitted-news", verifyToken, isSuperAdmin, (req, res) => {
  const { fullname, title, description, media_urls, status } = req.body;
  const mediaJson = typeof media_urls === 'string' ? media_urls : JSON.stringify(media_urls || []);

  db.run(`INSERT INTO submitted_news (fullname, title, description, media_urls, status) VALUES (?, ?, ?, ?, ?)`,
    [fullname, title, description, mediaJson, status || 'pending'], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id: this.lastID });
    });
});

app.put("/api/admin/submitted-news/:id", verifyToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { fullname, title, description, status } = req.body;
  db.run(`UPDATE submitted_news SET fullname = ?, title = ?, description = ?, status = ? WHERE id = ?`,
    [fullname, title, description, status, id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Haber bulunamadı" });
      res.json({ ok: true });
    });
});

app.delete("/api/admin/submitted-news/:id", verifyToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM submitted_news WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Haber bulunamadı" });
    res.json({ ok: true });
  });
});

app.get("/api/download", verifyToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("URL required");
  try {
    const fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error("Could not fetch file");

    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('video') ? 'mp4' : 'jpg';
    const filename = url.split('/').pop().split('?')[0] || `instaapp_download.${ext}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const { Readable } = require('stream');
    Readable.fromWeb(fileRes.body).pipe(res);
  } catch (err) {
    console.error("Download Error:", err);
    res.status(500).send("İndirme başarısız oldu.");
  }
});

app.get("/api/library", verifyToken, async (req, res) => {
  const { type, page, limit } = req.query;
  let items = buildLibrary();
  if (type) items = items.filter(x => x.type === type.toUpperCase());

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 30;

  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const endIndex = startIndex + limitNum;

  const paginatedItems = items.slice(startIndex, endIndex);

  res.json({
    items: paginatedItems,
    pagination: {
      totalItems,
      totalPages,
      currentPage: pageNum,
      limit: limitNum
    }
  });
});

app.post("/api/library/update-caption", verifyToken, async (req, res) => {
  const { itemId, newCaption } = req.body;
  // Not persisting to raw JSON as they are source files, but we log it.
  logAction(req.user.id, 'CAPTION_EDITED', `ID: ${itemId}, New: ${newCaption}`, req.ip, 'INFO');
  res.json({ ok: true });
});

app.get("/api/admin/settings", verifyToken, isSuperAdmin, async (req, res) => {
  try { res.json(await getSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/settings", verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) {
      await new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, [k, v], function (err) {
          if (err) reject(err);
          else resolve();
        });
      });
      // Additional tracking for bonus date logic
      if (k === 'bonus_per_100_likes') {
        await new Promise((resolve, reject) => {
          db.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('bonus_per_100_likes_updated_at', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [], function (err) {
            if (err) reject(err); else resolve();
          });
        });
      }
    }
    logAction(req.user.id, 'SETTINGS_UPDATED', `API Ayarları Güncellendi`, req.ip, 'SUCCESS');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/test-connection", verifyToken, isSuperAdmin, async (req, res) => {
  const { META_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID } = req.body;
  if (!META_ACCESS_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) return res.status(400).json({ error: "Token ve ID gerekli" });

  try {
    const url = `https://graph.facebook.com/v24.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=name,username&access_token=${META_ACCESS_TOKEN}`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    if (data.error) throw new Error(data.error.message);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/logs", verifyToken, isSuperAdmin, (req, res) => {
  const { user_id, action, status, start_date, end_date } = req.query;

  let query = `SELECT logs.*, users.name as user_name FROM logs LEFT JOIN users ON logs.user_id = users.id WHERE 1=1`;
  const params = [];

  if (user_id) { query += ` AND logs.user_id = ?`; params.push(user_id); }
  if (action) { query += ` AND logs.action = ?`; params.push(action); }
  if (status) { query += ` AND logs.status = ?`; params.push(status); }
  if (start_date) { query += ` AND date(logs.created_at) >= date(?)`; params.push(start_date); }
  if (end_date) { query += ` AND date(logs.created_at) <= date(?)`; params.push(end_date); }

  query += ` ORDER BY logs.created_at DESC LIMIT 500`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/auth/update-password", verifyToken, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Şifre en az 6 karakter olmalıdır" });
  try {
    const { updatePassword } = require('./auth');
    await updatePassword(req.user.id, newPassword);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/profile/update", verifyToken, async (req, res) => {
  const { name, iban } = req.body;
  if (!name) return res.status(400).json({ error: "İsim gerekli" });
  try {
    const { updateProfile } = require('./auth');
    await updateProfile(req.user.id, { name });

    // Update IBAN in DB directly if provided
    if (iban !== undefined) {
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET iban = ? WHERE id = ?', [iban, req.user.id], err => err ? reject(err) : resolve());
      });
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/profile/avatar", verifyToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya yüklenemedi" });

  const finalPath = req.file.path;
  let publicUrl = `${PUBLIC_BASE_URL}/uploads/${req.file.filename}`;

  try {
    const util = require('util');
    const exec = util.promisify(require('child_process').exec);
    const { stdout } = await exec(`curl -s -F "reqtype=fileupload" -F "fileToUpload=@${finalPath}" https://catbox.moe/user/api.php`);
    if (stdout.startsWith('http')) publicUrl = stdout.trim();
  } catch (err) {
    console.error("[Avatar Catbox] Failed:", err);
  }

  try {
    const { updateProfile } = require('./auth');
    await updateProfile(req.user.id, { name: req.user.name, avatar_url: publicUrl });
    res.json({ ok: true, avatar_url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Meta Engine ----------------
const { waitForVideo } = require('./meta_api');

app.post("/api/upload", verifyToken, upload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Dosya yüklenemedi" });

  const results = [];
  for (const f of req.files) {
    let finalFilename = f.filename;
    let finalMime = f.mimetype;
    let finalPath = f.path;

    // Robust check: Is it an image that needs conversion?
    // Check mimetype OR extension
    const isImage = f.mimetype.startsWith('image/') || f.filename.match(/\.(png|webp|bmp|tiff|gif|jpg|jpeg)$/i);

    if (isImage) {
      try {
        const image = await Jimp.read(f.path);
        const newFilename = f.filename.replace(/\.[^/.]+$/, "") + "_c.jpg";
        const newPath = path.join(f.destination, newFilename);
        await image.write(newPath);
        finalFilename = newFilename;
        finalPath = newPath;
        finalMime = 'image/jpeg';
      } catch (e) {
        console.error("[Upload Debug] Image conversion failed:", e);
      }
    }

    let publicUrl = `${PUBLIC_BASE_URL}/uploads/${finalFilename}`;
    try {
      const util = require('util');
      const exec = util.promisify(require('child_process').exec);
      console.log(`[Proxy] Uploading ${finalPath} to uguu.se ...`);
      const { stdout } = await exec(`curl -s -F "files[]=@${finalPath}" https://uguu.se/upload.php`);
      const data = JSON.parse(stdout);
      if (data.success && data.files && data.files[0]) {
        publicUrl = data.files[0].url;
      }
      console.log(`[Proxy] Success: ${publicUrl}`);
    } catch (err) {
      console.error("[Proxy] Failed to upload proxy:", err.message || err);
    }

    results.push({
      url: publicUrl,
      filename: finalFilename,
      kind: finalMime.startsWith('video') || finalFilename.match(/\.(mp4|mov|avi|mkv)$/i) ? 'video' : 'photo'
    });
  }
  res.json({ ok: true, media: results });
});

app.post("/api/share", verifyToken, async (req, res) => {
  const { itemId, caption, customMedia, format } = req.body;
  let mediaList = [];

  if (customMedia && customMedia.length > 0) {
    mediaList = customMedia;
  } else if (itemId) {
    const item = buildLibrary().find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: "İçerik bulunamadı" });
    mediaList = item.media;
  } else {
    return res.status(400).json({ error: "Lütfen paylaşılacak içerik seçin" });
  }

  // UGUU PROXY: Fix old library URLs on-the-fly
  for (let m of mediaList) {
    if ((m.url.includes('168.231.125.93') || m.url.includes('localhost')) && !m.url.includes('uguu.se')) {
      const filename = m.url.split('/').pop();
      const localPath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(localPath)) {
        try {
          const util = require('util');
          const exec = util.promisify(require('child_process').exec);
          console.log(`[Proxy] Rehosing ${filename} to uguu.se...`);
          const { stdout } = await exec(`curl -s -F "files[]=@${localPath}" https://uguu.se/upload.php`);
          const data = JSON.parse(stdout);
          if (data.success && data.files && data.files[0]) {
            m.url = data.files[0].url;
          }
        } catch (e) {
          console.error("[Proxy Error]", e.message || e);
        }
      }
    }
  }

  const settings = await getSettings();
  const bid = settings.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!bid) return res.status(400).json({ error: "Business ID eksik" });

  if (settings.N8N_WEBHOOK_URL && mediaList.length === 1) {
    logAction(req.user.id, 'SHARE_STARTED', `Sharing via n8n...`, req.ip, 'INFO');
    const m = mediaList[0];
    const isVideo = m.kind === 'video' || (typeof m.url === 'string' && m.url.match(/\.(mp4|mov|avi|mkv)$/i));

    // DIRECT CURL IMPLEMENTATION (Bypassing n8n and node-fetch)
    const containerParams = {
      access_token: settings.META_ACCESS_TOKEN,
      caption: caption || "",
      [isVideo ? 'video_url' : 'image_url']: m.url,
      media_type: isVideo ? 'VIDEO' : 'IMAGE'
    };

    // Step 1: Create Container
    const urlCreate = `https://graph.facebook.com/v24.0/${bid}/media`;
    let cmdCreate = `curl -s -X POST "${urlCreate}" -H "Content-Type: application/json"`;
    cmdCreate += ` -d '${JSON.stringify(containerParams).replace(/'/g, "'\\''")}'`;

    logAction(req.user.id, 'SHARE_STARTED', `Step 1: Creating Container...`, req.ip, 'INFO');

    exec(cmdCreate, async (err1, stdout1, stderr1) => {
      if (err1) {
        console.error("Step 1 Exec Error:", stderr1);
        logAction(req.user.id, 'SHARE_ERROR', `Step 1 Failed: ${stderr1}`, req.ip, 'ERROR');
        return res.status(500).json({ error: "Container Yaratma Hatası: " + stderr1 });
      }

      try {
        const res1 = JSON.parse(stdout1);
        if (res1.error) {
          console.error("Meta API Step 1 Error:", JSON.stringify(res1.error));
          logAction(req.user.id, 'SHARE_ERROR', `Meta API Error (Step 1): ${res1.error.message}`, req.ip, 'ERROR');
          return res.status(400).json({ error: "Meta Hatası: " + res1.error.message });
        }

        const containerId = res1.id;
        logAction(req.user.id, 'SHARE_PROGRESS', `Container Created: ${containerId}`, req.ip, 'INFO');

        // Step 2: Wait for processing (Crucial for videos, helpful for images)
        if (isVideo) {
          await new Promise(r => setTimeout(r, 10000)); // 10 sec for video
          // Optional: Implement status check loop here if needed
        } else {
          await new Promise(r => setTimeout(r, 3000)); // 3 sec for image
        }

        // Step 3: Publish
        const publishParams = {
          access_token: settings.META_ACCESS_TOKEN,
          creation_id: containerId
        };

        const urlPublish = `https://graph.facebook.com/v24.0/${bid}/media_publish`;
        let cmdPublish = `curl -s -X POST "${urlPublish}" -H "Content-Type: application/json"`;
        cmdPublish += ` -d '${JSON.stringify(publishParams).replace(/'/g, "'\\''")}'`;

        exec(cmdPublish, (err2, stdout2, stderr2) => {
          if (err2) {
            console.error("Step 3 Exec Error:", stderr2);
            logAction(req.user.id, 'SHARE_ERROR', `Step 3 Failed: ${stderr2}`, req.ip, 'ERROR');
            return res.status(500).json({ error: "Yayınlama Hatası: " + stderr2 });
          }

          try {
            const res2 = JSON.parse(stdout2);
            if (res2.error) {
              console.error("Meta API Step 3 Error:", JSON.stringify(res2.error));
              logAction(req.user.id, 'SHARE_ERROR', `Meta API Error (Step 3): ${res2.error.message}`, req.ip, 'ERROR');
              return res.status(400).json({ error: "Yayınlama Hatası: " + res2.error.message });
            }

            logAction(req.user.id, 'SHARE_SUCCESS', `Published: ${res2.id}`, req.ip, 'SUCCESS');

            // Editör ise Kazanç Kaydet
            if (req.user.role === 'editor') {
              const fee = parseFloat(settings.fee_per_post || 5);
              db.serialize(() => {
                db.run("INSERT INTO wallet_transactions (user_id, amount, type, description, post_id) VALUES (?, ?, 'EARNING', ?, ?)",
                  [req.user.id, fee, `Haber Paylaşım Ücreti (Post ID: ${res2.id})`, res2.id]);
                db.run("UPDATE users SET earnings_balance = earnings_balance + ? WHERE id = ?", [fee, req.user.id]);
              });
            }

            res.json({ ok: true, id: res2.id });

          } catch (e2) {
            logAction(req.user.id, 'SHARE_ERROR', `Parse Error Step 3: ${stdout2}`, req.ip, 'ERROR');
            res.status(500).json({ error: "Yayınlama Yanıtı Okunamadı" });
          }
        });

      } catch (e1) {
        console.error("Parse Error Step 1:", e1, stdout1);
        logAction(req.user.id, 'SHARE_ERROR', `Parse Error Step 1: ${e1.message}`, req.ip, 'ERROR');
        res.status(500).json({ error: "Container Yanıtı Okunamadı" });
      }
    });
    return;
  }

  try {
    logAction(req.user.id, 'SHARE_STARTED', `ID: ${itemId || 'CUSTOM'}`, req.ip, 'INFO');
    let finalContainerId;

    if (mediaList.length > 1) {
      const childrenIds = [];
      for (const m of mediaList) {
        const isVideo = m.kind === 'video' || (typeof m.url === 'string' && m.url.match(/\.(mp4|mov|avi|mkv)$/i));
        const p = {
          is_carousel_item: true,
          media_type: isVideo ? 'VIDEO' : 'IMAGE',
          [isVideo ? 'video_url' : 'image_url']: m.url
        };
        const child = await metaRequest(`${bid}/media`, p);
        if (isVideo) await waitForVideo(child.id);
        childrenIds.push(child.id);
      }
      const carouselPayload = {
        media_type: 'CAROUSEL',
        caption: caption || "",
        children: childrenIds.join(',')
      };
      const carouselRes = await metaRequest(`${bid}/media`, carouselPayload);
      finalContainerId = carouselRes.id;
    } else {
      const m = mediaList[0];
      const isVideo = m.kind === 'video' || (typeof m.url === 'string' && m.url.match(/\.(mp4|mov|avi|mkv)$/i));
      const params = {
        caption: caption || "",
        [isVideo ? 'video_url' : 'image_url']: m.url,
        media_type: isVideo ? 'VIDEO' : 'IMAGE'
      };
      if (isVideo && (caption || "").toLowerCase().includes("#reel")) params.media_type = 'REELS';

      const container = await metaRequest(`${bid}/media`, params);
      if (isVideo) await waitForVideo(container.id);
      finalContainerId = container.id;
    }

    if (!finalContainerId) {
      throw new Error("Container oluşturulamadı.");
    }

    // Always wait a few seconds before publishing (Meta bug prevention)
    console.log(`[Share Debug] Container Created: ${finalContainerId}, waiting 4s before publish...`);
    await new Promise(r => setTimeout(r, 4000));

    const publish = await metaRequest(`${bid}/media_publish`, { creation_id: finalContainerId });

    if (customMedia) {
      customMedia.forEach(m => {
        if (m.filename) {
          const p = path.join(uploadDir, m.filename);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      });
    }

    // --- EARNINGS LOGIC ---
    if (req.user.role === 'editor') {
      const fee = parseFloat(settings.fee_per_post || 5);
      if (fee > 0) {
        db.serialize(() => {
          db.run(`UPDATE users SET earnings_balance = earnings_balance + ? WHERE id = ?`, [fee, req.user.id]);
          db.run(`INSERT INTO wallet_transactions (user_id, amount, type, description, post_id, check_status) VALUES (?, ?, 'EARNING', ?, ?, 'pending')`,
            [req.user.id, fee, 'İçerik Paylaşımı', publish.id]);
        });
      }
    }

    // Fetch permalink for better logging
    let permalink = "";
    try {
      const mediaInfo = await metaRequest(publish.id, { fields: 'permalink' }, 'GET');
      permalink = mediaInfo.permalink;
    } catch (e) {
      console.warn("[Media Info] Could not fetch permalink:", e.message);
    }

    logAction(req.user.id, 'SHARE_SUCCESS', `IG: ${permalink || publish.id}`, req.ip, 'SUCCESS');
    res.json({ ok: true, id: publish.id, url: permalink });
  } catch (err) {
    logAction(req.user.id, 'SHARE_ERROR', err.message, req.ip, 'ERROR');
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/download", verifyToken, async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: "URL eksik" });
  try {
    const fetchRes = await fetch(url);
    if (!fetchRes.ok) throw new Error(`HTTP error! status: ${fetchRes.status}`);
    const contentType = fetchRes.headers.get('content-type');
    let ext = '.mp4';
    if (contentType && contentType.includes('image')) ext = '.jpg';
    else if (url.match(/\.(jpg|jpeg|png|webp)/i)) ext = '.jpg';

    const safeFilename = (filename || 'insta_media').replace(/[^a-z0-9_-]/gi, '_') + ext;
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    if (contentType) res.setHeader('Content-Type', contentType);

    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (err) {
    console.error('Download proxy error:', err);
    res.status(500).send("İndirme başarısız");
  }
});

// ---------------- Dashboard API ----------------
app.get("/api/dashboard/editor", verifyToken, async (req, res) => {
  try {
    const data = {};
    const balanceRow = await new Promise((res, rej) => db.get('SELECT earnings_balance FROM users WHERE id = ?', [req.user.id], (err, row) => err ? rej(err) : res(row)));
    data.balance = balanceRow ? balanceRow.earnings_balance || 0 : 0;

    const countRow = await new Promise((res, rej) => db.get('SELECT COUNT(*) as t FROM wallet_transactions WHERE user_id = ? AND type = "EARNING"', [req.user.id], (err, row) => err ? rej(err) : res(row)));
    data.total_posts = countRow ? countRow.t : 0;

    const txRows = await new Promise((res, rej) => db.all('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [req.user.id], (err, rows) => err ? rej(err) : res(rows)));
    data.recent_transactions = txRows || [];

    // Chart Data (Son 7 Günlük Kazanç)
    const chartRows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT date(created_at) as c_date, SUM(amount) as daily_total 
        FROM wallet_transactions 
        WHERE user_id = ? AND type = 'EARNING' 
        AND created_at >= date('now', '-7 days')
        GROUP BY c_date ORDER BY c_date ASC
      `, [req.user.id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    data.chartData = chartRows || [];

    // Upcoming Tasks
    const taskRows = await new Promise((resolve, reject) => {
      db.all('SELECT id, title, status, due_date FROM tasks WHERE assigned_to = ? AND status != "completed" ORDER BY due_date ASC LIMIT 5', [req.user.id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    data.tasks = taskRows || [];

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/admin", verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const data = {};
    const usersRow = await new Promise((res, rej) => db.get('SELECT COUNT(*) as total_editors FROM users WHERE role = "editor"', [], (err, row) => err ? rej(err) : res(row)));
    data.total_editors = usersRow ? usersRow.total_editors || 0 : 0;

    // Kasa hesabı: Toplam kazançlar - Onaylanıp Ödenen Tutarlar
    const totalEarningRow = await new Promise((res, rej) => db.get("SELECT SUM(amount) as t FROM wallet_transactions WHERE type IN ('EARNING', 'LIKE_BONUS')", [], (err, row) => err ? rej(err) : res(row)));
    const totalDeductionRow = await new Promise((res, rej) => db.get("SELECT SUM(ABS(amount)) as t FROM wallet_transactions WHERE type = 'DELETION_DEDUCTION'", [], (err, row) => err ? rej(err) : res(row)));
    const totalPaidRow = await new Promise((res, rej) => db.get("SELECT SUM(amount) as t FROM payment_requests WHERE status = 'completed'", [], (err, row) => err ? rej(err) : res(row)));

    const rawEarned = (totalEarningRow?.t || 0) - (totalDeductionRow?.t || 0);
    const rawPaid = (totalPaidRow?.t || 0);
    data.total_unpaid = Math.max(0, rawEarned - rawPaid);

    const pendingRow = await new Promise((res, rej) => db.get('SELECT COUNT(*) as pending_count, SUM(amount) as pending_sum FROM payment_requests WHERE status = "pending"', [], (err, row) => err ? rej(err) : res(row)));
    data.pending_count = pendingRow ? pendingRow.pending_count || 0 : 0;
    data.pending_sum = pendingRow ? pendingRow.pending_sum || 0 : 0;

    const todayPostsRow = await new Promise((res, rej) => db.get("SELECT COUNT(*) as today_posts FROM wallet_transactions WHERE type = 'EARNING' AND date(created_at) = date('now')", [], (err, row) => err ? rej(err) : res(row)));
    data.today_posts = todayPostsRow ? todayPostsRow.today_posts || 0 : 0;

    const topEditors = await new Promise((res, rej) => db.all("SELECT u.name, SUM(w.amount) as total_earned FROM wallet_transactions w JOIN users u ON w.user_id = u.id WHERE w.type = 'EARNING' GROUP BY w.user_id ORDER BY total_earned DESC LIMIT 5", [], (err, rows) => err ? rej(err) : res(rows)));
    data.top_editors = topEditors || [];

    // Chart Data (Son 14 Günlük Paylaşım Adedi)
    const chartRows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT date(created_at) as c_date, COUNT(*) as daily_posts 
        FROM wallet_transactions 
        WHERE type = 'EARNING' 
        AND created_at >= date('now', '-14 days')
        GROUP BY c_date ORDER BY c_date ASC
      `, [], (err, rows) => err ? reject(err) : resolve(rows));
    });
    data.chartData = chartRows || [];

    // Pending System Tasks (For all users or admin specifically)
    const taskRows = await new Promise((resolve, reject) => {
      db.all('SELECT t.id, t.title, t.status, t.due_date, u.name as assignee FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.status != "completed" ORDER BY t.due_date ASC LIMIT 8', [], (err, rows) => err ? reject(err) : resolve(rows));
    });
    data.tasks = taskRows || [];

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Earnings & Payments API ----------------
app.get("/api/earnings/me", verifyToken, (req, res) => {
  db.get('SELECT earnings_balance FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const balance = row ? row.earnings_balance : 0;

    db.all('SELECT * FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err2, requests) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id], (err3, txs) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ ok: true, balance, requests, transactions: txs });
      });
    });
  });
});

app.post("/api/earnings/request", verifyToken, async (req, res) => {
  try {
    const settings = await getSettings();
    const minLimit = parseFloat(settings.min_withdrawal_limit || 200);

    db.get('SELECT earnings_balance, iban FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Kullanıcı bulunamadı" });

      if (!row.iban || row.iban.trim() === '') {
        return res.status(400).json({ error: "Ödeme talep edebilmek için önce IBAN bilginizi profilinizden eklemelisiniz." });
      }

      if (row.earnings_balance < minLimit) {
        return res.status(400).json({ error: `Minimum çekim limiti ${minLimit}₺'dir. Mevcut bakiye: ${row.earnings_balance}₺` });
      }

      const amount = row.earnings_balance;

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET earnings_balance = 0 WHERE id = ?', [req.user.id]);
        db.run(`INSERT INTO payment_requests (user_id, amount) VALUES (?, ?)`, [req.user.id, amount]);
        db.run(`INSERT INTO wallet_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)`,
          [req.user.id, amount, 'WITHDRAWAL', 'Ödeme Talebi']);
        db.run('COMMIT', errTx => {
          if (errTx) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: "İşlem sırasında hata oluştu" });
          }
          logAction(req.user.id, 'PAYMENT_REQUESTED', `${amount}₺ tutarında ödeme talep edildi`, req.ip, 'SUCCESS');
          res.json({ ok: true, requested_amount: amount });
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/payments", verifyToken, isSuperAdmin, (req, res) => {
  const query = `
    SELECT pr.*, u.name, u.email, u.iban, u.role
    FROM payment_requests pr
    LEFT JOIN users u ON pr.user_id = u.id
    ORDER BY pr.created_at DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/admin/payments/:id/complete", verifyToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE payment_requests SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(400).json({ error: "Kayıt bulunamadı veya zaten tamamlanmış" });
    logAction(req.user.id, 'PAYMENT_COMPLETED', `Ödeme tamamlandı (Talep ID: ${id})`, req.ip, 'SUCCESS');
    res.json({ ok: true });
  });
});

// ---------------- Finance API ----------------
app.get("/api/finance/editor", verifyToken, (req, res) => {
  db.get('SELECT earnings_balance FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const balance = row ? row.earnings_balance : 0;

    db.all('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err2, txs) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all('SELECT * FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err3, reqs) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ ok: true, balance, transactions: txs, requests: reqs });
      });
    });
  });
});

app.get("/api/finance/admin", verifyToken, isSuperAdmin, async (req, res) => {
  try {
    const data = {};
    const editors = await new Promise((resolve, reject) => {
      db.all("SELECT id, name, email, earnings_balance FROM users WHERE role = 'editor' ORDER BY name ASC", [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    for (let ed of editors) {
      const stats = await new Promise((resolve, reject) => {
        db.get(`
                SELECT 
                    SUM(CASE WHEN type IN ('EARNING', 'LIKE_BONUS') THEN amount ELSE 0 END) as total_earned,
                    SUM(CASE WHEN type = 'WITHDRAWAL' THEN ABS(amount) ELSE 0 END) as total_requested,
                    SUM(CASE WHEN type = 'DELETION_DEDUCTION' THEN ABS(amount) ELSE 0 END) as total_deducted
                FROM wallet_transactions WHERE user_id = ?
            `, [ed.id], (err, row) => err ? reject(err) : resolve(row));
      });

      const paid = await new Promise((resolve, reject) => {
        db.get("SELECT SUM(amount) as t FROM payment_requests WHERE user_id = ? AND status = 'completed'", [ed.id], (err, row) => err ? reject(err) : resolve(row));
      });

      ed.total_earned = stats?.total_earned || 0;
      ed.total_paid = paid?.t || 0;
      ed.total_deducted = stats?.total_deducted || 0;
      ed.net_unpaid = Math.max(0, ed.total_earned - ed.total_deducted - ed.total_paid);
    }

    data.editors = editors;

    const allTxs = await new Promise((resolve, reject) => {
      db.all("SELECT w.*, u.name as user_name FROM wallet_transactions w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC LIMIT 200", [], (err, rows) => err ? reject(err) : resolve(rows));
    });
    data.transactions = allTxs;

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`InstaApp: http://localhost:${PORT}`);

  // Arka Plan İşleyicisini Başlat (Her 30 dakikada bir)
  setInterval(() => {
    runWorker().catch(err => console.error("[Worker Error]", err));
  }, 30 * 60 * 1000);

  // İlk çalışma
  setTimeout(() => runWorker().catch(err => console.error("[Worker First Run Error]", err)), 5000);
});
