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

const app = express();
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
app.use("/uploads", express.static(uploadDir));

// ---------------- UI Routes ----------------
app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "ui", "login.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "ui", "index.html")));

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

app.get("/api/auth/me", verifyToken, (req, res) => res.json(req.user));

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

const ACT = "/home/mahsum/instaapp/your_instagram_activity";
const MEDIA_BASE_URL = "http://168.231.125.93:8080/media";

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
  const files = listJsonFiles(ACT);
  const items = [];
  const priority = (n) => n.toLowerCase().includes("reel") ? 1 : (n.toLowerCase().includes("post") ? 2 : (n.toLowerCase().includes("stories") ? 3 : 9));
  files.sort((a, b) => priority(a) - priority(b));
  for (const f of files) {
    const data = readJsonSafe(path.join(ACT, f));
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
  db.all(`SELECT logs.*, users.name as user_name FROM logs LEFT JOIN users ON logs.user_id = users.id ORDER BY logs.created_at DESC LIMIT 100`, [], (err, rows) => {
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
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "İsim gerekli" });
  try {
    const { updateProfile } = require('./auth');
    await updateProfile(req.user.id, { name });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/profile/avatar", verifyToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya yüklenemedi" });

  const finalPath = req.file.path;
  let publicUrl = `http://168.231.125.93:3000/uploads/${req.file.filename}`;

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
async function metaRequest(endpoint, params = {}, method = 'POST') {
  const settings = await getSettings();
  const token = settings.META_ACCESS_TOKEN;
  if (!token) throw new Error("Meta Access Token eksik.");

  const urlObj = new URL(`https://graph.facebook.com/v24.0/${endpoint}`);
  urlObj.searchParams.append('access_token', token);

  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => urlObj.searchParams.append(k, v));
  }

  const url = urlObj.toString();
  let cmd = `curl -s "${url}"`;

  if (method === 'POST') {
    cmd += ` -X POST -H "Content-Type: application/json"`;
    // JSON içindeki tek tırnakları bash için escape et: ' -> '\''
    const jsonBody = JSON.stringify(params).replace(/'/g, "'\\''");
    cmd += ` -d '${jsonBody}'`;
  }

  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error("Curl Exec Error:", stderr);
        return reject(error);
      }
      try {
        const data = JSON.parse(stdout);
        if (data.error) return reject(new Error(data.error.message || "Meta API Error"));
        resolve(data);
      } catch (e) {
        console.error("Curl Parse Error:", stdout);
        reject(new Error("Invalid JSON response from Meta (Curl)"));
      }
    });
  });
}

async function waitForVideo(cid) {
  for (let i = 0; i < 20; i++) {
    const res = await metaRequest(cid, { fields: 'status_code' }, 'GET');
    if (res.status_code === 'FINISHED') return true;
    if (res.status_code === 'ERROR') throw new Error("Meta video hatası");
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("Video polling zaman aşımı");
}

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

    let publicUrl = `http://168.231.125.93:3000/uploads/${finalFilename}`;
    try {
      const util = require('util');
      const exec = util.promisify(require('child_process').exec);
      console.log(`[Catbox] Uploading ${finalPath} ...`);
      const { stdout } = await exec(`curl -s -F "reqtype=fileupload" -F "fileToUpload=@${finalPath}" https://catbox.moe/user/api.php`);
      if (stdout.startsWith('http')) publicUrl = stdout.trim();
      console.log(`[Catbox] Success: ${publicUrl}`);
    } catch (err) {
      console.error("[Catbox] Failed to upload to catbox:", err);
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

  // CATBOX PROXY: Fix old library URLs on-the-fly
  for (let m of mediaList) {
    if ((m.url.includes('168.231.125.93') || m.url.includes('localhost')) && !m.url.includes('catbox.moe')) {
      const filename = m.url.split('/').pop();
      const localPath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(localPath)) {
        try {
          const util = require('util');
          const exec = util.promisify(require('child_process').exec);
          console.log(`[Catbox Proxy] Rehosing ${filename}...`);
          const { stdout } = await exec(`curl -s -F "reqtype=fileupload" -F "fileToUpload=@${localPath}" https://catbox.moe/user/api.php`);
          if (stdout.startsWith('http')) m.url = stdout.trim();
        } catch (e) {
          console.error("[Catbox Proxy Error]", e);
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
            res.json({ ok: true, id: res2.id });

          } catch (e2) {
            logAction(req.user.id, 'SHARE_ERROR', `Parse Error Step 3: ${stdout2}`, req.ip, 'ERROR');
            res.status(500).json({ error: "Yayınlama Yanıtı Okunamadı" });
          }
        });

      } catch (e1) {
        logAction(req.user.id, 'SHARE_ERROR', `Parse Error Step 1: ${stdout1}`, req.ip, 'ERROR');
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

    logAction(req.user.id, 'SHARE_SUCCESS', `IG: ${publish.id}`, req.ip, 'SUCCESS');
    res.json({ ok: true, id: publish.id });
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

app.listen(PORT, () => console.log(`InstaApp: http://localhost:${PORT}`));
