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
  writeAssistantStyles(projectRoot);
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
    if (!importPath.endsWith('.ts')) importPath += '.ts'; 

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
import actionRegistry from './actionRegistry.ts';

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
import React, { useState, useEffect, useRef } from "react";
import actionsJson from './__generated__/actions.json';
import { executeAction } from './__generated__/abra-executor.ts';
import './AbraAssistant.css';

const BACKEND_URL = "http://localhost:4000";

const AbraAssistant = () => {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const textInputRef = useRef(null);
  const contentRef = useRef(null);

  const processingSteps = [
    "Analyzing your request",
    "Identifying appropriate function",
    "Preparing execution parameters",
    "Executing function"
  ];

  useEffect(() => {
    if (!expanded) {
      setStatus('');
      setResult(null);
      setError(null);
      setInput('');
      setShowSuccess(false);
      setIsProcessing(false);
      setProcessingStep(0);
    } else if (textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [expanded]);

  useEffect(() => {
    let stepInterval;

    if (isProcessing) {
      setProcessingStep(0);
      stepInterval = setInterval(() => {
        setProcessingStep(prev => {
          if (prev < processingSteps.length - 1) {
            return prev + 1;
          } else {
            clearInterval(stepInterval);
            return prev;
          }
        });
      }, 600);
    }

    return () => clearInterval(stepInterval);
  }, [isProcessing]);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setIsProcessing(true);
    setStatus("Resolving action...");
    setResult(null);
    setError(null);
    
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
        setShowSuccess(true);
        
        // Reset after showing success for a moment
        setTimeout(() => {
          setInput('');
          if (textInputRef.current) textInputRef.current.focus();
        }, 4000);
      } else {
        throw new Error(executionResult.error);
      }
    } catch (err) {
      setError(err.message);
      setStatus("Failed");
    } finally {
      setIsLoading(false);
      setIsProcessing(false);
    }
  };

  if (!expanded) {
    return (
      <div className="abra-button-container">
        <button 
          className="abra-circle-button" 
          onClick={toggleExpanded}
          aria-label="Open Abra Assistant"
        >
          <span className="abra-at-symbol">@</span>
        </button>
      </div>
    );
  }

  return (
    <div className="abra-container">
      <div className="abra-header">
        <h3 className="abra-title">Abra Assistant</h3>
        <button 
          className="abra-close-button" 
          onClick={toggleExpanded}
          aria-label="Close Abra Assistant"
        >
          ×
        </button>
      </div>
      <div ref={contentRef} className="abra-content">
        <div className="abra-message-container">
          <div className="abra-message">
            I can execute functions in this application through natural language. What would you like to do?
          </div>

          {isProcessing && (
            <div className="abra-processing-container">
              {processingSteps.map((step, index) => (
                <div key={index} className={\`abra-processing-step ${processingStep >= index ? 'active' : ''}\`}>
                  {processingStep > index ? (
                    <span className="abra-step-complete">✓</span>
                  ) : processingStep === index ? (
                    <span className="abra-loader"></span>
                  ) : (
                    <span className="abra-step-pending"></span>
                  )}
                  <span className="abra-step-text">{step}</span>
                </div>
              ))}
            </div>
          )}

          {status && !isProcessing && (
            <div className={\`abra-status ${error ? 'abra-error' : ''}\`}>
              {status}
            </div>
          )}

          {error && (
            <div className="abra-error-message">
              {error}
            </div>
          )}

          {result && !error && (
            <div className="abra-result">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {showSuccess && !error && (
            <div className="abra-success-message">
              Operation completed successfully
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="abra-input-container">
          <input
            ref={textInputRef}
            type="text"
            placeholder="Type what you want to do..."
            value={input}
            onChange={handleInputChange}
            className="abra-input"
            disabled={isLoading}
          />
          <button 
            type="submit" 
            className="abra-send-button"
            aria-label="Send message"
            disabled={isLoading || !input.trim()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default AbraAssistant;
`;


  const file = path.join(root, 'src/abra-actions/AbraAssistant.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote AbraAssistant.tsx`);
}

function writeAssistantStyles(root) {
  const file = path.join(root, 'src/abra-actions/AbraAssistant.css');
  const content = `.abra-button-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
}

.abra-circle-button {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background-color: #5cdb95;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(92, 219, 149, 0.4);
  border: none;
  z-index: 100;
  transition: all 0.3s ease;
}

.abra-circle-button:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(92, 219, 149, 0.5);
}

.abra-at-symbol {
  font-size: 26px;
  color: #121212;
  font-weight: 600;
}

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-height: 550px;
  background-color: rgba(26, 26, 26, 0.98);
  backdrop-filter: blur(10px);
  color: #f0f0f0;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  animation: abra-fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes abra-fade-in {
  0% { opacity: 0; transform: translateY(10px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.abra-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #5cdb95;
  color: #121212;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.abra-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.abra-close-button {
  background: transparent;
  border: none;
  color: #121212;
  font-size: 20px;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.abra-close-button:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.abra-content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  background-color: #1a1a1a;
  scrollbar-width: thin;
  scrollbar-color: #444 #222;
}

.abra-content::-webkit-scrollbar {
  width: 6px;
}

.abra-content::-webkit-scrollbar-track {
  background: #222;
}

.abra-content::-webkit-scrollbar-thumb {
  background-color: #444;
  border-radius: 6px;
}

.abra-message-container {
  margin-bottom: 16px;
  flex-grow: 1;
}

.abra-message {
  font-size: 14px;
  margin-bottom: 16px;
  color: #e0e0e0;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.abra-processing-container {
  margin: 16px 0;
  border-radius: 8px;
  padding: 14px;
  background-color: rgba(30, 30, 30, 0.7);
  border-left: 2px solid #5cdb95;
  animation: abra-fade-slide-in 0.3s ease forwards;
}

@keyframes abra-fade-slide-in {
  0% { opacity: 0; transform: translateY(5px); }
  100% { opacity: 1; transform: translateY(0); }
}

.abra-processing-step {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #b0b0b0;
  margin-bottom: 10px;
  opacity: 0.7;
  transition: opacity 0.3s, color 0.3s;
}

.abra-processing-step.active {
  opacity: 1;
  color: #e0e0e0;
}

.abra-step-complete {
  margin-right: 12px;
  color: #5cdb95;
  font-weight: bold;
}

.abra-step-pending {
  width: 14px;
  height: 14px;
  margin-right: 12px;
  display: inline-block;
}

.abra-loader {
  margin-right: 12px;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(92, 219, 149, 0.2);
  border-top: 2px solid #5cdb95;
  border-radius: 50%;
  animation: abra-spin 1s linear infinite;
  display: inline-block;
}

@keyframes abra-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.abra-status {
  margin: 12px 0;
  font-size: 13px;
  color: #e0e0e0;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(50, 50, 50, 0.5);
  letter-spacing: 0.01em;
  animation: abra-fade-slide-in 0.3s ease forwards;
}

.abra-error {
  background-color: rgba(255, 80, 80, 0.15);
  color: #ff5252;
}

.abra-error-message {
  margin-top: 10px;
  font-size: 13px;
  color: #ff5252;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(255, 80, 80, 0.1);
  border-left: 3px solid #ff5252;
  animation: abra-fade-slide-in 0.3s ease forwards;
}

.abra-success-message {
  margin-top: 12px;
  font-size: 13px;
  color: #5cdb95;
  padding: 12px 14px;
  border-radius: 6px;
  background: rgba(92, 219, 149, 0.1);
  border-left: 3px solid #5cdb95;
  animation: abra-success-pulse 2s ease;
}

@keyframes abra-success-pulse {
  0% { background-color: rgba(92, 219, 149, 0.1); }
  50% { background-color: rgba(92, 219, 149, 0.2); }
  100% { background-color: rgba(92, 219, 149, 0.1); }
}

.abra-result {
  margin-top: 12px;
  font-size: 13px;
  background: rgba(40, 40, 40, 0.7);
  color: #e0e0e0;
  padding: 14px;
  border-radius: 6px;
  overflow-x: auto;
  animation: abra-fade-slide-in 0.3s ease forwards;
}

.abra-result pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.abra-input-container {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(20, 20, 20, 0.7);
}

.abra-input {
  flex-grow: 1;
  padding: 10px 14px;
  background: rgba(40, 40, 40, 0.8);
  color: #f0f0f0;
  border: 1px solid rgba(90, 90, 90, 0.3);
  border-radius: 20px;
  font-size: 14px;
  margin-right: 8px;
  transition: all 0.2s;
}

.abra-input:focus {
  outline: none;
  border-color: #5cdb95;
  background: rgba(40, 40, 40, 0.9);
  box-shadow: 0 0 0 2px rgba(92, 219, 149, 0.15);
}

.abra-input::placeholder {
  color: #999999;
}

.abra-send-button {
  background: #5cdb95;
  color: #121212;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.abra-send-button:hover:not(:disabled) {
  background: #4dbd82;
  transform: translateY(-1px);
}

.abra-send-button:disabled {
  background: rgba(92, 219, 149, 0.4);
  cursor: not-allowed;
}

.abra-step-text {
  font-size: 13px;
  letter-spacing: 0.01em;
}

.abra-input[readonly] {
  cursor: not-allowed;
  opacity: 0.8;
}

@media (max-width: 480px) {
  .abra-container {
    width: calc(100% - 48px);
    max-width: none;
  }
}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}


const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
