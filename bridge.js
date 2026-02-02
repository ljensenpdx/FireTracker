import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { LRUCache } from 'lru-cache';

puppeteer.use(StealthPlugin());
const localCache = new LRUCache({ max: 10 });

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new",
        executablePath: '/usr/bin/google-chrome', 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
    });
    
    const page = await browser.newPage();
    
    // 🕒 FORCE PACIFIC TIME IN BROWSER
    await page.emulateTimezone('America/Los_Angeles');
    
    page.setDefaultNavigationTimeout(90000); 

    try {
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { waitUntil: 'networkidle2' });
        await page.waitForSelector('.css-i11ep2', { timeout: 45000 });

        const data = await page.evaluate(() => {
            const results = [];
            const cards = Array.from(document.querySelectorAll('.css-i11ep2'));
            
            const statusMap = {
                'css-vni3px': 'Toned Out', 'css-kne7t2': 'En Route',
                'css-qvlduj': 'On Scene', 'css-1oizron': 'To Hospital',
                'css-1tgt22r': 'At Hospital', 'css-xts122': 'Cleared'
            };

            cards.forEach(card => {
                const agency = card.firstChild?.innerText?.trim() || "Unknown Agency";
                
                // 🚨 CLASS-BASED TARGETING
                const typeEl = card.querySelector('.css-bgqa2g'); // Call Type
                const timeEl = card.querySelector('.css-1wbyehr'); // Incident Time
                
                const type = typeEl ? typeEl.innerText.trim() : "EMERGENCY";
                const time = timeEl ? timeEl.innerText.trim() : "ACTIVE";
                
                // Address logic (Find remaining text line)
                const lines = card.innerText.split('\n').map(l => l.trim());
                const address = lines.find(l => 
                    l !== agency && l !== time && l !== type && 
                    (l.includes(',') || l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LN|CT|CIR)\b/i))
                ) || "ADDRESS RESTRICTED";

                const unitStatuses = [];
                Object.keys(statusMap).forEach(className => {
                    card.querySelectorAll(`.${className}`).forEach(badge => {
                        const unitID = badge.innerText.trim();
                        if (unitID) unitStatuses.push(`${unitID} (${statusMap[className]})`);
                    });
                });

                results.push({ agency, type, address, time, unitStatuses: [...new Set(unitStatuses)] });
            });
            return results;
        }) || [];

        const currentDataString = JSON.stringify(data);
        const previousDataString = localCache.get('last_push');

        if (currentDataString === previousDataString) {
            console.log("♻️ STANDBY: No scene changes.");
        } else if (data.length > 0) {
            const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            const pstTime = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).format(new Date());

            await axios.put(ghUrl, {
                message: `📟 SYNC [${pstTime} PST]`,
                content: Buffer.from(currentDataString).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            localCache.set('last_push', currentDataString);
            console.log(`✅ SYNC COMPLETE: ${pstTime}`);
        }
    } catch (err) {
        console.error("💥 ERROR:", err.message);
    } finally {
        await browser.close();
    }
}
run();
