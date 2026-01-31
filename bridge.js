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
    
    // Set a wide viewport to ensure columns don't collapse
    await page.setViewport({ width: 1600, height: 1200 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 120000 
        });

        // ⏳ CRITICAL: Give it 20 seconds for units to "pop"
        console.log("⏳ Waiting for units to render...");
        await new Promise(r => setTimeout(r, 20000));

        const data = await page.evaluate(() => {
            const results = [];
            // Target the actual row containers
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'));
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent') || row.innerText.length < 50) return;

                // 1. IMPROVED TIME EXTRACTION (Handles Zulu/UTC issues)
                const text = row.innerText;
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                let localTime = timeMatch ? timeMatch[0] : "Just Now";

                // 2. AGGRESSIVE UNIT SEARCH
                // We look for anything that looks like a Unit ID (e.g., E1, L1, TR10)
                // Inside the row, find all small badges or spans
                const unitElements = Array.from(row.querySelectorAll('span, div, .unit_chip'))
                    .filter(el => {
                        const val = el.innerText.trim();
                        // Regex: 1-7 chars, starts with letter/number, might have special symbols
                        return /^[A-Z0-9]{1,7}[?^*]*$/.test(val) && val.length > 0;
                    });

                const unitMap = { "On Scene": [], "En Route": [], "Dispatched": [] };

                unitElements.forEach(el => {
                    const name = el.innerText.trim().replace(/[?^*]/g, '');
                    const style = window.getComputedStyle(el);
                    const bgColor = style.backgroundColor;
                    const rgb = bgColor.match(/\d+/g).map(Number);

                    // PulsePoint Color Logic
                    if (rgb[0] > 150 && rgb[1] < 100) unitMap["On Scene"].push(name);
                    else if (rgb[1] > 150 && rgb[0] < 150) unitMap["En Route"].push(name);
                    else unitMap["Dispatched"].push(name);
                });

                const statusList = Object.entries(unitMap)
                    .filter(([key, val]) => val.length > 0)
                    .map(([key, val]) => `${key}: ${val.join(', ')}`);

                results.push({
                    agency: text.split('\n')[0]?.toUpperCase() || "UNKNOWN",
                    type: text.split('\n')[2] || "Emergency",
                    time: localTime,
                    address: text.split('\n').find(l => l.includes(',')) || "Restricted",
                    unitStatuses: statusList,
                    // Internal check to ensure file updates
                    scrapeStamp: new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"})
                });
            });
            return results;
        });

        console.log(`📡 Scrape complete. Found ${data.length} incidents.`);
        
        // Push to GitHub (Logic remains the same)
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
        }
    } catch (err) {
        console.error("💥 Error:", err.message);
    } finally {
        await browser.close();
    }
}
run();
