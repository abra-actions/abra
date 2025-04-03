#!/usr/bin/env node

import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';

// Utility to recursively find all .ts files
function getTypeDefinitionFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (!["node_modules", "dist", "build"].some(exclude => filePath.includes(exclude))) {
        getTypeDefinitionFiles(filePath, fileList);
      }
    } else if (file.endsWith(".ts") && filePath.includes("/src/")) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

// Create TypeScript program
function createProgram(projectRoot) {
  const tsFiles = getTypeDefinitionFiles(projectRoot);
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

  let compilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true
  };

  if (fs.existsSync(tsconfigPath)) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
      if (!parsedConfig.errors.length) {
        compilerOptions = parsedConfig.options;
      }
    }
  }

  return ts.createProgram(tsFiles, compilerOptions);
}

// Collect types from files
function collectTypeDefinitions(program) {
  const typeChecker = program.getTypeChecker();
  const typeDefinitions = new Map();

  program.getSourceFiles().forEach((sourceFile) => {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) return;

    ts.forEachChild(sourceFile, (node) => {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const typeName = node.name.text;
        const type = typeChecker.getTypeAtLocation(node.name);
        typeDefinitions.set(typeName, { name: typeName, type, file: sourceFile.fileName });
      }
    });
  });

  return typeDefinitions;
}

// Generate actions.json
function generateActionsJson(projectRoot, actions) {
  const outputPath = path.join(projectRoot, "actions.json");
  fs.writeFileSync(outputPath, JSON.stringify({ actions }, null, 2));
  console.log(`✅ actions.json generated at ${outputPath}`);
}

// Generate actionRegistry.js
function generateActionRegistry(projectRoot, actions) {
  let imports = '';
  let registryEntries = '';

  actions.forEach(action => {
    const relativePath = './' + path.relative(
      path.join(projectRoot, 'src/actions'),
      action.module.replace(/\.ts$/, '')
    ).replace(/\\/g, '/');
    imports += `import { ${action.name} } from '${relativePath}';\n`;
    registryEntries += `  ${action.name},\n`;
  });

  const content = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
${imports}
const actionRegistry = {
${registryEntries}};
export default actionRegistry;`;

  const outputPath = path.join(projectRoot, 'src/actions/actionRegistry.js');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  console.log(`✅ actionRegistry.js generated at ${outputPath}`);
}

// Generate abra-executor.js
function generateExecutor(projectRoot) {
  const content = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import actionRegistry from './actionRegistry';

export async function executeAction(actionName, params) {
  const actionFn = actionRegistry[actionName];
  if (!actionFn) throw new Error(\`Action "\${actionName}" is not registered.\`);
  try {
    const result = await actionFn(params);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}`;

  const outputPath = path.join(projectRoot, 'src/actions/abra-executor.js');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  console.log(`✅ abra-executor.js generated at ${outputPath}`);
}

// Generate AbraActionPrompt.jsx
function generateAbraComponent(projectRoot) {
  const content = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import React, { useState } from "react";
import actionsJson from '../actions/actions.json';
import { executeAction } from '../actions/abra-executor';

const BACKEND_URL = "http://localhost:4000";

export function AbraActionPrompt() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleExecute = async () => {
    setIsLoading(true); setStatus("Resolving action...");
    try {
      const res = await fetch(\`\${BACKEND_URL}/api/resolve-action\`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: input, actions: actionsJson.actions })
      });
      const aiResponse = await res.json();
      const executionResult = await executeAction(aiResponse.action, aiResponse.params);
      if (executionResult.success) {
        setResult(executionResult.result);
        setStatus(\`✅ Executed: \${aiResponse.action}\`);
      } else throw new Error(executionResult.error);
    } catch (err) {
      setError(err.message); setStatus("Failed");
    } finally { setIsLoading(false); }
  };

  return (<div className="abra-container">
    <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isLoading} />
    <button onClick={handleExecute} disabled={isLoading}>Execute</button>
    {status && <p>{status}</p>}
    {error && <p>{error}</p>}
    {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
  </div>);
}`;

  const outputPath = path.join(projectRoot, 'src/components/AbraActionPrompt.jsx');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  console.log(`✅ AbraActionPrompt.jsx generated at ${outputPath}`);
}

// MAIN FUNCTION (clearly run everything)
function main(projectRoot) {
  const program = createProgram(projectRoot);
  const typeChecker = program.getTypeChecker();

  const actions = [];
  program.getSourceFiles().forEach(sourceFile => {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) return;
    ts.forEachChild(sourceFile, node => {
      if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const text = sourceFile.getFullText();
        const comments = ts.getLeadingCommentRanges(text, node.pos);
        if (comments && comments.some(range => text.substring(range.pos, range.end).includes('@abra-action'))) {
          actions.push({
            name: node.name.text,
            module: sourceFile.fileName
          });
        }
      }
    });
  });

  generateActionsJson(projectRoot, actions);
  generateActionRegistry(projectRoot, actions);
  generateExecutor(projectRoot);
  generateAbraComponent(projectRoot);
}

// Run main CLI
const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
