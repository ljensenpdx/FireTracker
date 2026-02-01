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
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Fetching PulsePoint Data...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', timeout: 60000 
        });

        await page.waitForSelector('.css-i11ep2', { timeout: 30000 });

        const data = await page.evaluate(() => {
            // ... (Your existing scraping/grouping logic here)
            // This part remains the same as our previous working version
        });

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            // 🏷️ THE RETITLE FIX: Generate unique commit message
            const timeStamp = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
            const commitMessage = `📟 SYNC [${timeStamp}] - ${data.length} ACTIVE`;

            await axios.put(url, {
                message: commitMessage,
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            console.log(`✅ GitHub Updated: ${commitMessage}`);
        }
    } catch (err) {
        console.error("💥 Sync Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
