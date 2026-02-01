import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { LRUCache } from 'lru-cache';

puppeteer.use(StealthPlugin());

// --- CACHE CONFIG ---
// We only need to remember the last state to compare.
const options = { max: 5 };
const localCache = new LRUCache(options);

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000); 

    try {
        console.log("🕵️ Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2' 
        });

        console.log("⏳ Waiting for incident cards...");
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
                const text = card.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                if (lines[0] === "Active" || lines[0] === "Recent" || lines.length < 3) return;

                const agency = lines[0];
                const timeMatch = text.match(/\d{1,2}:\d{2}\s*[AP]M/);
                const time = timeMatch ? timeMatch[0] : "Active";
                const type = lines.find(l => l !== agency && l !== time) || "Emergency";
                const address = lines.find(l => 
                    l !== agency && l !== time && l !== type && 
                    (l.includes(',') || l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LN|CT|CIR)\b/i))
                ) || "Location Restricted";

                const unitStatuses = [];
                Object.keys(statusMap).forEach(className => {
                    card.querySelectorAll(`.${className}`).forEach(badge => {
                        if (badge.innerText.trim()) unitStatuses.push(`${badge.innerText.trim()} (${statusMap[className]})`);
                    });
                });

                results.push({ agency, type, address, time, unitStatuses: [...new Set(unitStatuses)] });
            });
            return results;
        }) || [];

        // --- 🧠 LRU-CACHE LOGIC ---
        const currentDataString = JSON.stringify(data);
        const previousDataString = localCache.get('last_push');

        if (currentDataString === previousDataString) {
            console.log("♻️ DATA UNCHANGED: Skipping GitHub commit to prevent redundancy.");
        } else if (data.length > 0) {
            console.log(`📡 CHANGE DETECTED: Found ${data.length} incidents. Updating GitHub...`);
            
            const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            const timeStamp = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
            await axios.put(ghUrl, {
                message: `📟 SYNC [${timeStamp}]`,
                content: Buffer.from(currentDataString).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            // Save current state to cache after successful push
            localCache.set('last_push', currentDataString);
            console.log("✅ GitHub Updated.");
        } else {
            console.log("⚠️ No active incidents found.");
        }
    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
