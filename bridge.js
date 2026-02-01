import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

// ... (imports remain the same)

const browser = await puppeteer.launch({ 
    headless: "new", 
    executablePath: '/usr/bin/google-chrome', // 🚨 Point directly to the server's Chrome
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // ⚡ Prevents memory crashes
        '--disable-gpu'
    ] 
});
    
    const page = await browser.newPage();
    await page.emulateTimezone('America/Los_Angeles');
    // Set to 400px to force the mobile "List-Only" view
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 90000 
        });

        // 🚨 CRITICAL FIX: Wait specifically for the incident buttons to render
        console.log("⏳ Waiting for incident cards to appear...");
        await page.waitForSelector('div[role="button"]', { timeout: 60000 });

        // Extra "settle" time for the unit badges (AMR, Engine, etc) to animate in
        await new Promise(r => setTimeout(r, 5000));

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="button"]')).filter(el => {
                const text = el.innerText || '';
                return text.includes('Medical') || text.includes('FIRE') || text.match(/\d{1,2}:\d{2}/);
            });
            
            rows.forEach((card) => {
                try {
                    const text = card.innerText;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    let agency = lines[0] || "Unknown";
                    let type = lines[1] || "Emergency";
                    let address = lines.find(l => l.includes(',') || l.match(/\d+\s\w+/)) || "Restricted";
                    let time = text.match(/\d{1,2}:\d{2}\s*[AP]M/)?.[0] || "Active";
                    
                    const units = [];
                    card.querySelectorAll('span, div').forEach(el => {
                        const style = window.getComputedStyle(el);
                        const val = el.innerText.trim();
                        // Extract unit IDs (e.g., E1, MED21) based on background color
                        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                            units.push(val);
                        }
                    });
                    
                    results.push({ agency, type, time, address, unitStatuses: [...new Set(units)] });
                } catch (e) {}
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
                message: "📟 SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ GitHub Updated.");
        }

    } catch (err) {
        // Save a debug image if it fails so we can see what the robot sees
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
