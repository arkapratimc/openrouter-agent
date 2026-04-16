import { execa } from 'execa';
import { blue, green, red, yellow, bold } from 'colorette';
import axios from 'axios'; // For the OpenRouter calls

const RECENT_LOGS = [];
const RETRY_LIMIT = 3;

async function runCactroSprints(userPrompt) {
    console.log(blue(bold("🚀 Starting Cactro V1...")));

    // 1. PRD SYNTHESIZER
    const spec = await callOpenRouter("PRD_PROMPT", userPrompt);
    console.log(green("✔ Spec synthesized. Target: " + spec.techStack));

    // 2. LLM CORE (Plan & Generate)
    const files = await callOpenRouter("GENERATE_PROMPT", spec);
    
    // 3. TOOL ORCHESTRATOR (File Creation)
    for (const file of files) {
        await fs.writeFile(file.name, file.content);
        console.log(yellow(`📝 Created ${file.name}`));
    }

    // 4. EXECUTION + SELF-EVALUATION LOOP
    let attempt = 0;
    let success = false;

    while (attempt < RETRY_LIMIT && !success) {
        attempt++;
        console.log(blue(`\n🔍 Evaluation Attempt ${attempt}/${RETRY_LIMIT}`));

        try {
            // Start the app (detecting if it's npm start or uvicorn)
            const command = spec.techStack === 'fastapi' ? 'uvicorn' : 'node';
            const args = spec.techStack === 'fastapi' ? ['main:app', '--port', '3000'] : ['index.js'];
            
            const subprocess = execa(command, args);
            
            // Wait 2 seconds for boot then CURL
            await sleep(2000);
            const { stdout } = await execa('curl', ['-I', 'http://localhost:3000']);

            if (stdout.includes("200 OK")) {
                console.log(green(bold("✅ PASS: App is responsive!")));
                success = true;
                subprocess.kill(); 
            } else {
                throw new Error("CURL failed to see 200 OK");
            }

        } catch (err) {
            console.log(red(`❌ FAIL: ${err.message}`));
            
            // FEEDBACK TO LLM CORE
            const fix = await callOpenRouter("DEBUG_PROMPT", {
                error: err.message,
                files: files
            });
            
            // Apply Fixes
            await applyFixes(fix);
        }
    }

    if (success) {
        console.log(green(bold("\n✨ MVP SHIPPED SUCCESSFULLY")));
    } else {
        console.log(red(bold("\n🚫 MVP FAILED AFTER 3 RETRIES. Check logs.")));
    }
}