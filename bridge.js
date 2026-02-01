const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

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
    
    // 🚨 FORCE 400px WIDTH: This triggers PulsePoint's mobile "List-Only" view
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Navigating PulsePoint (Compact Mode)...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        console.log("⏳ Stabilizing list...");
        await new Promise(r => setTimeout(r, 20000));

        const data = await page.evaluate(() => {
            const results = [];
            // In mobile view, the selector often changes to target the vertical list
            const rows = Array.from(document.querySelectorAll('.incident_row, [role="row"]'))
                             .filter(r => r.innerText.length > 30 && !r.innerText.includes('Recent'));

         // After the page.evaluate() section, add:
console.log("📊 RAW DATA SAMPLE:", JSON.stringify(data.slice(0, 2), null, 2));
console.log("🔍 Total rows found:", data.length);

// Inside page.evaluate(), before the forEach:
console.log("DEBUG: Found", rows.length, "rows");
if (rows.length > 0) {
    console.log("First row HTML:", rows[0].outerHTML.substring(0, 500));
}

            
            rows.forEach(row => {
                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim());
                
                // UNIT HUNTER: Grabs the badges (AMR119, E60, etc.)
                const units = [];
                row.querySelectorAll('*').forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && el.innerText.length > 0 && el.innerText.length < 8) {
                        units.push(el.innerText.trim());
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

        console.log(`📡 Captured ${data.length} incidents at 400px width.`);

        if (data.length > 0) {
            const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });

            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "📟 COMPACT SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: res.data.sha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ Sync complete!");
        }

    } catch (err) {
        console.error("💥 Error:", err.message);
    } finally {
        await browser.close();
    }
}
run();
