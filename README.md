README.txt

PROJECT: CACTRO AGENT V1 (Vibe-to-Code MVP)
===========================================

MISSION
-------
Build a functional AI agent that allows non-technical users to generate, test, 
and iterate on simple Node.js and FastAPI applications using natural language. 

TIMEBOX: 15-25 Hours (Actual target: 1-hour high-speed sprint)

SYSTEM ARCHITECTURE
-------------------
The agent follows a "Closed-Loop Self-Healing" architecture:

1.  User Intent -> [PRD Synthesizer]: Converts raw prompts into a tech stack choice.
2.  [LLM Core]: Generates the project structure and source code.
3.  [Tool Orchestrator]: Creates local directories and writes physical files.
4.  [Self-Evaluation]: 
    - Boots the app using 'execa' in a separate process.
    - Uses 'getEndpoints' (LLM-driven) to discover what routes to test.
    - Runs automated health checks via Node's built-in fetch.
5.  [Debug Loop]: If tests fail, the error logs are fed back to the LLM for an 
    auto-fix (limited to 3 retries to prevent credit/token burn).
6.  [Iteration Loop]: Allows the user to modify the working code after a 
    successful deployment.

KEY DECISIONS & TRADE-OFFS
--------------------------

1. Tech Stack Selection (Node.js & FastAPI):
   I chose these because they allow for "Single-File" app generation. This 
   minimizes the complexity of the Tool Orchestrator and reduces the surface 
   area for LLM hallucination in file paths.

2. JSON Repair Layer:
   Small local models (like Qwen-4B) often fail to close brackets or include 
   markdown fluff (```json). I implemented 'jsonrepair' to ensure the agent 
   doesn't crash due to minor syntax errors in the LLM's response.

3. Testing via Discovery vs. Static Checks:
   Instead of just checking if the server is "on," I added a 'getEndpoints' 
   step. This asks the LLM to look at its own code and tell us what to test. 
   This makes the agent more robust for different types of apps.

4. Execution via 'execa':
   Used 'execa' template literals for better command escaping and utilized 
   the 'cwd' (current working directory) option to ensure generated FastAPI 
   apps can resolve their local 'main:app' modules correctly.

5. Built-in Modules Only:
   To keep the MVP fast, the LLM is instructed to use only built-in modules 
   (e.g., 'http' for Node or 'fastapi' core). This skips the need for a complex 
   'npm install' or 'pip install' step within the 1-hour sprint window.

PREREQUISITES
-------------
- Node.js (v18+)
- LM Studio (running Qwen-4B or similar) or an OpenRouter API Key
- 'uvicorn' installed globally (if targeting FastAPI apps)
- 'execa', 'colorette', and 'jsonrepair' npm packages

HOW TO RUN
----------
1. Install dependencies: npm install execa colorette jsonrepair
2. Update the LMSTUDIO_URL and MODEL name in the script.
3. Run the script: node agent.js
4. Follow the terminal prompts to describe your app and name your directory.

LIMITATIONS
-----------
- Only supports single-file applications for V1.
- No support for external databases or API keys within the generated apps.
- Port 3000 is hardcoded; ensure it is free before starting.

-------------------------------------------------------------------------------
"Code isn't finished when it works; it's finished when it can fix itself."