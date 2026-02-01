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
    let interceptedData = null;

    // 📡 Intercept the actual data feed
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('getIncidents') || url.includes('active_incidents')) {
            try {
                interceptedData = await response.json();
                console.log("📡 Data packet intercepted!");
            } catch (e) {}
        }
    });

    try {
        console.log("🕵️ Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Wait a few seconds for the background data to fly in
        await new Promise(r => setTimeout(r, 10000));

        if (!interceptedData) {
            throw new Error("Could not intercept the data feed. Site might be blocking the runner.");
        }

        // 🛠️ Process the raw data into your clean format
        const cleanData = interceptedData.incidents.map(inc => ({
            agency: inc.agency_name || "Unknown",
            type: inc.pulsepoint_incident_description || "Emergency",
            address: inc.full_address || "Restricted",
            time: new Date(inc.call_received_datetime).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' }),
            unitStatuses: inc.units ? inc.units.map(u => u.unit_id) : []
        }));

        console.log(`✅ Success! Extracted ${cleanData.length} incidents from API.`);

        // --- PUSH TO GITHUB ---
        const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
        let sha = "";
        try {
            const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) {}

        await axios.put(url, {
            message: "📟 API SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
            content: Buffer.from(JSON.stringify(cleanData, null, 2)).toString('base64'),
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

    } catch (err) {
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
