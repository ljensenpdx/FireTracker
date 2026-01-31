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
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🕵️ Navigating PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 90000 
        });

        // 🚨 AGGRESSIVE WAIT
        console.log("⏳ Waiting for incident list...");
        let listFound = true;
        await page.waitForSelector('div[role="row"]', { timeout: 30000 }).catch(() => {
            console.log("⚠️ TIMEOUT: Could not find incident rows.");
            listFound = false;
        });

        // If it failed, take a screenshot and upload it for us to see
        if (!listFound) {
            console.log("📸 Saving debug screenshot...");
            const screenshot = await page.screenshot({ encoding: 'base64' });
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/debug_error.png`, {
                message: "📸 Debug: Site state at failure",
                content: screenshot
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }).catch(e => console.log("Failed to upload debug image."));
        }

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"]'))
                             .filter(r => r.innerText.length > 50 && !r.innerText.includes('Recent'));
            
            rows.forEach(row => {
                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim());
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

        console.log(`📡 Captured ${data.length} incidents.`);

        if (data.length > 0) {
            const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });

            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "📟 SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: res.data.sha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ Sync complete.");
        }

    } catch (err) {
        console.error("💥 Error:", err.message);
    } finally {
        await browser.close();
    }
}
run();
