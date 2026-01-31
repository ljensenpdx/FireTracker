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
    
    try {
        console.log("🌐 Navigating to PulsePoint...");
        // Use a 2-minute timeout for the initial load
        await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle0', 
            timeout: 120000 
        });

        console.log("⏳ Waiting for table to stabilize...");
        await new Promise(r => setTimeout(r, 20000)); // Increase wait to 20s

        const data = await page.evaluate(() => {
            const results = [];
            // NEW: Look for multiple possible containers
            const rows = Array.from(document.querySelectorAll('.incident_row, [role="row"], tr')).filter(r => r.innerText.length > 30);
            
            rows.forEach(row => {
                if (row.innerText.includes('Recent')) return;
                const text = row.innerText;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                
                // Better Time Detection
                const timeMatch = text.match(/\d{1,2}:\d{2}\s[AP]M/);
                
                results.push({
                    agency: lines[0] || "Unknown",
                    type: lines[2] || "Emergency",
                    time: timeMatch ? timeMatch[0] : "Just Now",
                    address: lines.find(l => l.includes(',')) || "Location Restricted",
                    lastUpdated: new Date().toLocaleTimeString() // FORCE a new timestamp
                });
            });
            return results;
        });

        console.log(`📡 Scrape complete. Found ${data.length} incidents.`);

        if (data.length > 0) {
            const url = `https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`;
            
            // 1. Get current file's SHA (required for update)
            let sha = "";
            try {
                const res = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = res.data.sha;
            } catch (e) { console.log("New file will be created."); }

            // 2. Push the update
            const base64Content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
            await axios.put(url, {
                message: "📟 SYNC UPDATE: " + new Date().toLocaleString(),
                content: base64Content,
                sha: sha || undefined
            }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            
            console.log("✅ GitHub updated successfully.");
        } else {
            console.log("⚠️ No incidents found. Check the selectors.");
        }

    } catch (err) {
        console.error("💥 Critical Failure:", err.message);
    } finally {
        await browser.close();
    }
}
run();
