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
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    const page = await browser.newPage();
    
    // 🌍 FORCE PACIFIC TIME AT THE BROWSER LEVEL
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        // --- 🧹 STEP 1: WIPE OLD DATA ---
        console.log("🧹 Wiping for fresh sync...");
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
        } catch (e) { console.log("Init sync..."); }

        // --- 🌐 STEP 2: STEALTH NAVIGATION ---
        console.log("🕵️ Navigating PulsePoint in Stealth Mode...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // 🖱️ Trigger the list by scrolling
        await page.mouse.wheel({ deltaY: 400 });
        await new Promise(r => setTimeout(r, 2000));
        await page.mouse.wheel({ deltaY: -400 });

        console.log("⏳ Waiting for units to stabilize...");
        await new Promise(r => setTimeout(r, 30000));

        const data = await page.evaluate(() => {
            const results = [];
            // Find rows, ignoring "Recent Incidents"
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'))
                             .filter(r => r.innerText.length > 50 && !r.innerText.includes('Recent'));
            
            rows.forEach(row => {
                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim());
                
                // 🚑 UNIT HUNTER
                const units = [];
                // Scan all child elements for background colors (colored badges)
                row.querySelectorAll('*').forEach(el => {
                    const style = window.getComputedStyle(el);
                    const bg = style.backgroundColor;
                    const val = el.innerText.trim();
                    // PulsePoint unit badges have a background and are short (1-7 chars)
                    if (bg !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                        units.push(val);
                    }
                });

                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: text.match(/\d{1,2}:\d{2}\s[AP]M/)?.[0] || "Active",
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)] // Dedupes badges
                });
            });
            return results;
        });

        console.log(`📡 Success! Found ${data.length} incidents.`);

        // --- 📟 STEP 3: PUSH DATA ---
        if (data.length > 0) {
            const finalRes = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });

            const pstTime = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});

            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "📟 SYNC: " + pstTime,
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: finalRes.data.sha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            console.log("✅ GitHub Updated at: " + pstTime);
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
