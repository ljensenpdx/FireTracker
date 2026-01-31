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
            '--lang=en-US,en' // Force US English locale
        ] 
    });
    const page = await browser.newPage();
    
    // Set extra headers to look like a real Portland-based user
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1600, height: 1200 });

    try {
        console.log("🌐 Navigating...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        console.log("⏳ Waiting for specific unit elements...");
        // This forces the script to wait until at least one unit-style chip is on screen
        try {
            await page.waitForSelector('.unit_chip, [style*="background-color"]', { timeout: 45000 });
        } catch (e) {
            console.log("⚠️ No chips found via selector, using emergency 30s wait.");
            await new Promise(r => setTimeout(r, 30000));
        }

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'));
            
            rows.forEach(row => {
                const text = row.innerText;
                if (text.includes('Recent') || text.length < 50) return;

                // 🚨 TIME FIX: Get the raw text time and strip any UTC markers
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                
                // 🚨 UNIT FIX: Scrape all elements that have a background color
                // and contain typical fire/ems unit IDs (letters followed by numbers)
                const units = [];
                const possibleChips = Array.from(row.querySelectorAll('*'));
                
                possibleChips.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const bg = style.backgroundColor;
                    const val = el.innerText.trim();
                    
                    // Logic: Must have a background color AND be short (E1, MED21, etc)
                    if (bg !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                        units.push(val);
                    }
                });

                results.push({
                    agency: text.split('\n')[0] || "Unknown",
                    type: text.split('\n')[2] || "Emergency",
                    time: timeMatch ? timeMatch[0] : "Active",
                    address: text.split('\n').find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)] // Dedupes units found twice
                });
            });
            return results;
        });

        // 🚨 FINAL TIME SYNC: Force Pacific Time manually for the "Last Updated" stamp
        const now = new Date();
        const pacificTime = now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"});

        console.log(`📡 Scrape Finished. Found ${data.length} incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 REFRESH: " + pacificTime,
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ Sync successful at " + pacificTime);
        }

    } catch (err) {
        console.error("💥 Error:", err.message);
    } finally {
        await browser.close();
    }
}
run();
