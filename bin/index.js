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
    "Identifying function",
    "Preparing execution"
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
                <div key={index} className={\`abra-processing-step \${processingStep >= index ? 'active' : ''}\`}>
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
            <div className={\`abra-status \${error ? 'abra-error' : ''}\`}>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
  background-color: #5cdb95;
  border: none;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #05386b;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(92, 219, 149, 0.4);
  transition: all 0.2s ease;
}

.abra-circle-button:hover {
  transform: scale(1.05);
  box-shadow: 0 3px 12px rgba(92, 219, 149, 0.5);
}

.abra-at-symbol {
  font-weight: bold;
}

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 360px;
  max-height: 500px;
  background: #ffffff;
  color: #333333;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.abra-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #5cdb95;
  color: #05386b;
}

.abra-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.abra-close-button {
  background: transparent;
  border: none;
  color: #05386b;
  font-size: 20px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.abra-close-button:hover {
  background-color: rgba(5, 56, 107, 0.1);
}

.abra-content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 16px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.abra-message-container {
  margin-bottom: 16px;
  flex-grow: 1;
}

.abra-message {
  font-size: 14px;
  margin-bottom: 16px;
  color: #333;
  line-height: 1.5;
}

.abra-processing-container {
  margin: 16px 0;
  border-radius: 8px;
  padding: 12px;
  background-color: #f8f8f8;
}

.abra-processing-step {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #777;
  margin-bottom: 10px;
  opacity: 0.7;
  transition: opacity 0.3s;
}

.abra-processing-step.active {
  opacity: 1;
  color: #333;
}

.abra-step-complete {
  margin-right: 10px;
  color: #5cdb95;
  font-weight: bold;
}

.abra-step-pending {
  width: 14px;
  height: 14px;
  margin-right: 10px;
  display: inline-block;
}

.abra-loader {
  margin-right: 10px;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(92, 219, 149, 0.3);
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
  color: #333;
  padding: 8px 12px;
  border-radius: 6px;
  background: #f0f0f0;
}

.abra-error {
  background-color: #fff2f2;
  color: #d32f2f;
}

.abra-error-message {
  margin-top: 8px;
  font-size: 13px;
  color: #d32f2f;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff2f2;
  border-left: 3px solid #d32f2f;
}

.abra-success-message {
  margin-top: 12px;
  font-size: 13px;
  color: #388e3c;
  padding: 8px 12px;
  border-radius: 6px;
  background: #f1f8e9;
  border-left: 3px solid #5cdb95;
}

.abra-result {
  margin-top: 12px;
  font-size: 13px;
  background: #f8f8f8;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.abra-result pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.abra-input-container {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #eaeaea;
  background: #ffffff;
}

.abra-input {
  flex-grow: 1;
  padding: 10px 12px;
  background: #f8f8f8;
  color: #333333;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  margin-right: 8px;
  transition: all 0.2s;
}

.abra-input:focus {
  outline: none;
  border-color: #5cdb95;
  background: #ffffff;
  box-shadow: 0 0 0 2px rgba(92, 219, 149, 0.2);
}

.abra-input::placeholder {
  color: #999999;
}

.abra-send-button {
  background: #5cdb95;
  color: #05386b;
  border: none;
  padding: 8px;
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
  background: #4ec588;
  transform: scale(1.05);
}

.abra-send-button:disabled {
  background: #c8e6d7;
  cursor: not-allowed;
}

.abra-step-text {
  font-size: 13px;
}
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}


const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
