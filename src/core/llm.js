import OpenAI from "openai";
import fs from "fs";
import path from "path";

// Look for API key in env vars or config file
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.warn("⚠️ OPENAI_API_KEY not found in environment variables. Make sure to set it before using LLM features.");
}

const openai = new OpenAI({ apiKey });

// Load actions from actions.json
let actions = [];
try {
    const actionsPath = path.resolve(process.cwd(), "actions.json");
    if (fs.existsSync(actionsPath)) {
        const actionsData = JSON.parse(fs.readFileSync(actionsPath, "utf8"));
        actions = actionsData.actions || [];
    } else {
        console.warn("⚠️ actions.json not found. Run the type extraction first.");
    }
} catch (error) {
    console.error("❌ Error loading actions.json:", error);
}

// Default LLM configuration
const defaultConfig = {
    model: "gpt-4",
    temperature: 0.1,
    max_tokens: 500
};

// Try to load custom configuration
let llmConfig = { ...defaultConfig };
try {
    const configPath = path.resolve(process.cwd(), "abra.config.js");
    if (fs.existsSync(configPath)) {
        const userConfig = require(configPath);
        if (userConfig.llm) {
            llmConfig = { ...defaultConfig, ...userConfig.llm };
        }
    }
} catch (error) {
    console.warn("⚠️ Error loading abra.config.js:", error);
}

export async function fetchLLMResponse(userInput) {
    if (!apiKey) {
        return {
            error: "OpenAI API key not found. Please set the OPENAI_API_KEY environment variable."
        };
    }

    if (!actions.length) {
        return {
            error: "No actions found. Make sure to run the type extraction first."
        };
    }

    const systemPrompt = `You are an AI assistant that translates natural language requests into API calls.
Your job is to:
1. Analyze the user's request
2. Select the most appropriate API action from the available options
3. Extract parameter values from the user's request
4. Return a structured JSON response

Available actions:
${actions.map(action => 
    `- ${action.name}: ${action.description}
      Parameters: ${JSON.stringify(action.parameters, null, 2)}`
).join('\n\n')}

IMPORTANT GUIDELINES:
- Select the MOST appropriate action based on the user's request
- For parameters not specified by the user, you can omit them or provide reasonable defaults
- Return ONLY valid JSON in the format: { "action": "actionName", "params": { "param1": "value", "param2": "value" } }
- For complex object parameters, construct them as nested objects
- For array parameters, construct them as arrays
- Try to be as accurate as possible in mapping user intent to the available actions
`;

    try {
        console.log("🤖 Sending request to LLM...");
        
        const response = await openai.chat.completions.create({
            model: llmConfig.model,
            temperature: llmConfig.temperature,
            max_tokens: llmConfig.max_tokens,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userInput }
            ],
            response_format: { type: "json_object" }
        });

        const content = response.choices[0].message.content;
        console.log("🤖 LLM response:", content);
        
        try {
            return JSON.parse(content);
        } catch (err) {
            console.error("❌ Error parsing LLM response as JSON:", err);
            return { 
                error: "Failed to parse LLM response as JSON",
                raw: content
            };
        }
    } catch (err) {
        console.error("❌ Error calling OpenAI:", err);
        return { 
            error: `Error calling OpenAI: ${err.message || "Unknown error"}` 
        };
    }
}

export function getAvailableActions() {
    return actions.map(action => ({
        name: action.name,
        description: action.description
    }));
}