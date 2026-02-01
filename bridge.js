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
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    
    // 🌍 Force Pacific Time and a 400px Narrow View to hide the map
    await page.emulateTimezone('America/Los_Angeles');
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // 🖱️ Give it time to load the mobile-style list
        console.log("⏳ Waiting for incident list to populate...");
        await new Promise(r => setTimeout(r, 20000));

        // --- YOUR SCRAPE LOGIC STARTS HERE ---
        const data = await page.evaluate(() => {
            const results = [];
            
            const rows = Array.from(document.querySelectorAll('div[role="button"]')).filter(el => {
                const text = el.innerText || '';
                return text.includes('Medical Emergency') || 
                       text.includes('FIRE') || 
                       text.includes('Emergency') ||
                       text.match(/\d{1,2}:\d{2}\s*[AP]M/);
            });
            
            rows.forEach((card, idx) => {
                try {
                    const text = card.innerText;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    let agency = "Unknown";
                    let type = "Emergency";
                    let address = "Restricted";
                    let time = "Active";
                    let units = [];
                    
                    if (lines.length > 0) {
                        const firstLine = lines[0];
                        const timeMatch = firstLine.match(/\d{1,2}:\d{2}\s*[AP]M/);
                        if (timeMatch) {
                            agency = firstLine.replace(timeMatch[0], '').trim();
                            time = timeMatch[0];
                        } else {
                            agency = firstLine;
                        }
                    }
                    
                    if (lines.length > 1) { type = lines[1]; }
                    
                    const addressLine = lines.find(l => 
                        l.includes(',') || 
                        l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LANE|CT|CIRCLE|HIGHWAY)\b/i)
                    );
                    if (addressLine) { address = addressLine; }
                    
                    // Unit Capture by Color Badge
                    card.querySelectorAll('span, div').forEach(el => {
                        const style = window.getComputedStyle(el);
                        const elText = el.innerText.trim();
                        const bgColor = style.backgroundColor;
                        
                        if (bgColor !== 'rgba(0, 0, 0, 0)' && 
                            elText.length > 0 && 
                            elText.length < 15 &&
                            elText.match(/^[A-Z]{1,4}\d{1,4}$/)) {
                            
                            let status = elText;
                            const rgb = bgColor.match(/\d+/g);
                            if (rgb) {
                                const r = parseInt(rgb[0]);
                                const g = parseInt(rgb[1]);
                                if (r > 200 && g < 100) { status = `${elText} (On Scene)`; }
                                else if (g > 150) { status = `${elText} (En Route)`; }
                            }
                            units.push(status);
                        }
                    });
                    
                    results.push({
                        agency, type, time, address,
                        unitStatuses: [...new Set(units)]
                    });
                } catch (e) {}
            });
            return results;
        });

        console.log(`📡 Captured ${data.length} incidents.`);

        // --- PUSH TO GITHUB ---
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
            console.log("✅ GitHub Updated.");
        }

    } catch (err) {
        // If it fails, take a screenshot for the Artifacts defined in your sync.yml
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
