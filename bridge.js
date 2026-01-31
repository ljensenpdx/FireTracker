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
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🌐 Navigating...");
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 90000 
        });

        // 🚨 NEW: Wait for the specific container that holds the list
        console.log("⏳ Waiting for incident container...");
        await page.waitForSelector('.incident_list, [role="grid"]', { timeout: 30000 }).catch(() => console.log("Timeout waiting for selector."));

        // 🚨 NEW: Human Interaction (Scroll down 100px and back up)
        await page.mouse.wheel({ deltaY: 100 });
        await new Promise(r => setTimeout(r, 2000));
        await page.mouse.wheel({ deltaY: -100 });

        console.log("⏳ Stabilizing for 15 seconds...");
        await new Promise(r => setTimeout(r, 15000));

        const data = await page.evaluate(() => {
            const results = [];
            // Target the actual row elements
            const rows = Array.from(document.querySelectorAll('div[role="row"], tr')).filter(r => r.innerText.length > 30);
            
            rows.forEach(row => {
                const text = row.innerText;
                if (text.includes('Recent') || text.length < 20) return;

                // Grab Units by looking for elements with background colors (Chips)
                const units = [];
                const chips = Array.from(row.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && el.innerText.trim().length > 0 && el.innerText.trim().length < 8;
                });
                chips.forEach(c => units.push(c.innerText.trim().replace(/[?^*]/g, '')));

                const lines = text.split('\n').map(l => l.trim());
                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: text.match(/\d{1,2}:\d{2}\s[AP]M/)?.[0] || "Active",
                    address: lines.find(l => l.includes(',')) || "Restricted",
                    unitStatuses: [...new Set(units)]
                });
            });
            return results;
        });

        console.log(`📡 Success! Found ${data.length} incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) {}

            await axios.put(url, {
                message: "📟 UPDATE: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        } else {
            // Log the HTML structure if it fails to see what's actually there
            console.log("Empty data. Current body text starts with: " + (await page.evaluate(() => document.body.innerText.substring(0, 100))));
        }

    } catch (err) {
        console.error("💥 Run Failed:", err.message);
    } finally {
        await browser.close();
    }
}
run();
