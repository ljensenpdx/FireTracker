const puppeteer = require('puppeteer');
const axios = require('axios');

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    // Block heavy stuff to save GitHub's resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // 1. Increase the timeout and change the "wait" condition
await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
    waitUntil: 'domcontentloaded', // Wait for the text, not the heavy images/maps
    timeout: 90000                 // Give it 90 seconds instead of 30
});

// 2. Add a small "Sleep" to let the data populate
await new Promise(r => setTimeout(r, 10000));

    const data = await page.evaluate(() => {
        const results = [];
        const rows = Array.from(document.querySelectorAll('div[role="row"], tr'));
        for (const row of rows) {
            if (row.innerText.includes('Recent')) break;
            const lines = row.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const time = lines.find(l => l.match(/\d{1,2}:\d{2}\s[AP]M/));
            if (time) {
                // ... (Your existing status and color logic here) ...
                results.push({ agency: lines[0], type: lines[2], time: time, address: lines[4] || "Restricted" });
            }
        }
        return results;
    });

    if (data.length > 0) {
        const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
        const base64Content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        
        let sha = "";
        try {
            const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) {}

        await axios.put(url, {
            message: "📟 AUTO-SYNC: " + new Date().toLocaleTimeString(),
            content: base64Content,
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
    }

    await browser.close();
}

run();
