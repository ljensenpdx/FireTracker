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
    await page.setViewport({ width: 1400, height: 1200 });

    try {
        console.log("🌐 Navigating...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', // Wait until ALL data is downloaded
            timeout: 90000 
        });

        // CRITICAL: Wait 15 seconds for the "Unit Chips" to animate in
        console.log("⏳ Waiting for data to stabilize...");
        await new Promise(r => setTimeout(r, 15000)); 

        const data = await page.evaluate(() => {
            const results = [];
            // Target the specific incident containers
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'));
            
            for (const row of rows) {
                if (row.innerText.includes('Recent') || row.innerText.length < 20) continue;
                
                const lines = row.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                
                // Find the dispatch time specifically
                const timeMatch = row.innerText.match(/\d{1,2}:\d{2}\s[AP]M/);
                const time = timeMatch ? timeMatch[0] : "Pending";

                // Find ALL unit chips (they have specific classes in PulsePoint)
                const unitChips = Array.from(row.querySelectorAll('.unit_chip, [class*="unit"]'))
                    .filter(el => el.innerText.length > 0 && el.innerText.length < 10);

                const unitMap = { "On Scene": [], "En Route": [], "Dispatched": [] };

                unitChips.forEach(chip => {
                    const name = chip.innerText.trim().replace(/[?^*]/g, '');
                    const color = window.getComputedStyle(chip).backgroundColor;
                    const rgb = color.match(/\d+/g).map(Number);

                    // Color Logic for Status
                    if (rgb[0] > 150 && rgb[1] < 100) unitMap["On Scene"].push(name);
                    else if (rgb[1] > 150 && rgb[0] < 150) unitMap["En Route"].push(name);
                    else unitMap["Dispatched"].push(name);
                });

                // Format statuses for easy reading
                const statusList = Object.entries(unitMap)
                    .filter(([key, val]) => val.length > 0)
                    .map(([key, val]) => `${key}: ${val.join(', ')}`);

                results.push({
                    agency: lines[0]?.toUpperCase() || "UNKNOWN",
                    type: lines[2] || "Emergency",
                    time: time,
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: statusList
                });
            }
            return results;
        });

        console.log(`📡 Success! Captured ${data.length} incidents with units.`);
        
        // PUSH LOGIC (Same as before)
        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            const base64Content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}
            await axios.put(url, {
                message: "📟 DATA FIX: " + new Date().toLocaleTimeString(),
                content: base64Content,
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
