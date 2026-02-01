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
        executablePath: '/usr/bin/google-chrome', // Use the runner's built-in Chrome
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ] 
    });
    
    const page = await browser.newPage();
    
    // 🌍 SETTING: Force Portland Time and Mobile View
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 390, height: 844 }); // iPhone-sized for list view
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

    try {
        console.log("🕵️ Navigating PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // 🖱️ HUMAN INTERACTION: Slight scroll to trigger data load
        console.log("🖱️ Mimicking scroll...");
        await page.mouse.wheel({ deltaY: 300 });
        await new Promise(r => setTimeout(r, 5000));

        // ⏳ WAIT: We'll wait for ANY element that looks like a row
        console.log("⏳ Watching for list population...");
        await page.waitForSelector('.incident_row, div[role="button"]', { timeout: 45000 });

        const data = await page.evaluate(() => {
            const results = [];
            // Target the containers we saw in the screenshot
            const cards = Array.from(document.querySelectorAll('.incident_row, div[role="button"]'))
                               .filter(el => el.innerText.length > 50 && !el.innerText.includes('Recent'));
            
            cards.forEach((card) => {
                const text = card.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                
                // Agency is line 0, Type is line 1 (e.g. Medical Emergency)
                const agency = lines[0] || "Unknown";
                const type = lines[1] || "Emergency";
                const address = lines.find(l => l.includes(',')) || "Restricted";
                const time = text.match(/\d{1,2}:\d{2}\s*[AP]M/)?.[0] || "Active";
                
                // UNIT CAPTURE: Looking for the colored badges
                const units = [];
                card.querySelectorAll('*').forEach(el => {
                    const style = window.getComputedStyle(el);
                    const val = el.innerText.trim();
                    // Grab short text with a background (The unit IDs)
                    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && val.length > 0 && val.length < 8) {
                        units.push(val);
                    }
                });
                
                results.push({ agency, type, time, address, unitStatuses: [...new Set(units)] });
            });
            return results;
        });

        console.log(`📡 Success! Captured ${data.length} incidents.`);

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
            console.log("✅ GitHub Updated.");
        }

    } catch (err) {
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
