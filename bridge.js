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
    
    // Set a massive viewport so we don't have to scroll to see units
    await page.setViewport({ width: 1920, height: 3000 });

    try {
        console.log("🌐 Navigating with Cache-Buster...");
        // Adding a timestamp to the URL forces PulsePoint to give us fresh data
        const cacheBuster = `&_t=${Date.now()}`;
        const url = "https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219" + cacheBuster;
        
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });

        console.log("⏳ Waiting for the live data to populate...");
        await new Promise(r => setTimeout(r, 25000)); // 25s wait for those units to pop

        const data = await page.evaluate(() => {
            const results = [];
            // Target the main container that holds active calls
            const rows = Array.from(document.querySelectorAll('div[role="row"], .incident_row'));
            
            rows.forEach(row => {
                const text = row.innerText;
                // SKIP "Recent" (closed) incidents - usually found after a separator
                if (text.includes('Recent Incidents') || text.length < 50) return;

                // 1. Better Time Detection
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                
                // 2. Surgical Unit Extraction
                // We look for every single child element that has a background color
                const unitMap = { "On Scene": [], "En Route": [], "Dispatched": [] };
                const allElements = Array.from(row.querySelectorAll('*'));

                allElements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const bgColor = style.backgroundColor;
                    const val = el.innerText.trim();
                    
                    // Filter for typical unit ID lengths (E1, L10, etc)
                    if (val.length > 0 && val.length < 8 && bgColor !== 'rgba(0, 0, 0, 0)') {
                        const rgb = bgColor.match(/\d+/g).map(Number);
                        
                        // Red-ish = On Scene
                        if (rgb[0] > 150 && rgb[1] < 120) unitMap["On Scene"].push(val);
                        // Green-ish = En Route
                        else if (rgb[1] > 150 && rgb[0] < 150) unitMap["En Route"].push(val);
                        // Others (Yellow/Blue/Grey) = Dispatched/Transport
                        else unitMap["Dispatched"].push(val);
                    }
                });

                // Remove duplicates (sometimes multiple elements hold the same unit name)
                const cleanUnits = (arr) => [...new Set(arr)].replace(/[?^*]/g, '');

                results.push({
                    agency: text.split('\n')[0]?.toUpperCase() || "UNKNOWN",
                    type: text.split('\n')[2] || "Emergency",
                    time: timeMatch ? timeMatch[0] : "Active",
                    address: text.split('\n').find(l => l.includes(',')) || "Restricted",
                    unitStatuses: Object.entries(unitMap)
                        .filter(([k, v]) => v.length > 0)
                        .map(([k, v]) => `${k}: ${[...new Set(v)].join(', ')}`)
                });
            });
            return results;
        });

        console.log(`📡 Success! Captured ${data.length} LIVE incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 LIVE REFRESH: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
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
