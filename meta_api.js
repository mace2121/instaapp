const { exec } = require('child_process');
const db = require('./database');

async function getSettings() {
    return new Promise((resolve, reject) => {
        db.all('SELECT key, value FROM settings', [], (err, rows) => {
            if (err) return reject(err);
            const settings = {};
            rows.forEach(r => settings[r.key] = r.value);
            resolve(settings);
        });
    });
}

/**
 * Meta Graph API Helper
 * @param {string} endpoint - API endpoint (e.g. 'me/media')
 * @param {object} params - Query or body parameters
 * @param {string} method - 'GET' or 'POST'
 */
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

    try {
        const response = await fetch(url, {
            method: method,
            headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
            body: method === 'POST' ? JSON.stringify(params) : undefined
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            const err = new Error(JSON.stringify(data));
            err.status = response.status;
            throw err;
        }

        return data;
    } catch (error) {
        console.error("Meta API Fetch Error:", error.message);
        throw error;
    }
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

module.exports = { metaRequest, getSettings, waitForVideo };
