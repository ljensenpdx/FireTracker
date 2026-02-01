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
    // Use the narrow viewport to keep the interface simple while loading
    await page.setViewport({ width: 400, height: 800 });
    
    let capturedData = null;

    // 📡 INTERCEPTOR: Listens for the exact URL from your screenshot
    page.on('response', async (response) => {
        const url = response.url();
        // Matching the pattern found in your Network tab images
        if (url.includes('api.pulsepoint.org/v1/webapp?resource=incidents')) {
            try {
                const json = await response.json();
                if (json && json.incidents) {
                    capturedData = json.incidents;
                    console.log(`📡 Captured ${capturedData.length} raw incidents from the API!`);
                }
            } catch (e) { /* Ignore non-JSON responses */ }
        }
    });

    try {
        console.log("🕵️ Triggering PulsePoint data feed...");
        // Use the agency list from your screenshot for the URL
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Wait 15s for the API response to be captured
        await new Promise(r => setTimeout(r, 15000));

        if (!capturedData) {
            throw new Error("API data not intercepted. Check if PulsePoint blocked the IP.");
        }

        // 🛠️ DATA CLEANING: Map the raw API fields to your format
        const cleanData = capturedData.map(inc => ({
            agency: inc.agency_name || "Unknown",
            type: inc.pulsepoint_incident_description || "Emergency",
            address: inc.full_address || "Restricted",
            time: new Date(inc.call_received_datetime).toLocaleTimeString("en-US", { 
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' 
            }),
            // API provides clean unit lists directly
            unitStatuses: inc.units ? inc.units.map(u => u.unit_id) : []
        }));

        console.log(`✅ Success! Syncing ${cleanData.length} incidents.`);

        // --- PUSH TO GITHUB ---
        const ghUrl = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
        let sha = "";
        try {
            const res = await axios.get(ghUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) {}

        await axios.put(ghUrl, {
            message: "📟 API SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
            content: Buffer.from(JSON.stringify(cleanData, null, 2)).toString('base64'),
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

        console.log("🚀 GitHub Updated.");

    } catch (err) {
        console.error("💥 Sync Failed:", err.message);
        await page.screenshot({ path: 'debug_error.png' });
    } finally {
        await browser.close();
    }
}
run();
