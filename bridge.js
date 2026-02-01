import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    
    // 🚨 THE FIX: Force a narrow phone-sized width to kill the map
    await page.setViewport({ width: 400, height: 1200 }); 
    await page.emulateTimezone('America/Los_Angeles');

    try {
        console.log("🕵️ Navigating to PulsePoint (Mobile Mode)...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Wait for the mobile list to stabilize
        await new Promise(r => setTimeout(r, 15000));

        const data = await page.evaluate(() => {
            const results = [];
            // Target the specific incident cards found in the list view
            const cards = Array.from(document.querySelectorAll('.incident_row, div[role="button"]'))
                               .filter(el => el.innerText.length > 50 && !el.innerText.includes('Recent'));
            
            cards.forEach((card) => {
                const text = card.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                
                // Units like AMR113 or E35 are colored badges in the DOM
                const units = [];
                card.querySelectorAll('*').forEach(el => {
                    const style = window.getComputedStyle(el);
                    const val = el.innerText.trim();
                    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                        units.push(val);
                    }
                });

                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[1] || "Emergency",
                    address: lines.find(l => l.includes(',')) || "Location Restricted",
                    time: text.match(/\d{1,2}:\d{2}\s*[AP]M/)?.[0] || "Active",
                    unitStatuses: [...new Set(units)]
                });
            });
            return results;
        });

        console.log(`📡 Captured ${data.length} incidents in mobile view.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 MOBILE SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ GitHub Updated.");
        }

    } catch (err) {
        await page.screenshot({ path: 'debug_error.png' });
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
