const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function run() {
    const GITHUB_TOKEN = process.env.GH_TOKEN;
    const GITHUB_USER = 'ljensenpdx';
    const REPO_NAME = 'FireTracker';
    const FILE_PATH = 'data.json';

    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    const page = await browser.newPage();
    
    // Enhanced stealth settings
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    await page.emulateTimezone('America/Los_Angeles');
    
    // 🚨 FORCE 400px WIDTH: This triggers PulsePoint's mobile "List-Only" view
    await page.setViewport({ width: 400, height: 1200 });

    try {
        console.log("🕵️ Navigating PulsePoint (Compact Mode)...");
        const response = await page.goto("https://web.pulsepoint.org/?agencies=00291,00144,00057,00042,00195,00233,00109,00485,00161,01200,00740,01260,00530,00016,00015,00165,00167,00176,00186,00219", { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });

        // SOLUTION 4: Check if we're blocked
        console.log("📡 Response Status:", response.status());
        const content = await page.content();
        console.log("📄 Page Title:", await page.title());
        console.log("🔍 Page contains 'incident':", content.toLowerCase().includes('incident'));
        console.log("🔍 Page contains 'medical':", content.toLowerCase().includes('medical'));
        console.log("🔍 Page length:", content.length, "characters");
        
        if (content.includes('Access Denied') || content.includes('Cloudflare') || content.includes('Just a moment')) {
            console.error("🚫 BLOCKED BY CLOUDFLARE/WAF - Detected protection page");
        }

        // SOLUTION 3: Take screenshot for debugging
        await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
        console.log("📸 Screenshot saved as debug-screenshot.png");

        // SOLUTION 2: Wait for specific content instead of blind timeout
        console.log("⏳ Waiting for incidents to load...");
        try {
            await page.waitForFunction(() => {
                const rows = document.querySelectorAll('.incident_row, [role="row"], div[class*="incident"], .list-item');
                const hasText = document.body.innerText.includes('MEDICAL') || 
                               document.body.innerText.includes('FIRE') ||
                               document.body.innerText.includes('Emergency');
                return rows.length > 0 || hasText;
            }, { timeout: 30000 });
            console.log("✅ Content detected!");
        } catch (waitError) {
            console.warn("⚠️ Timeout waiting for content, proceeding anyway...");
        }

        // Extra buffer time
        await new Promise(r => setTimeout(r, 8000));

        // SOLUTION 1: Enhanced data extraction with better selectors
        const data = await page.evaluate(() => {
            const results = [];
            
            // EXPANDED SELECTOR LIST
            const selectors = [
                '.incident_row',
                '[role="row"]',
                '.incident-item',
                '.list-item',
                'div[class*="incident"]',
                'div[class*="Incident"]',
                '[data-incident]',
                '.call-item',
                '.active-call'
            ];
            
            // Try all selectors and collect unique elements
            const allElements = new Set();
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => allElements.add(el));
            });
            
            const rows = Array.from(allElements).filter(r => 
                r.innerText && 
                r.innerText.length > 30 && 
                !r.innerText.includes('Recent') &&
                !r.innerText.includes('Loading')
            );
            
            console.log("DEBUG: Found", rows.length, "potential incident rows");
            
            // Debug: Show all div classes to help identify the right selector
            const allDivs = Array.from(document.querySelectorAll('div[class]'))
                .map(d => d.className)
                .filter((c, i, arr) => c && arr.indexOf(c) === i);
            console.log("DEBUG: Unique div classes on page:", allDivs.slice(0, 50));
            
            if (rows.length > 0) {
                console.log("DEBUG: First row HTML preview:", rows[0].outerHTML.substring(0, 500));
                console.log("DEBUG: First row text:", rows[0].innerText.substring(0, 200));
            }
            
            rows.forEach((row, idx) => {
                try {
                    const text = row.innerText;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    // ENHANCED UNIT HUNTER: Multiple strategies
                    const units = [];
                    
                    // Strategy 1: Colored badges (original method)
                    row.querySelectorAll('*').forEach(el => {
                        const style = window.getComputedStyle(el);
                        const bgColor = style.backgroundColor;
                        const text = el.innerText.trim();
                        if (bgColor !== 'rgba(0, 0, 0, 0)' && 
                            text.length > 0 && 
                            text.length < 12 &&
                            !text.includes('\n')) {
                            units.push(text);
                        }
                    });
                    
                    // Strategy 2: Look for unit patterns (E60, AMR119, etc)
                    const unitPattern = /\b([A-Z]{1,3}\d{1,4}|[A-Z]+\d+)\b/g;
                    const matches = text.match(unitPattern);
                    if (matches) {
                        matches.forEach(m => {
                            if (m.length < 12 && !units.includes(m)) {
                                units.push(m);
                            }
                        });
                    }
                    
                    // Strategy 3: Look for span/div with specific classes
                    row.querySelectorAll('.unit, .badge, [class*="unit"], [class*="badge"]').forEach(el => {
                        const text = el.innerText.trim();
                        if (text && text.length < 12 && !units.includes(text)) {
                            units.push(text);
                        }
                    });
                    
                    // ENHANCED PARSING: Try multiple patterns
                    let agency = lines[0] || "Unknown";
                    let type = "Emergency";
                    let time = "Active";
                    let address = "Restricted";
                    
                    // Look for time pattern
                    const timeMatch = text.match(/\d{1,2}:\d{2}\s*[AP]M/i);
                    if (timeMatch) time = timeMatch[0];
                    
                    // Look for address (contains comma or street keywords)
                    const addressLine = lines.find(l => 
                        l.includes(',') || 
                        l.match(/\b(ST|AVE|RD|BLVD|WAY|DR|LANE|COURT)\b/i)
                    );
                    if (addressLine) address = addressLine;
                    
                    // Type is usually after agency
                    if (lines.length > 2) {
                        const possibleType = lines.find(l => 
                            l.includes('MEDICAL') || 
                            l.includes('FIRE') || 
                            l.includes('TRAFFIC') ||
                            l.includes('Emergency')
                        );
                        if (possibleType) type = possibleType;
                    }
                    
                    results.push({
                        agency: agency,
                        type: type,
                        time: time,
                        address: address,
                        unitStatuses: [...new Set(units)],
                        rawText: text.substring(0, 200), // Include raw text for debugging
                        debug_lineCount: lines.length
                    });
                } catch (err) {
                    console.error("Error parsing row", idx, ":", err.message);
                }
            });
            
            return results;
        });

        // ENHANCED LOGGING
        console.log(`📡 Captured ${data.length} incidents at 400px width.`);
        console.log("📊 RAW DATA SAMPLE (first 2 records):");
        console.log(JSON.stringify(data.slice(0, 2), null, 2));
        
        if (data.length === 0) {
            console.error("❌ NO DATA CAPTURED - Check screenshot for page state");
            console.log("💡 This might mean:");
            console.log("   1. Selectors don't match current DOM structure");
            console.log("   2. Page is being blocked/protected");
            console.log("   3. Content hasn't loaded yet");
            console.log("   4. Agency IDs might be invalid");
        }

        // Only update GitHub if we have data
        if (data.length > 0) {
            console.log("📤 Attempting GitHub upload...");
            
            try {
                const res = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
                });

                await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/contents/${FILE_PATH}`, {
                    message: "📟 COMPACT SYNC: " + new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}),
                    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
                    sha: res.data.sha
                }, { 
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
                });
                
                console.log("✅ GitHub sync complete!");
            } catch (githubError) {
                console.error("❌ GitHub API Error:", githubError.response?.data || githubError.message);
            }
        } else {
            console.warn("⚠️ Skipping GitHub update - no data to upload");
        }

    } catch (err) {
        console.error("💥 Fatal Error:", err.message);
        console.error("Stack trace:", err.stack);
        
        // Try to get page content even on error
        try {
            const errorContent = await page.content();
            fs.writeFileSync('error-page.html', errorContent);
            console.log("📝 Error page HTML saved to error-page.html");
        } catch (e) {
            console.error("Could not save error page:", e.message);
        }
    } finally {
        await browser.close();
    }
}

run();
