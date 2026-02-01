const data = await page.evaluate(() => {
    const results = [];
    
    // CORRECT SELECTOR: PulsePoint uses a specific card structure
    const rows = Array.from(document.querySelectorAll('div[role="button"]')).filter(el => {
        const text = el.innerText || '';
        return text.includes('Medical Emergency') || 
               text.includes('FIRE') || 
               text.includes('Emergency') ||
               text.match(/\d{1,2}:\d{2}\s*[AP]M/);
    });
    
    console.log("DEBUG: Found", rows.length, "incident cards");
    
    if (rows.length > 0) {
        console.log("DEBUG: First card HTML:", rows[0].outerHTML.substring(0, 800));
        console.log("DEBUG: First card text:", rows[0].innerText);
    }
    
    rows.forEach((card, idx) => {
        try {
            const text = card.innerText;
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            
            console.log(`DEBUG: Card ${idx} lines:`, lines);
            
            // Parse the structure from your screenshot:
            // Line 0: Agency (e.g., "Tualatin Valley F&R")
            // Line 1: Type (e.g., "Medical Emergency") 
            // Line 2: Address
            // Last line: Units (colored badges)
            
            let agency = "Unknown";
            let type = "Emergency";
            let address = "Restricted";
            let time = "Active";
            let units = [];
            
            // Get agency (first line, before timestamp)
            if (lines.length > 0) {
                const firstLine = lines[0];
                const timeMatch = firstLine.match(/\d{1,2}:\d{2}\s*[AP]M/);
                if (timeMatch) {
                    agency = firstLine.replace(timeMatch[0], '').trim();
                    time = timeMatch[0];
                } else {
                    agency = firstLine;
                }
            }
            
            // Get type (usually "Medical Emergency")
            if (lines.length > 1) {
                type = lines[1];
            }
            
            // Get address (usually third line, has comma or street keywords)
            if (lines.length > 2) {
                const addressLine = lines.find(l => 
                    l.includes(',') || 
                    l.match(/\b(AVE|ST|RD|BLVD|DR|WAY|LANE|CT|CIRCLE|HIGHWAY)\b/i)
                );
                if (addressLine) {
                    address = addressLine;
                }
            }
            
            // Extract time from anywhere in text
            const timeMatch = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/);
            if (timeMatch) {
                time = timeMatch[1];
            }
            
            // Get units - they're in colored spans/divs
            card.querySelectorAll('span, div').forEach(el => {
                const style = window.getComputedStyle(el);
                const elText = el.innerText.trim();
                const bgColor = style.backgroundColor;
                
                // Units have colored backgrounds (red, green, yellow)
                // Match patterns like: AMR113, E34, M32, E315, etc.
                if (bgColor !== 'rgba(0, 0, 0, 0)' && 
                    elText.length > 0 && 
                    elText.length < 15 &&
                    !elText.includes('\n') &&
                    elText.match(/^[A-Z]{1,4}\d{1,4}$/)) {
                    
                    // Determine status by color
                    let status = elText;
                    const rgb = bgColor.match(/\d+/g);
                    if (rgb) {
                        const r = parseInt(rgb[0]);
                        const g = parseInt(rgb[1]);
                        
                        if (r > 200 && g < 100) {
                            status = `${elText} (On Scene)`;
                        } else if (g > 200 && r > 200) {
                            status = `${elText} (To Hospital)`;
                        } else if (g > 150) {
                            status = `${elText} (En Route)`;
                        }
                    }
                    
                    units.push(status);
                }
            });
            
            // Fallback: extract unit patterns from last line
            if (units.length === 0 && lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                const unitPattern = /\b([A-Z]{1,4}\d{1,4})\b/g;
                const matches = lastLine.match(unitPattern);
                if (matches) {
                    units = matches;
                }
            }
            
            results.push({
                agency: agency,
                type: type,
                time: time,
                address: address,
                unitStatuses: [...new Set(units)],
                rawText: text.substring(0, 300)
            });
            
        } catch (err) {
            console.error("Error parsing card", idx, ":", err.message);
        }
    });
    
    return results;
});
