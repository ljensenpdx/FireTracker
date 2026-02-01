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
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Use the main container class you found earlier to ensure the list is loaded
        await page.waitForSelector('.css-i11ep2', { timeout: 30000 });

        const data = await page.evaluate(() => {
            const results = [];
            const cards = Array.from(document.querySelectorAll('.css-i11ep2'));

            // 🗺️ YOUR STATUS MAP
            const statusMap = {
                'css-vni3px': 'Toned Out',
                'css-kne7t2': 'En Route',
                'css-qvlduj': 'On Scene',
                'css-1oizron': 'To Hospital',
                'css-1tgt22r': 'At Hospital',
                'css-xts122': 'Cleared'
            };

            cards.forEach(card => {
                const text = card.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                
                const agency = lines[0] || "Unknown";
                const type = lines[1] || "Emergency";
                const address = lines.find(l => l.match(/\d/) && (l.includes(',') || l.length > 5)) || "Restricted";
                const time = text.match(/\d{1,2}:\d{2}\s*[AP]M/)?.[0] || "Active";

                // 🚑 UNIT STATUS SCANNER
                const units = [];
                // Look for any element that matches your provided classes
                Object.keys(statusMap).forEach(className => {
                    const unitBadges = card.querySelectorAll(`.${className}`);
                    unitBadges.forEach(badge => {
                        const unitID = badge.innerText.trim();
                        if (unitID) {
                            units.push(`${unitID} (${statusMap[className]})`);
                        }
                    });
                });

                results.push({ agency, type, address, time, unitStatuses: [...new Set(units)] });
            });
            return results;
        });

        console.log(`📡 Captured ${data.length} incidents with precise unit statuses.`);

        // --- PUSH TO GITHUB ---
        const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
        let sha = "";
        try {
            const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) {}

        await axios.put(ghUrl, {
            message: "📟 STATUS-SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

        console.log("🚀 GitHub Updated.");

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
        await page.screenshot({ path: 'debug_error.png' });
    } finally {
        await browser.close();
    }
}
run();
