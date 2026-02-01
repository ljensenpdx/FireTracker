import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
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
        
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        // Wait 15 seconds to let any security checks (like Cloudflare) finish
        console.log("⏳ Waiting to see what loads...");
        await new Promise(r => setTimeout(r, 15000));

        console.log("📸 Taking diagnostic screenshot...");
        const screenshot = await page.screenshot({ encoding: 'base64' });

        // Get the SHA if the file already exists so we can overwrite it
        let currentSha = undefined;
        try {
            const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/DIAGNOSTIC_SCREEN.png`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });
            currentSha = res.data.sha;
        } catch (e) {
            console.log("No existing diagnostic image, creating new one.");
        }

        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/DIAGNOSTIC_SCREEN.png`, {
            message: "📸 Diagnostic: PulsePoint blocked screen",
            content: screenshot,
            sha: currentSha
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });

        console.log("✅ DIAGNOSTIC_SCREEN.png has been uploaded to your main folder.");

    } catch (err) {
        console.error("💥 Diagnostic Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
