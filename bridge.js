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
    await page.emulateTimezone('America/Los_Angeles');

    try {
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { waitUntil: 'networkidle2' });
        await page.waitForSelector('.css-i11ep2', { timeout: 45000 });

        const data = await page.evaluate(() => {
            const results = [];
            // Target all incident cards
            const cards = Array.from(document.querySelectorAll('.css-i11ep2'));
            
            const statusMap = {
                'css-vni3px': 'Toned Out', 'css-kne7t2': 'En Route',
                'css-qvlduj': 'On Scene', 'css-1oizron': 'To Hospital',
                'css-1tgt22r': 'At Hospital', 'css-xts122': 'Cleared'
            };

            for (const card of cards) {
                const text = card.innerText || "";
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);

                // 🛑 STOP if we reach the Recent section
                if (text.includes("Recent\n(")) break;
                
                // ⏭️ SKIP the Active section header
                if (text.includes("Active\n(")) continue;

                // 🏷️ TARGET specific elements for clean data
                const typeEl = card.querySelector('.css-bgqa2g'); 
                const timeEl = card.querySelector('.css-1wbyehr');
                
                const agency = lines[0]; // Line 1 is always the Agency Name
                const type = typeEl ? typeEl.innerText.trim() : "Emergency";
                const time = timeEl ? timeEl.innerText.trim() : "Active";

                // 🚑 MEDICAL/LIFT ASSIST FILTER
                // Skips any medical, assist, or health related calls
                const isMedical = /MEDICAL|MEDIC|HEALTH|SICK|INJURY|LIFT ASSIST|ASSIST/i.test(type);
                if (isMedical) continue;

                // 📍 ADDRESS LOGIC
                // Look for the line that looks like an address and isn't a known field
                const address = lines.find(l => 
                    l !== agency && l !== time && l !== type && 
                    (l.includes(',') || l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LN|CT|CIR)\b/i))
                ) || "Address Restricted";

                const unitStatuses = [];
                Object.keys(statusMap).forEach(className => {
                    card.querySelectorAll(`.${className}`).forEach(badge => {
                        const id = badge.innerText.trim();
                        if (id) unitStatuses.push(`${id} (${statusMap[className]})`);
                    });
                });

                results.push({ agency, type, address, time, unitStatuses: [...new Set(unitStatuses)] });
            }
            return results;
        }) || [];

        // --- COMMIT LOGIC ---
        const currentDataString = JSON.stringify(data);
        if (localCache.get('last_push') !== currentDataString && data.length > 0) {
            const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            const pstNow = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit'
            }).format(new Date());

            await axios.put(ghUrl, {
                message: `📟 SYNC [${pstNow} PST] - FIRE ONLY`,
                content: Buffer.from(currentDataString).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            localCache.set('last_push', currentDataString);
            console.log(`✅ ${data.length} LIVE FIRE INCIDENTS SYNCED AT ${pstNow}`);
        }
    } catch (err) {
        console.error("💥 Error:", err.message);
    } finally {
        await browser.close();
    }
}
run();
