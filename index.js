import fs from 'fs/promises';
import { jsonrepair } from 'jsonrepair';
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
    const data = await response.json();
    const content = data.output?.find(item => item.type === "message")?.content;

    if (!content) {
      throw new Error("LM Studio returned no message content");
    }

    let cleaned = content.replace(/```json|```/g, "").trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      console.log(yellow("  ⚠️  Malformed JSON detected, attempting repair..."));
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired);
    }
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(red("LM Studio Error: " + err.message));
    process.exit(1);
  }
}

// Extracts all route paths from generated files so we can test them
async function getEndpoints(projectData) {
  try {
    const result = await callLMStudio(
      `Analyze the given code files. List ALL HTTP endpoints. Output JSON: { endpoints: [{ method: "GET"|"POST"|"PUT"|"DELETE", path: string, expectedStatus: number }] }`,
      `Files: ${JSON.stringify(projectData.files)}`
    );
    return result.endpoints || [];
  } catch {
    // Fallback: just test root
    return [{ method: "GET", path: "/", expectedStatus: 200 }];
  }
}

// Tests all endpoints against the running server
async function testAllEndpoints(endpoints) {
  const results = [];

  for (const ep of endpoints) {
    const url = `http://127.0.0.1:3000${ep.path}`;
    const method = ep.method.toUpperCase();

    try {
      let stdout;

      if (method === "GET") {
        ({ stdout } = await execa`curl -s -o NUL -w %{http_code} ${url}`);
      } else {
        ({ stdout } = await execa`curl -s -o NUL -w "%{http_code}" -X ${method} ${url}`);
      }

      const statusCode = stdout.trim().replace(/"/g, "");
      const passed = ep.expectedStatus
        ? parseInt(statusCode) === ep.expectedStatus
        : (statusCode.startsWith("2") || statusCode.startsWith("3"));

      results.push({ ...ep, statusCode, passed });

      if (passed) {
        console.log(green(`    ✅ ${method} ${ep.path} → ${statusCode}`));
      } else {
        console.log(red(`    ❌ ${method} ${ep.path} → ${statusCode} (expected ${ep.expectedStatus})`));
      }
    } catch (err) {
      results.push({ ...ep, statusCode: "ERR", passed: false });
      console.log(red(`    ❌ ${method} ${ep.path} → FAILED (${err.message})`));
    }
  }

  return results;
}
async function waitForServer(url, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await execa`curl -s -o NUL ${url}`;
      return true; // Server is up
    } catch {
      await sleep(500); // Wait 500ms and retry
    }
  }
  return false; // Server never came up
}
// Starts server, tests all endpoints, kills server
async function startAndTest(spec, projectData, targetDir) {
  let subprocess;

  try {
    console.log(cyan("  ⚙️  Starting server..."));

    if (spec.techStack === 'fastapi') {
      subprocess = execa({ cwd: targetDir, reject: false })`uvicorn main:app --host 127.0.0.1 --port 3000`;
    } else {
      const entryFile = projectData.files[0].name;
      subprocess = execa({ cwd: targetDir, reject: false })`node ${entryFile}`;
    }

    const serverReady = await waitForServer("http://127.0.0.1:3000");

    if (!serverReady) {
      console.log(red("  ❌ Server never became ready"));
      return { allPassed: false, results: [] };
    }
    console.log(green("  ✅ Server is ready!"));

    // Discover all endpoints from the code
    console.log(cyan("  🔍 Discovering endpoints..."));
    const endpoints = await getEndpoints(projectData);
    console.log(cyan(`  🧪 Testing ${endpoints.length} endpoint(s)...`));

    const results = await testAllEndpoints(endpoints);
    const allPassed = results.every(r => r.passed);

    return { allPassed, results };
  } catch (err) {
    console.log(red(`  ❌ Server error: ${err.message}`));
    // ADD THIS TO SEE THE ACTUAL CODE ERROR:
    if (subprocess && subprocess.all) console.log(yellow(subprocess.all));
    return { allPassed: false, results: [] };
  } finally {
    if (subprocess) subprocess.kill();
  }
}

async function runCactroSprints() {
  console.log(cyan(bold("\n--- CACTRO AGENT V1 (NODE + EXECA) ---")));

  const userPrompt = await rl.question(bold("What do you want to build? "));
  const dirName = await rl.question(bold("Enter directory name for the project: "));

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
    `Generate a single-file app for ${spec.techStack}. Use port 3000. Use ONLY built-in modules. Output JSON: { files: [{ name: string, content: string }] }`,
    spec.appDescription
  );

  // Ensure directory exists
  await fs.mkdir(targetDir, { recursive: true });

  // 3. BUILD + TEST LOOP
  let attempt = 0;
  let success = false;

  while (attempt < RETRY_LIMIT && !success) {
    attempt++;
    console.log(blue(`\n🔍 Attempt ${attempt}/${RETRY_LIMIT}`));

    for (const file of projectData.files) {
      const filePath = path.join(targetDir, file.name);
      await fs.writeFile(filePath, file.content);
      console.log(yellow(`  📝 Written: ${file.name} in ${dirName}/`));
    }

    const { allPassed, results } = await startAndTest(spec, projectData, targetDir);

    if (allPassed) {
      console.log(green(bold("  ✅ ALL TESTS PASSED!")));
      success = true;
    } else {
      const failedTests = results.filter(r => !r.passed);
      console.log(red(`  ❌ ${failedTests.length} test(s) failed`));

      if (attempt < RETRY_LIMIT) {
        console.log(blue("  🔧 Asking LLM for a fix..."));
        projectData = await callLMStudio(
          "The previous code failed some tests. Fix the errors. Output JSON: { files: [{ name: string, content: string }] }",
          `Failed tests: ${JSON.stringify(failedTests)}\nCurrent Files: ${JSON.stringify(projectData.files)}`
        );
      }
    }
  }

  // 4. POST-SUCCESS ITERATION LOOP
  if (success) {
    console.log(green(bold(`\n✨ SHIPPED! Check the "${dirName}" folder.`)));

    while (true) {
      const modification = await rl.question(bold("\n🔧 Want to modify? (describe change or type 'exit'): "));

      if (modification.toLowerCase() === 'exit') {
        console.log(cyan("👋 Done. Goodbye!"));
        break;
      }

      console.log(blue("  ✏️  Asking LLM to update the code..."));

      projectData = await callLMStudio(
        `Modify the existing ${spec.techStack} app. Keep all current functionality. Use ONLY built-in modules. Output JSON: { files: [{ name: string, content: string }] }`,
        `Current files: ${JSON.stringify(projectData.files)}\n\nUser request: ${modification}`
      );

      // Write updated files
      for (const file of projectData.files) {
        const filePath = path.join(targetDir, file.name);
        await fs.writeFile(filePath, file.content);
        console.log(yellow(`  📝 Updated: ${file.name}`));
      }

      // Re-test everything
      console.log(cyan("\n  🔄 Re-testing all endpoints..."));
      const { allPassed, results } = await startAndTest(spec, projectData, targetDir);

      if (allPassed) {
        console.log(green(bold("  ✅ ALL TESTS STILL PASSING!")));
      } else {
        const failedTests = results.filter(r => !r.passed);
        console.log(red(`  ⚠️  ${failedTests.length} test(s) failed after modification`));

        const autofix = await rl.question(bold("  🔧 Want the LLM to auto-fix? (y/n): "));

        if (autofix.toLowerCase() === 'y') {
          projectData = await callLMStudio(
            "The modification broke some tests. Fix the code. Output JSON: { files: [{ name: string, content: string }] }",
            `Failed tests: ${JSON.stringify(failedTests)}\nCurrent Files: ${JSON.stringify(projectData.files)}`
          );

          for (const file of projectData.files) {
            const filePath = path.join(targetDir, file.name);
            await fs.writeFile(filePath, file.content);
            console.log(yellow(`  📝 Fixed: ${file.name}`));
          }

          // Test again after fix
          console.log(cyan("\n  🔄 Re-testing after fix..."));
          const fixResult = await startAndTest(spec, projectData, targetDir);
          if (fixResult.allPassed) {
            console.log(green(bold("  ✅ ALL TESTS PASSING AFTER FIX!")));
          } else {
            console.log(red("  ⚠️  Some tests still failing. You can try again."));
          }
        }
      }
    }

  } else {
    console.log(red(bold("\n🚫 FAILED after all retries.")));
  }

  rl.close();
}

runCactroSprints();