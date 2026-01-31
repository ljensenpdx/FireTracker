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
    await page.setViewport({ width: 1200, height: 2000 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 90000 
        });

        // ⏳ CRITICAL: Wait 25 seconds for those unit chips (MED21, E53) to animate in
        console.log("⏳ Waiting for units to stabilize...");
        await new Promise(r => setTimeout(r, 25000));

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'));
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent') || row.innerText.length < 40) return;

                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                
                // Better time capture: PulsePoint usually has the time as a distinct line
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                const displayTime = timeMatch ? timeMatch[0] : "Active";

                // 🚨 NEW UNIT CAPTURE: Look for all small badges/chips in this row
                const units = [];
                const chips = Array.from(row.querySelectorAll('span, div')).filter(el => {
                    const style = window.getComputedStyle(el);
                    const hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                    const isShort = el.innerText.trim().length > 0 && el.innerText.trim().length < 8;
                    return hasBg && isShort;
                });

                chips.forEach(chip => {
                    const unitName = chip.innerText.trim().replace(/[?^*]/g, '');
                    if (unitName) units.push(unitName);
                });

                results.push({
                    agency: lines[0]?.toUpperCase() || "UNKNOWN",
                    type: lines[2] || "Emergency",
                    time: displayTime,
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: units.length > 0 ? [`Active Units: ${[...new Set(units)].join(', ')}`] : [],
                    scrapeStamp: new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"})
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
                message: "📟 DATA REFRESH: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ GitHub updated with local time.");
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
