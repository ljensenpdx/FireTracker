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

        await page.waitForSelector('.css-i11ep2', { timeout: 30000 });

        const data = await page.evaluate(() => {
            const results = [];
            const allElements = Array.from(document.querySelectorAll('.css-i11ep2, h2, .header_class')); // Target cards and headers

            let isPastRecentHeader = false;

            // 🗺️ FULL STATUS MAP (Includes Cleared)
            const statusMap = {
                'css-vni3px': 'Toned Out',
                'css-kne7t2': 'En Route',
                'css-qvlduj': 'On Scene',
                'css-1oizron': 'To Hospital',
                'css-1tgt22r': 'At Hospital',
                'css-xts122': 'Cleared'
            };

            for (const el of allElements) {
                const text = el.innerText || "";

                // 🛑 STOP SIGN: If we hit the "Recent" section, stop adding to results
                if (text.includes("Recent") && (el.tagName === 'H2' || text.length < 15)) {
                    isPastRecentHeader = true;
                    break; 
                }

                // If it's a card and we are still in the Active section
                if (el.classList.contains('css-i11ep2') && !isPastRecentHeader) {
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    // Skip the very first "Active" summary box
                    if (lines[0] === "Active" || lines.length < 3) continue;

                    const agency = lines[0];
                    const timeMatch = text.match(/\d{1,2}:\d{2}\s*[AP]M/);
                    const time = timeMatch ? timeMatch[0] : "Active";
                    const type = lines.find(l => l !== agency && l !== time) || "Emergency";
                    const address = lines.find(l => 
                        l !== agency && l !== time && l !== type && 
                        (l.includes(',') || l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LN|CT|CIR)\b/i))
                    ) || "Location Restricted";

                    // 🚑 UNIT STATUS SCANNER (Grabs everything)
                    const units = [];
                    Object.keys(statusMap).forEach(className => {
                        const unitBadges = el.querySelectorAll(`.${className}`);
                        unitBadges.forEach(badge => {
                            const unitID = badge.innerText.trim();
                            if (unitID) {
                                units.push(`${unitID} (${statusMap[className]})`);
                            }
                        });
                    });

                    results.push({ agency, type, address, time, unitStatuses: [...new Set(units)] });
                }
            }
            return results;
        });

        console.log(`📡 Captured ${data.length} incidents from the ACTIVE section.`);

        // --- PUSH TO GITHUB ---
        const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
        let sha = "";
        try {
            const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) {}

        await axios.put(ghUrl, {
            message: "📟 ACTIVE-FOLDER SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
