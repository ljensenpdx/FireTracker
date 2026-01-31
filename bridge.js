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
            '--lang=en-US,en',
            '--force-color-profile=srgb'
        ] 
    });
    const page = await browser.newPage();
    
    // 🌍 FORCE THE BROWSER TO PORTLAND TIME
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        console.log("⏳ Deep-waiting for unit animations (30s)...");
        await new Promise(r => setTimeout(r, 30000));

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row')).filter(r => r.innerText.length > 50);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;

                // 🚨 TIME FIX: We grab the text, but we also create a 'Scrape Time' 
                // inside the browser while it's in the LA/Portland timezone.
                const text = row.innerText;
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                
                // 🚨 UNIT FIX: We scan for ANY element that has a background color.
                // PulsePoint units are almost always colored boxes.
                const units = [];
                const allElements = Array.from(row.querySelectorAll('*'));
                
                allElements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const bgColor = style.backgroundColor;
                    const val = el.innerText.trim();
                    
                    // Logic: Background is NOT transparent AND text is short (1-6 chars)
                    if (bgColor !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 7) {
                        units.push(val);
                    }
                });

                results.push({
                    agency: text.split('\n')[0] || "Unknown",
                    type: text.split('\n')[2] || "Emergency",
                    time: timeMatch ? timeMatch[0] : "Active",
                    address: text.split('\n').find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)], // Dedupes units found twice
                    localUpdateTime: new Date().toLocaleTimeString("en-US", {hour: '2-digit', minute:'2-digit'})
                });
            });
            return results;
        });

        console.log(`📡 Success! Found ${data.length} incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 REFRESH: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ Sync successful.");
        }
    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
