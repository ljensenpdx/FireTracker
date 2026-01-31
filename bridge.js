const puppeteer = require('puppeteer');
const axios = require('axios');

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
    
    // Set a standard window size so elements aren't hidden
    await page.setViewport({ width: 1280, height: 1000 });

    try {
        console.log("🌐 Navigating to PulsePoint...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 120000 // 2 minute total patience
        });

        console.log("⏳ Waiting for incident rows to appear...");
        // This looks for the actual table rows that hold the fire calls
        await page.waitForSelector('div[role="row"], tr', { timeout: 60000 });

        const data = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('div[role="row"], tr'));
            for (const row of rows) {
                if (row.innerText.includes('Recent')) break;
                const lines = row.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                const time = lines.find(l => l.match(/\d{1,2}:\d{2}\s[AP]M/));
                if (time) {
                    results.push({
                        agency: lines[0].toUpperCase(),
                        type: lines[2] || "Emergency",
                        time: time,
                        address: lines.find(l => l.includes(',')) || "Restricted"
                    });
                }
            }
            return results;
        });

        console.log(`📡 Found ${data.length} incidents. Pushing to GitHub...`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            const base64Content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
            
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 AUTO-SYNC: " + new Date().toLocaleTimeString(),
                content: base64Content,
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            console.log("✅ Sync Complete!");
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
        process.exit(1); // Tell GitHub it failed so we get the Red X alert
    } finally {
        await browser.close();
    }
}

run();
