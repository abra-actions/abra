#!/usr/bin/env node

import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';

function serializeType(type, typeChecker, typeDefinitions, processedTypes, visited) {
  if (!type) return "any";
  const typeId = type.id || (type.symbol && type.symbol.id) || Math.random().toString(36).substring(7);
  if (visited.has(typeId)) return "any";
  visited.add(typeId);

  if (type.flags & ts.TypeFlags.String) return "string";
  if (type.flags & ts.TypeFlags.Number) return "number";
  if (type.flags & ts.TypeFlags.Boolean) return "boolean";
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.flags & ts.TypeFlags.Undefined) return "undefined";
  if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) return "any";

  if (type.isLiteral?.()) {
    if (type.isStringLiteral?.()) return type.value;
    if (type.isNumberLiteral?.()) return type.value;
    if (type.flags & ts.TypeFlags.BooleanLiteral) return type.intrinsicName === 'true';
  }

  if (type.symbol && type.symbol.name && !isBuiltInType(type.symbol.name)) {
    const typeName = type.symbol.name;
    const typeInfo = Array.from(typeDefinitions.values()).find(t => t.name === typeName);
    if (typeInfo && !processedTypes.has(typeName)) {
      processedTypes.add(typeName);
      const props = typeInfo.type.getProperties();
      const structure = {};
      for (const prop of props) {
        if (prop.getName().startsWith('__') || isLikelyMethod(prop, typeChecker)) continue;
        const propType = typeChecker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || prop.declarations[0]);
        structure[prop.getName()] = serializeType(propType, typeChecker, typeDefinitions, processedTypes, new Set(visited));
      }
      return structure;
    }
  }

  if (type.isUnion?.()) {
    const types = type.types.map(t => serializeType(t, typeChecker, typeDefinitions, processedTypes, new Set(visited)));
    const flat = types.flat();
    if (flat.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) return flat;
    return "any";
  }

  if (typeChecker.isArrayType(type)) {
    const elementType = typeChecker.getTypeArguments(type)[0];
    return { type: "array", items: serializeType(elementType, typeChecker, typeDefinitions, processedTypes, new Set(visited)) };
  }

  const props = type.getProperties?.();
  if (!props?.length) return typeChecker.typeToString(type);

  const result = {};
  for (const prop of props) {
    const propType = typeChecker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || prop.declarations[0]);
    result[prop.name] = serializeType(propType, typeChecker, typeDefinitions, processedTypes, new Set(visited));
  }
  return result;
}

function isBuiltInType(name) {
  return ['Array', 'String', 'Number', 'Boolean', 'Object', 'Function', 'Promise', 'Date', 'RegExp', 'Error', 'Map', 'Set', 'Symbol'].includes(name);
}

function isLikelyMethod(symbol, checker) {
  if (!symbol.valueDeclaration) return false;
  const t = checker.getTypeOfSymbol(symbol);
  return t.getCallSignatures?.().length > 0;
}

function getAllTSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllTSFiles(fullPath, fileList);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function main(projectRoot) {
  const files = getAllTSFiles(path.join(projectRoot, 'src'));
  const program = ts.createProgram(files, { allowJs: false });
  const checker = program.getTypeChecker();

  const actions = [];
  const typeDefinitions = new Map();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          const type = checker.getTypeAtLocation(node.name);
          typeDefinitions.set(node.name.text, {
            name: node.name.text,
            type,
            declaration: node,
            sourceFile,
            file: sourceFile.fileName
          });
        }
      }
      ts.forEachChild(node, visit);
    });

    const sourceText = sourceFile.getFullText();

    ts.forEachChild(sourceFile, node => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const comments = ts.getLeadingCommentRanges(sourceText, node.pos);
        if (!comments?.some(r => sourceText.slice(r.pos, r.end).includes('@abra-action'))) return;

        const fnName = node.name.text;
        const params = {};

        for (const param of node.parameters) {
          if (ts.isObjectBindingPattern(param.name)) {
            for (const element of param.name.elements) {
              const key = element.name.getText();
              const propType = checker.getTypeAtLocation(element.name);
              params[key] = serializeType(propType, checker, typeDefinitions, new Set(), new Set());
            }
          } else {
            const paramName = param.name.getText();
            const paramType = checker.getTypeAtLocation(param);
            params[paramName] = serializeType(paramType, checker, typeDefinitions, new Set(), new Set());
          }
        }

        actions.push({
          name: fnName,
          description: `Execute ${fnName}`,
          parameters: params,
          module: sourceFile.fileName
        });

        console.log(`✅ Found @abra-action: ${fnName}`);
      }
    });
  }

  writeActionsJson(actions, projectRoot);
  writeActionRegistry(actions, projectRoot);
  writeExecutor(projectRoot);
  writeAbraComponent(projectRoot);
}

function writeActionsJson(actions, root) {
  const out = { actions, typeAliases: {} };
  const file = path.join(root, 'src/abra-actions/__generated__/actions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote actions.json`);
}

function writeActionRegistry(actions, root) {
  let imports = '';
  let registry = '';

  actions.forEach(a => {
    const fromPath = path.dirname(path.join(root, 'src/abra-actions/__generated__/actionRegistry.ts'));
    let importPath = './' + path.relative(fromPath, a.module).replace(/\\/g, '/');
    if (!importPath.endsWith('.ts')) importPath += '.ts'; // ✅ ensure .ts

    imports += `import { ${a.name} } from '${importPath}';\n`;
    registry += `  ${a.name},\n`;
  });

  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
${imports}
const actionRegistry = {
${registry}};
export default actionRegistry;`;

  const file = path.join(root, 'src/abra-actions/__generated__/actionRegistry.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote actionRegistry.ts`);
}


function writeExecutor(root) {
  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import actionRegistry from './actionRegistry';

export async function executeAction(actionName: string, params: any) {
  const fn = actionRegistry[actionName];
  if (!fn) throw new Error(\`Action "\${actionName}" is not registered.\`);
  try {
    const result = await fn(params);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
`;

  const file = path.join(root, 'src/abra-actions/__generated__/abra-executor.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote abra-executor.ts`);
}

function writeAbraComponent(root) {
  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import React, { useState } from "react";
import actionsJson from '../__generated__/actions.json';
import { executeAction } from '../__generated__/abra-executor.ts';

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: input, actions: actionsJson.actions })
      });
      const aiResponse = await res.json();
      const executionResult = await executeAction(aiResponse.action, aiResponse.params);
      if (executionResult.success) {
        setResult(executionResult.result);
        setStatus(\`✅ Executed: \${aiResponse.action}\`);
      } else throw new Error(executionResult.error);
    } catch (err: any) {
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

  const file = path.join(root, 'src/abra-actions/AbraActionPrompt.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote AbraActionPrompt.tsx`);
}

const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
