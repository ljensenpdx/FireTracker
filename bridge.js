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
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ] 
    });
    const page = await browser.newPage();
    
    // Set a standard high-res viewport
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        
        // Go to the site and wait for the main structure
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        console.log("⏳ Waiting for incident list to appear...");
        
        // 🚨 NEW: Instead of just waiting for time, we wait for a specific 
        // element that only exists when data is loaded (like the "Agency" column header)
        try {
            await page.waitForSelector('div[role="row"]', { timeout: 30000 });
        } catch (e) {
            console.log("⚠️ Row selector not found, attempting generic wait...");
            await new Promise(r => setTimeout(r, 20000));
        }

        const data = await page.evaluate(() => {
            const results = [];
            // We broaden the search to find ANY element that looks like a row
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row, tr'))
                             .filter(r => r.innerText.length > 50);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;

                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);

                // Find Units by looking for the colored chips
                const units = Array.from(row.querySelectorAll('span, div'))
                    .filter(el => {
                        const style = window.getComputedStyle(el);
                        // PulsePoint units usually have a solid background color
                        return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                               el.innerText.trim().length > 0 && 
                               el.innerText.trim().length < 8;
                    });

                const unitMap = { "On Scene": [], "En Route": [], "Dispatched": [] };
                units.forEach(el => {
                    const name = el.innerText.trim().replace(/[?^*]/g, '');
                    const rgb = window.getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
                    if (rgb[0] > 150 && rgb[1] < 100) unitMap["On Scene"].push(name);
                    else if (rgb[1] > 150 && rgb[0] < 150) unitMap["En Route"].push(name);
                    else unitMap["Dispatched"].push(name);
                });

                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: timeMatch ? timeMatch[0] : "Just Now",
                    address: lines.find(l => l.includes(',')) || "Location Restricted",
                    unitStatuses: Object.entries(unitMap)
                                    .filter(([k,v]) => v.length > 0)
                                    .map(([k,v]) => `${k}: ${v.join(', ')}`),
                    scrapeStamp: new Date().toLocaleTimeString()
                });
            });
            return results;
        });

        console.log(`📡 Found ${data.length} incidents.`);

        if (data.length > 0) {
            // ... (Keep your GitHub Push logic here) ...
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 SYNC: " + new Date().toLocaleString(),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ GitHub updated!");
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
