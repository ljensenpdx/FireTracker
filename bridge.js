import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth');
import axios from 'axios';

puppeteer.use(StealthPlugin());

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log("🕵️ Attempting diagnostic navigation...");
        
        // Try to go to the site
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        // Wait 10 seconds to see what the final screen looks like
        await new Promise(r => setTimeout(r, 10000));

        console.log("📸 Taking diagnostic screenshot...");
        const screenshot = await page.screenshot({ encoding: 'base64' });

        // Upload the screenshot directly to your repo so you can see it
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/DIAGNOSTIC_SCREEN.png`, {
            message: "📸 Diagnostic: PulsePoint blocked screen",
            content: screenshot,
            // We need the SHA if the file already exists
            sha: await getSha(GITHUB_USER, REPO_NAME, 'DIAGNOSTIC_SCREEN.png', GITHUB_TOKEN)
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

        console.log("✅ Diagnostic image uploaded to your main folder as DIAGNOSTIC_SCREEN.png");

    } catch (err) {
        console.error("💥 Diagnostic Failed:", err.message);
    } finally {
        await browser.close();
    }
}

async function getSha(user, repo, path, token) {
    try {
        const res = await axios.get(`https://api.github.com/repos/${user}/${repo}/contents/${path}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        return res.data.sha;
    } catch (e) { return undefined; }
}
run();
