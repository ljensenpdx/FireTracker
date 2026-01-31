const puppeteer = require('puppeteer');
const axios = require('axios');

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        // --- STEP 1: WIPE THE DATA (Debugging Mode) ---
        console.log("🧹 Wiping old data file...");
        let sha = "";
        try {
            const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });
            sha = res.data.sha;
            // Push an empty array to "clear" the dashboard while we work
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "🧹 WIPING FOR REFRESH",
                content: Buffer.from(JSON.stringify([], null, 2)).toString('base64'),
                sha: sha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        } catch (e) { console.log("No file to wipe yet."); }

        // --- STEP 2: SCRAPE WITH STEALTH ---
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // Mimic a human scrolling down to see the list
        console.log("🖱️ Mimicking human interaction...");
        await page.mouse.move(500, 500);
        await page.mouse.wheel({ deltaY: 300 });
        await new Promise(r => setTimeout(r, 25000)); // 25s wait for the data to populate

        const data = await page.evaluate(() => {
            const results = [];
            // Target the most common container names PulsePoint uses
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row, tr')).filter(r => r.innerText.length > 50);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;
                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim());
                
                // UNIT SEARCH: Every element with a background color
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

        // --- STEP 3: PUSH THE NEW DATA ---
        if (data.length > 0) {
            // Get the NEW sha after the wipe
            const finalRes = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });
            
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                message: "✅ SUCCESSFUL SYNC: " + new Date().toLocaleTimeString(),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: finalRes.data.sha
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
