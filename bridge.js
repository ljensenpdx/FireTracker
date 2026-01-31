const puppeteer = require('puppeteer');
const axios = require('axios');

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--window-size=1920,1080',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ] 
    });
    const page = await browser.newPage();
    
    // 🌍 FORCE PACIFIC TIMEZONE AT THE BROWSER LEVEL
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 60000 
        });

        console.log("⏳ Waiting for unit chips to render...");
        await new Promise(r => setTimeout(r, 20000));

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'))
                             .filter(r => r.innerText.length > 50);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;

                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                
                // 🚨 BETTER UNIT DETECTION
                // Scans for small boxes with background colors (like MED21, T21)
                const units = Array.from(row.querySelectorAll('span, div'))
                    .filter(el => {
                        const style = window.getComputedStyle(el);
                        return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                               el.innerText.trim().length > 0 && 
                               el.innerText.trim().length < 8;
                    })
                    .map(el => el.innerText.trim().replace(/[?^*]/g, ''));

                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: text.match(/\d{1,2}:\d{2}\s[AP]M/)?.[0] || "Active",
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)], // List of unit IDs
                    scrapeStamp: new Date().toLocaleTimeString("en-US", {hour: '2-digit', minute:'2-digit'})
                });
            });
            return results;
        });

        console.log(`📡 Captured ${data.length} incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 REFRESH: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ GitHub Updated.");
        }
    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
