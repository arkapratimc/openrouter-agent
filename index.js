import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import { execa } from 'execa';
import { blue, green, red, yellow, bold, cyan } from 'colorette';

// --- CONFIGURATION ---
const MODEL = "qwen/qwen3-4b-2507";
const LMSTUDIO_URL = "http://localhost:1234/api/v1/chat";
const RETRY_LIMIT = 3;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function callLMStudio(system, prompt) {
  try {
    const response = await fetch(LMSTUDIO_URL, {
      method: "POST",
      headers: {

        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        system_prompt: system + " Respond ONLY with valid JSON. No prose.",
        input: prompt
      })
    });
    // console.log(response);
    const data = await response.json();
    const content = data.output?.find(item => item.type === "message")?.content;

    if (!content) {
      throw new Error("LM Studio returned no message content");
    }

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
  // PATH VALIDATION LOGIC:
  // 1. Prevent empty strings
  // 2. Prevent path traversal (no dots, no slashes)
  const isValidName = /^[a-zA-Z0-9_-]+$/.test(dirName);

  if (!isValidName) {
    console.error(red("Invalid directory name! Use only letters, numbers, hyphens, or underscores."));
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), "..", dirName);

  // 1. PRD SYNTHESIZER
  const spec = await callLMStudio(
    "Analyze user intent. Output JSON: { techStack: 'nodejs' | 'fastapi', appDescription: string }",
    userPrompt
  );
  console.log(green(`✔ Target Stack: ${spec.techStack}`));

  // 2. LLM CORE (Generate)
  let projectData = await callLMStudio(
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
        subprocess = execa({ cwd: targetDir, reject: false })`uvicorn main:app --host 127.0.0.1 --port 3000`;
      } else {
        const entryFile = projectData.files[0].name;
        subprocess = execa({ cwd: targetDir, reject: false })`node ${entryFile}`;
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
        projectData = await callLMStudio(
          "The previous code failed. Fix the errors. Output JSON: { files: [{ name: string, content: string }] }",
          `Error: ${errorLog}\nCurrent Files: ${JSON.stringify(projectData.files)}`
        );
      }
    } finally {
      if (subprocess) subprocess.kill();
    }
  }

  if (success) {
    console.log(green(bold(`\n✨ SHIPPED! Check the "${dirName}" folder.`)));

    // POST-SUCCESS ITERATION LOOP
    while (true) {
      const modification = await rl.question(bold("\n🔧 Want to modify? (describe change or type 'exit'): "));

      if (modification.toLowerCase() === 'exit') {
        console.log(cyan("👋 Done. Goodbye!"));
        break;
      }

      console.log(blue("  ✏️ Asking LLM to update the code..."));

      projectData = await callLMStudio(
        `Modify the existing ${spec.techStack} app. Keep all current functionality. Output JSON: { files: [{ name: string, content: string }] }`,
        `Current files: ${JSON.stringify(projectData.files)}\n\nUser request: ${modification}`
      );

      // Write updated files
      for (const file of projectData.files) {
        const filePath = path.join(targetDir, file.name);
        await fs.writeFile(filePath, file.content);
        console.log(yellow(`  📝 Updated: ${file.name}`));
      }

      console.log(green(bold("  ✅ Changes applied!")));
    }

  } else {
    console.log(red(bold("\n🚫 FAILED.")));
  }

  rl.close();
}

runCactroSprints();