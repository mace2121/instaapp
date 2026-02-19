const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require('dotenv').config();
const { login } = require('./auth');
const db = require('./database');


const app = express();
const PORT = 3000;

// klasörler
const BASE = "/home/mahsum/instaapp";
const ACT = path.join(BASE, "your_instagram_activity");
const MEDIA_BASE_URL = "http://168.231.125.93:8080/media"; // nginx medya adresin

app.use(express.json({ limit: "10mb" }));
app.use("/ui", express.static(path.join(__dirname, "ui")));

// ---------------- utils ----------------
function readJsonSafe(p) {
  try {
	return JSON.parse(fs.readFileSync(p, { encoding: "utf8" }));
  } catch (e) {
    return null;
  }
}

function listJsonFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return [];
  }
}

function flattenAnyMedia(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;

  const maybeUri =
    obj.uri || obj.path || obj.file_path || obj.media_uri || obj.video_uri || obj.photo_uri;

  if (typeof maybeUri === "string" && maybeUri.includes("media/")) out.push(maybeUri);

  if (Array.isArray(obj.media)) {
    for (const m of obj.media) flattenAnyMedia(m, out);
  }

  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") flattenAnyMedia(v, out);
  }
  return out;
}

function decodeLiteralUnicodeEscapes(s) {
  if (typeof s !== "string") return s;

  // Metin içinde literal "\u00xx" varsa gerçek karaktere çevir
  if (s.includes("\\u")) {
    try {
      // \uXXXX -> gerçek char
      s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
    } catch (_) {}
  }
  return s;
}

function fixMojibakeTR(s) {
  if (typeof s !== "string") return s;

  // Tipik bozulma işaretleri: Ä, Å, Ã
  if (/[ÃÄÅ]/.test(s)) {
    try {
      const fixed = Buffer.from(s, "latin1").toString("utf8");
      return fixed;
    } catch (_) {
      return s;
    }
  }
  return s;
}

function normalizeTRText(s) {
  // 1) literal \u kaçışlarını çöz
  // 2) sonra mojibake düzelt
  return fixMojibakeTR(decodeLiteralUnicodeEscapes(s));
}


function guessCaption(obj) {
  const candidates = [
    obj.caption,
    obj.title,
    obj.text,
    obj.description,
    obj.string_map_data?.Caption?.value,
    obj.string_map_data?.caption?.value,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return normalizeTRText(c.trim());
  }
  return "";
}

function guessTimestamp(obj) {
  const candidates = [
    obj.creation_timestamp,
    obj.creation_time,
    obj.taken_at,
    obj.timestamp,
    obj.string_map_data?.Time?.timestamp,
    obj.string_map_data?.time?.timestamp,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && c > 0) return c;
  }
  return 0;
}

function mediaUrlFromLocalUri(localUri) {
  const cleaned = localUri.startsWith("/") ? localUri.slice(1) : localUri;
  const afterMedia = cleaned.startsWith("media/") ? cleaned.slice("media/".length) : cleaned;
  return `${MEDIA_BASE_URL}/${afterMedia}`;
}

// ---------------- data store for edits ----------------
const EDITS_DB = path.join(__dirname, "edits.json");
function loadEdits() {
  return readJsonSafe(EDITS_DB) || {};
}
function saveEdits(edits) {
  fs.writeFileSync(EDITS_DB, JSON.stringify(edits, null, 2), "utf8");
}

// ---------------- content loader ----------------
function buildLibrary() {
  const files = listJsonFiles(ACT);

  const priority = (name) => {
    const n = name.toLowerCase();
    if (n.includes("reel")) return 1;
    if (n.includes("post")) return 2;
    if (n.includes("archive")) return 3;
    return 9;
  };

  files.sort((a, b) => priority(a) - priority(b));

  const edits = loadEdits();
  const items = [];

  for (const f of files) {
    const full = path.join(ACT, f);
    const data = readJsonSafe(full);
    if (!data) continue;

    const arrays = [];
    if (Array.isArray(data)) arrays.push(data);
    else {
      for (const k of Object.keys(data)) {
        if (Array.isArray(data[k])) arrays.push(data[k]);
      }
      if (Array.isArray(data.media)) arrays.push(data.media);
    }

    for (const arr of arrays) {
      for (const raw of arr) {
        const mediaUris = [...new Set(flattenAnyMedia(raw, []))];
        if (!mediaUris.length) continue;

        const caption = guessCaption(raw);
        const ts = guessTimestamp(raw);

        let type = mediaUris.length > 1 ? "CAROUSEL" : "POST";
        if (f.toLowerCase().includes("reel")) type = "REEL";

	const id = crypto
 	.createHash("sha1")
  	.update(`${f}|${ts}|${mediaUris.join("|")}`)
  	.digest("hex");


        const edited = edits[id] || {};
        const finalCaption = typeof edited.caption === "string" ? edited.caption : caption;

        items.push({
          id,
          source_file: f,
          type,
          created_at: ts ? new Date(ts * 1000).toISOString() : null,
          caption: normalizeTRText(finalCaption || ""),
          media: mediaUris.map((u) => ({
            local: u,
            url: mediaUrlFromLocalUri(u),
            kind: u.toLowerCase().endsWith(".mp4") ? "video" : "photo",
          })),
          cover_url: mediaUrlFromLocalUri(mediaUris[0]),
        });
      }
    }
  }

  items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return items;
}

// ---------------- UI routes ----------------
app.get("/", (req, res) => res.redirect("/library"));

app.get("/library", (req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

// ---------------- API ----------------
app.get("/api/library", (req, res) => {
  const { type } = req.query;
  let items = buildLibrary();
  if (type) items = items.filter((x) => x.type === type.toUpperCase());
  res.json(items);
});

app.get("/api/item/:id", (req, res) => {
  const id = req.params.id;
  const items = buildLibrary();
  const item = items.find((x) => x.id === id);
  if (!item) return res.status(404).json({ error: "not_found" });
  res.json(item);
});

app.put("/api/item/:id", (req, res) => {
  const id = req.params.id;
  const { caption } = req.body || {};
  if (typeof caption !== "string") return res.status(400).json({ error: "caption_required" });

  const edits = loadEdits();
  edits[id] = { ...(edits[id] || {}), caption };
  saveEdits(edits);

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`App running: http://localhost:${PORT}/library`);
});
