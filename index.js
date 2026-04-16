import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import { execa } from 'execa';
import { blue, green, red, yellow, bold, cyan } from 'colorette';

// --- CONFIGURATION ---
const OPENROUTER_API_KEY = "whatever, payment required lol";
const MODEL = "openai/gpt-5.2";
const RETRY_LIMIT = 3;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function callOpenRouter(system, prompt) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system + " Respond ONLY with valid JSON. No prose." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    console.log(response);
    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (err) {
    console.error(red("OpenRouter Error: " + err.message));
    process.exit(1);
  }
}

async function runCactroSprints() {
  console.log(cyan(bold("\n--- CACTRO AGENT V1 (NODE + EXECA) ---")));
  
  const userPrompt = await rl.question(bold("What do you want to build? "));
  const dirName = await rl.question(bold("Enter directory name for the project: "));
  const targetDir = path.resolve(process.cwd(), dirName);

  // 1. PRD SYNTHESIZER
  const spec = await callOpenRouter(
    "Analyze user intent. Output JSON: { techStack: 'nodejs' | 'fastapi', appDescription: string }",
    userPrompt
  );
  console.log(green(`✔ Target Stack: ${spec.techStack}`));

  // 2. LLM CORE (Generate)
  let projectData = await callOpenRouter(
    `Generate a single-file app for ${spec.techStack}. Use port 3000. Output JSON: { files: [{ name: string, content: string }] }`,
    spec.appDescription
  );

  // Ensure directory exists
  await fs.mkdir(targetDir, { recursive: true });

  let attempt = 0;
  let success = false;

  while (attempt < RETRY_LIMIT && !success) {
    attempt++;
    console.log(blue(`\n🔍 Attempt ${attempt}/${RETRY_LIMIT}`));

    // 3. TOOL ORCHESTRATOR
    for (const file of projectData.files) {
      const filePath = path.join(targetDir, file.name);
      await fs.writeFile(filePath, file.content);
      console.log(yellow(`  📝 Written: ${file.name} in ${dirName}/`));
    }

    let subprocess;
    try {
      console.log(cyan("  ⚙️ Starting server..."));
      
      // Using execa template literals with .opt to set the working directory
      if (spec.techStack === 'fastapi') {
        subprocess = execa({ cwd: targetDir })`uvicorn main:app --host 127.0.0.1 --port 3000`;
      } else {
        const entryFile = projectData.files[0].name;
        subprocess = execa({ cwd: targetDir })`node ${entryFile}`;
      }

      await sleep(2500); // Boot time

      // 4. SELF-EVALUATION (CURL)
      console.log(cyan("  🧪 Testing endpoint..."));
      const { stdout } = await execa`curl -I http://127.0.0.1:3000`;

      if (stdout.includes("200")) {
        console.log(green(bold("  ✅ PASS: App is alive!")));
        success = true;
      } else {
        throw new Error("Server responded but not with 200 OK");
      }
    } catch (err) {
      const errorLog = err.all || err.message;
      console.log(red(`  ❌ FAIL: ${errorLog}`));
      
      if (attempt < RETRY_LIMIT) {
        console.log(blue("  🔧 Asking LLM for a fix..."));
        projectData = await callOpenRouter(
          "The previous code failed. Fix the errors. Output JSON: { files: [{ name: string, content: string }] }",
          `Error: ${errorLog}\nCurrent Files: ${JSON.stringify(projectData.files)}`
        );
      }
    } finally {
      if (subprocess) subprocess.kill();
    }
  }

  success ? console.log(green(bold(`\n✨ SHIPPED! Check the "${dirName}" folder.`))) : console.log(red(bold("\n🚫 FAILED.")));
  rl.close();
}

runCactroSprints();