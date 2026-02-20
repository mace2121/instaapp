const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACT = "/home/mahsum/instaapp/your_instagram_activity";

function listJsonFiles(dir) {
    try {
        return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
    } catch {
        return [];
    }
}

function decodeLiteralUnicodeEscapes(s) {
    if (typeof s !== "string") return s;
    if (s.includes("\\u")) {
        try {
            s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        } catch (_) { }
    }
    return s;
}

function fixMojibakeTR(s) {
    if (typeof s !== "string") return s;
    if (/[ÃÄÅ]/.test(s)) {
        try {
            return Buffer.from(s, "latin1").toString("utf8");
        } catch (_) {
            return s;
        }
    }
    return s;
}

function normalizeTRText(s) {
    return fixMojibakeTR(decodeLiteralUnicodeEscapes(s));
}

function flattenAnyMedia(obj, out = []) {
    if (!obj || typeof obj !== "object") return out;
    const maybeUri = obj.uri || obj.path || obj.file_path || obj.media_uri || obj.video_uri || obj.photo_uri;
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

function test() {
    console.log("--- Kütüphane Doğrulama Başladı ---");
    const files = listJsonFiles(ACT);
    console.log("Bulunan JSON Dosyaları:", files);

    if (files.length === 0) {
        console.error("HATA: JSON dosyası bulunamadı!");
        process.exit(1);
    }

    let totalItems = 0;
    const types = {};

    for (const f of files) {
        const full = path.join(ACT, f);
        const content = fs.readFileSync(full, 'utf8');
        const data = JSON.parse(content);

        const arrays = [];
        if (Array.isArray(data)) arrays.push(data);
        else {
            for (const k in data) if (Array.isArray(data[k])) arrays.push(data[k]);
        }

        for (const arr of arrays) {
            for (const raw of arr) {
                const mediaUris = flattenAnyMedia(raw);
                if (mediaUris.length > 0) {
                    totalItems++;
                    let type = mediaUris.length > 1 ? "CAROUSEL" : "POST";
                    if (f.toLowerCase().includes("reel")) type = "REEL";
                    if (f.toLowerCase().includes("stories")) type = "STORY";
                    types[type] = (types[type] || 0) + 1;

                    if (totalItems <= 3) {
                        console.log(`Örnek ${totalItems}: [${type}] - Medya Sayısı: ${mediaUris.length}`);
                    }
                }
            }
        }
    }

    console.log("--- Sonuçlar ---");
    console.log("Toplam Gönderi Sayısı:", totalItems);
    console.log("Kategoriler:", types);
    console.log("Sistem Durumu: OK");
}

test();
