const puppeteer = require('puppeteer');
const axios = require('axios');

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    await page.emulateTimezone('America/Los_Angeles');
    // Set a larger viewport to ensure the list isn't "hidden" off-screen
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🧹 Clearing old data file...");
        let currentSha = "";
        try {
            const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });
            currentSha = res.data.sha;
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "🧹 WIPING FOR REFRESH",
                content: Buffer.from(JSON.stringify([], null, 2)).toString('base64'),
                sha: currentSha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        } catch (e) { console.log("New file setup needed."); }

        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // 🚨 NEW: THE "WAKE UP" GESTURE
        console.log("🖱️ Mimicking scroll to trigger data load...");
        await page.mouse.wheel({ deltaY: 500 });
        await new Promise(r => setTimeout(r, 2000));
        await page.mouse.wheel({ deltaY: -500 });

        console.log("⏳ Waiting 30s for unit badges to animate...");
        await new Promise(r => setTimeout(r, 30000));

        const data = await page.evaluate(() => {
            const results = [];
            // Broaden search to find ANY row-like element
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row, [class*="incident"]'))
                             .filter(r => r.innerText.length > 50);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;

                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim());
                
                // UNIT HUNTER
                const units = [];
                const possibleChips = Array.from(row.querySelectorAll('*'));
                possibleChips.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const bg = style.backgroundColor;
                    const val = el.innerText.trim();
                    if (bg !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                        units.push(val);
                    }
                });

                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: text.match(/\d{1,2}:\d{2}\s[AP]M/)?.[0] || "Active",
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)] 
                });
            });
            return results;
        });

        console.log(`📡 Success! Captured ${data.length} LIVE incidents.`);

        if (data.length > 0) {
            const finalGet = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });

            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "📟 SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: finalGet.data.sha
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
