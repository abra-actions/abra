import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const actionsPath = path.resolve(process.cwd(), "actions.json");
let actionsData = {};
let actionsJson = [];
let typeAliases = {};

try {
    if (fs.existsSync(actionsPath)) {
        actionsData = JSON.parse(fs.readFileSync(actionsPath, "utf8"));
        actionsJson = actionsData.actions || [];
        typeAliases = actionsData.typeAliases || {};
    } else {
        console.warn("⚠️ actions.json not found. Run the type extraction first.");
    }
} catch (error) {
    console.error("❌ Error loading actions.json:", error);
}

async function getFunction(action) {
    try {
        const modulePath = pathToFileURL(path.resolve(process.cwd(), action.module)).href;
        const module = await import(modulePath);

        if (module[action.name]) {
            return module[action.name];
        } else {
            console.error(`❌ Function "${action.name}" not found in module:`, modulePath);
        }
    } catch (error) {
        console.error(`❌ Error importing function "${action.name}":`, error);
    }

    return null;
}

function validateAndTransformParams(paramDef, userInput, path = '') {
    if (userInput === null || userInput === undefined) {
        return getDefaultForType(paramDef);
    }

    if (typeof paramDef === 'string') {
        switch (paramDef) {
            case 'string':
                return String(userInput);
            case 'number':
                // Handle the case where a string that can't be converted to a number is passed
                const num = Number(userInput);
                return isNaN(num) ? 0 : num;
            case 'boolean':
                // Convert string "true"/"false" to boolean
                if (typeof userInput === 'string') {
                    return userInput.toLowerCase() === 'true';
                }
                return Boolean(userInput);
            default:
                return userInput;
        }
    }

    if (paramDef.type === 'array' && paramDef.items) {
        if (!Array.isArray(userInput)) {
            userInput = userInput ? [userInput] : [];
        }
        
        return userInput.map(item => validateAndTransformParams(paramDef.items, item));
    }

    if (Array.isArray(paramDef)) {
        if (paramDef.includes(userInput)) {
            return userInput;
        }
        return paramDef[0]; // Default to first option
    }

    if (typeof paramDef === 'object' && paramDef !== null) {
        const result = {};
        
        const inputObj = (typeof userInput === 'object' && userInput !== null) 
            ? userInput 
            : {};
        
        for (const [key, propType] of Object.entries(paramDef)) {
            const propPath = path ? `${path}.${key}` : key;
            result[key] = validateAndTransformParams(propType, inputObj[key], propPath);
        }
        
        return result;
    }

    return userInput;
}

function getDefaultForType(type) {
    if (type === "number") return 0;
    if (type === "boolean") return false;
    if (Array.isArray(type) && type.length > 0) return type[0];
    if (type === "object" || (typeof type === "object" && type !== null)) return {};
    if (type?.type === "array") return [];
    return ""; 
}

export async function executeAction(actionName, userInput) {
    console.log(`🔍 Looking for action: ${actionName}`);
    
    const action = actionsJson.find(a => a.name === actionName);
    if (!action) {
        return { 
            success: false, 
            error: `Action "${actionName}" not found.` 
        };
    }
    
    console.log(`✅ Found action: ${action.name}`);
    console.log(`📝 Raw user input:`, userInput);

    const processedParams = {};
    
    for (const [paramName, paramDef] of Object.entries(action.parameters)) {
        processedParams[paramName] = validateAndTransformParams(
            paramDef, 
            userInput[paramName]
        );
    }
    
    console.log(`📝 Processed parameters:`, processedParams);

    const func = await getFunction(action);
    if (!func) {
        return { 
            success: false, 
            error: `Function "${action.name}" could not be loaded.` 
        };
    }

    try {
        console.log(`🚀 Executing ${action.name}...`);
        const result = await func(processedParams);
        console.log(`✅ Execution result:`, result);
        
        return { 
            success: true, 
            result,
            action: action.name,
            description: action.description
        };
    } catch (err) {
        console.error(`❌ Execution error:`, err);
        return { 
            success: false, 
            error: err.message,
            action: action.name
        };
    }
}

export function getAllActions() {
    return actionsJson.map(action => ({
        name: action.name,
        description: action.description,
        parameters: action.parameters ? Object.keys(action.parameters) : []
    }));
}