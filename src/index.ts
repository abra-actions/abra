#!/usr/bin/env node

import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';

function serializeType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  typeDefinitions: Map<string, { name: string; type: ts.Type; declaration: ts.Node; sourceFile: ts.SourceFile; file: string }>,
  processedTypes: Set<string>,
  visited: Set<string>
): any {
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return (type as ts.StringLiteralType).value;
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return (type as ts.NumberLiteralType).value;
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as any).intrinsicName === 'true';
  }

  if (type.flags & ts.TypeFlags.String) return "string";
  if (type.flags & ts.TypeFlags.Number) return "number";
  if (type.flags & ts.TypeFlags.Boolean) return "boolean";
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.flags & ts.TypeFlags.Undefined) return "undefined";
  if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) return "any";

  if (type.symbol && type.symbol.name && !isBuiltInType(type.symbol.name)) {
    const typeName = type.symbol.name;
    const typeInfo = Array.from(typeDefinitions.values()).find(t => t.name === typeName);
    if (typeInfo && !processedTypes.has(typeName)) {
      processedTypes.add(typeName);
      const props = typeInfo.type.getProperties();
      const structure: Record<string, any> = {};
      for (const prop of props) {
        if (prop.getName().startsWith('__') || isLikelyMethod(prop, typeChecker)) continue;
        const dec = prop.valueDeclaration || (prop.declarations ? prop.declarations[0] : undefined);
        if (!dec) continue;
        const propType = typeChecker.getTypeOfSymbolAtLocation(prop, dec);
        structure[prop.getName()] = serializeType(propType, typeChecker, typeDefinitions, processedTypes, new Set(visited));
      }
      return structure;
    }
  }

  if (type.flags & ts.TypeFlags.Union) {
    const unionType = type as ts.UnionType;
    const types = unionType.types.map(t => serializeType(t, typeChecker, typeDefinitions, processedTypes, new Set(visited)));
    const flat = types.flat();
    if (flat.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) return flat;
    return "any";
  }

  if (typeChecker.isArrayType(type as ts.TypeReference)) {
    const elementType = typeChecker.getTypeArguments(type as ts.TypeReference)[0];
    return { type: "array", items: serializeType(elementType, typeChecker, typeDefinitions, processedTypes, new Set(visited)) };
  }

  const props = type.getProperties ? type.getProperties() : [];
  if (!props.length) return typeChecker.typeToString(type);

  const result: Record<string, any> = {};
  for (const prop of props) {
    const dec = prop.valueDeclaration || (prop.declarations ? prop.declarations[0] : undefined);
    if (!dec) continue;
    result[prop.name] = serializeType(typeChecker.getTypeOfSymbolAtLocation(prop, dec), typeChecker, typeDefinitions, processedTypes, new Set(visited));
  }
  return result;
}

function isBuiltInType(name: string): boolean {
  return ['Array', 'String', 'Number', 'Boolean', 'Object', 'Function', 'Promise', 'Date', 'RegExp', 'Error', 'Map', 'Set', 'Symbol'].includes(name);
}


function isLikelyMethod(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (!symbol.valueDeclaration) return false;
  const t = checker.getTypeOfSymbol(symbol);
  return t.getCallSignatures()?.length > 0;
}

function getAllTSFiles(dir: string, fileList: string[] = []): string[] {
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

function generateActionsManifest(projectRoot: string): void {
  // Collect all .ts files in the src folder.
  const allFiles = getAllTSFiles(path.join(projectRoot, 'src'));
  const program = ts.createProgram(allFiles, { allowJs: false });
  const checker = program.getTypeChecker();

  // Load the registry file.
  const registryPath = path.join(projectRoot, 'src/abra-actions/__generated__/actionRegistry.ts');
  const sourceFile = program.getSourceFile(registryPath);
  if (!sourceFile) {
    console.error(`Could not read source file from ${registryPath}`);
    process.exit(1);
  }

  const actions: any[] = [];

  // Find the variable declaration for "actionRegistry".
  let registryObjectLiteral: ts.ObjectLiteralExpression | null = null;
  ts.forEachChild(sourceFile, node => {
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(decl => {
        if (
          decl.name.getText() === 'actionRegistry' &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          registryObjectLiteral = decl.initializer;
        }
      });
    }
  });

  if (!registryObjectLiteral) {
    console.error("Could not find actionRegistry object literal in registry file.");
    process.exit(1);
  }

  // Log the registry text to verify its content.
  console.log("Registry object literal text:", registryObjectLiteral);

  // Helper: Resolve a function signature from an identifier.
  function resolveFunctionSignature(
    identifier: ts.Identifier
  ): { name: string; signature: ts.Signature } | null {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (!symbol) {
      console.log(`No symbol found for identifier ${identifier.text}`);
      return null;
    }

    const targetSymbol =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;

    const declarations = targetSymbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      console.log(`No declarations for symbol ${identifier.text}`);
      return null;
    }

    const decl = declarations[0];
    const type = checker.getTypeOfSymbolAtLocation(targetSymbol, decl);
    const signatures = type.getCallSignatures();
    if (signatures.length === 0) {
      console.log(`No call signatures for ${identifier.text}. Check that it is a function.`);
      return null;
    }

    return {
      name: identifier.text || targetSymbol.getName() || 'default',
      signature: signatures[0]
    };
  }

  // Helper: Extract parameter info from a signature.
  function extractParams(signature: ts.Signature): Record<string, any> {
    const params: Record<string, any> = {};
    for (const param of signature.getParameters()) {
      const paramName = param.getName();
      const decl = param.valueDeclaration ?? param.declarations?.[0];
      if (!decl) continue;
      const type = checker.getTypeOfSymbolAtLocation(param, decl);
      params[paramName] = serializeType(
        type,
        checker,
        new Map(),
        new Set(),
        new Set()
      );
    }
    return params;
  }

  // Process the properties found in the registry.
  const registryObj = registryObjectLiteral as ts.ObjectLiteralExpression;
  for (const prop of registryObj.properties) {
    if (!('name' in prop) || !prop.name) continue;

    console.log("Processing property:", prop.name.getText());

    let identifier: ts.Identifier | undefined;
    if (ts.isShorthandPropertyAssignment(prop)) {
      identifier = prop.name;
    } else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
      identifier = prop.initializer;
    }

    if (!identifier) {
      console.log("No identifier for property", prop.getText());
      continue;
    }

    const resolved = resolveFunctionSignature(identifier);
    if (!resolved) {
      console.log(`Could not resolve function signature for ${identifier.text}`);
      continue;
    }

    const parameters = extractParams(resolved.signature);
    actions.push({
      name: prop.name.getText(),
      description: `Execute ${prop.name.getText()}`,
      parameters,
      module: registryPath
    });
  }

  // Write out the actions.json with just the "actions" key.
  const outPath = path.join(projectRoot, 'src/abra-actions/__generated__/actions.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ actions }, null, 2));
  console.log(`✅ Wrote actions.json based on actionRegistry.ts (${actions.length} action(s))`);
}


function writeActionRegistry(_: any, root: string): void {
  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
// Import your functions below and register them
// Example:
// import { greetUser } from '../../AbraFunctions.ts';

const actionRegistry = {
  // greetUser,
};

export default actionRegistry;
`;
  const file = path.join(root, 'src/abra-actions/__generated__/actionRegistry.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote empty actionRegistry.ts (manual mode)`);
}

/* --------------------------------------------------------------------
   writeExecutor:
   Writes the executor file that imports the registry and exposes executeAction.
-------------------------------------------------------------------- */
function writeExecutor(root: string): void {
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

/* --------------------------------------------------------------------
   writeAbraComponent:
   Writes the React component for the Abra Assistant.
-------------------------------------------------------------------- */
function writeAbraComponent(root: string): void {
  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import React, { useState, useEffect, useRef } from "react";
import actionsJson from './__generated__/actions.json';
import { executeAction } from './__generated__/abra-executor.ts';
import './AbraAssistant.css';

const BACKEND_URL = "http://localhost:4000";

type AssistantState = {
  expanded: boolean;
  input: string;
  status: string;
  result: any;
  error: string | null;
  isLoading: boolean;
  isProcessing: boolean;
  processingStep: number;
  showSuccess: boolean;
};

const AbraAssistant = () => {
  const [state, setState] = useState<AssistantState>({
    expanded: false,
    input: '',
    status: '',
    result: null,
    error: null,
    isLoading: false,
    isProcessing: false,
    processingStep: 0,
    showSuccess: false
  });

  const textInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const processingSteps = [
    "Analyzing your request",
    "Identifying appropriate function",
    "Preparing execution parameters",
    "Executing function"
  ];

  const updateState = (partialState: Partial<AssistantState>) => {
    setState(prev => ({ ...prev, ...partialState }));
  };

  useEffect(() => {
    const adjustHeight = () => {
      if (contentRef.current && state.expanded) {
        const contentHeight = contentRef.current.scrollHeight;
        const maxHeight = window.innerHeight * 0.8;
        const minHeight = 300; 
        contentRef.current.style.maxHeight = \`\${Math.max(minHeight, Math.min(contentHeight + 40, maxHeight))}px\`;
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        }, 50);
      }
    };

    adjustHeight();
    
    const observer = new MutationObserver(adjustHeight);
    
    if (contentRef.current) {
      observer.observe(contentRef.current, { 
        childList: true, 
        subtree: true,
        characterData: true
      });
    }
    window.addEventListener('resize', adjustHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', adjustHeight);
    };
  }, [state.expanded, state.isProcessing, state.processingStep, state.showSuccess]);

  useEffect(() => {
    if (!state.expanded) {
      updateState({
        status: '',
        result: null,
        error: null,
        input: '',
        showSuccess: false,
        isProcessing: false,
        processingStep: 0
      });
    } else if (textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [state.expanded]);

  useEffect(() => {
    let stepInterval: NodeJS.Timeout;

    if (state.isProcessing) {
      updateState({ processingStep: 0 });
      stepInterval = setInterval(() => {
        setState(prev => ({
          ...prev,
          processingStep: prev.processingStep < processingSteps.length - 1 
            ? prev.processingStep + 1 
            : prev.processingStep
        }));
      }, 600);
    }

    return () => clearInterval(stepInterval);
  }, [state.isProcessing]);

  const toggleExpanded = () => {
    updateState({ expanded: !state.expanded });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ input: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.input.trim() || state.isLoading) return;

    updateState({
      isLoading: true,
      isProcessing: true,
      status: "Resolving action...",
      result: null,
      error: null
    });
    
    try {
      const res = await fetch(\`\${BACKEND_URL}/api/resolve-action\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userIntent: state.input, 
          actions: actionsJson.actions 
        })
      });
      
      const aiResponse = await res.json();
      const executionResult = await executeAction(aiResponse.action, aiResponse.params);
      
      if (executionResult.success) {
        updateState({
          result: executionResult.result,
          status: \`✅ Executed: \${aiResponse.action}\`,
          showSuccess: true
        });
        
        setTimeout(() => {
          updateState({ input: '' });
          textInputRef.current?.focus();
        }, 4000);
      } else {
        throw new Error(executionResult.error);
      }
    } catch (err: any) {
      updateState({
        error: err.message,
        status: "Failed"
      });
    } finally {
      updateState({
        isLoading: false,
        isProcessing: false
      });
    }
  };

  if (!state.expanded) {
    return (
      <div className="abra-dock-container">
        <form onSubmit={handleSubmit} className="abra-dock-form">
          <input
            ref={textInputRef}
            type="text"
            placeholder="Ask Abra anything..."
            value={state.input}
            onChange={handleInputChange}
            onFocus={toggleExpanded}
            className="abra-dock-input"
          />
          <button
            type="submit"
            className="abra-dock-send"
            disabled={state.isLoading || !state.input.trim()}
          >
            ➤
          </button>
        </form>
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

          {state.isProcessing && (
            <div className="abra-thinking-container">
              {processingSteps.map((step, index) => (
                <div key={index} className="abra-thinking-step">
                  {state.processingStep > index ? (
                    <span className="abra-step-checkmark">✓</span>
                  ) : state.processingStep === index ? (
                    <span className="abra-loader"></span>
                  ) : (
                    <span style={{width: '20px'}}></span>
                  )}
                  {step}
                </div>
              ))}
            </div>
          )}

          {state.status && !state.isProcessing && (
            <div className="abra-message">
              {state.status}
            </div>
          )}

          {state.error && (
            <div className="abra-message error-message">
              {state.error}
            </div>
          )}

          {state.result && !state.error && (
            <div className="abra-message result-message">
              <pre>{JSON.stringify(state.result, null, 2)}</pre>
            </div>
          )}

          {state.showSuccess && !state.error && (
            <div className="abra-success-message">
              ✅ Operation completed successfully
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="abra-input-container">
          <input
            ref={textInputRef}
            type="text"
            placeholder="Type what you want to do..."
            value={state.input}
            onChange={handleInputChange}
            className="abra-input"
            readOnly={state.isLoading}
          />
          <button 
            type="submit" 
            className="abra-send-button"
            aria-label="Send message"
            disabled={state.isLoading || !state.input.trim()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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

/* --------------------------------------------------------------------
   writeAssistantStyles:
   Writes the CSS file used by the Abra Assistant component.
-------------------------------------------------------------------- */
function writeAssistantStyles(root: string): void {
  const file = path.join(root, 'src/abra-actions/AbraAssistant.css');
  const content = `/* Base Styles */
.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-width: calc(100% - 48px);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  background-color: rgba(18, 18, 18, 0.95);
  backdrop-filter: blur(10px);
  overflow: hidden;
  z-index: 10000;
  animation: fadeIn 0.3s ease-out;
}

.abra-header {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(18, 18, 18, 0.95);
}

.abra-title {
  margin: 0;
  color: #f0f0f0;
  font-size: 1.25rem;
  font-weight: 500;
}

.abra-close-button {
  background: none;
  border: none;
  color: #999;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
}

.abra-close-button:hover {
  color: #fff;
}

.abra-content {
  padding: 16px;
  background-color: #1a1a1a;
  max-height: 60vh;
  overflow-y: auto;
}

/* Messages */
.abra-message-container {
  margin-bottom: 16px;
}

.abra-message {
  background-color: rgba(255, 255, 255, 0.05);
  color: #f0f0f0;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.95rem;
  line-height: 1.5;
}

.error-message {
  background-color: rgba(255, 82, 82, 0.1) !important;
  border-left: 3px solid #ff5252;
  color: #ff5252;
}

.result-message {
  background-color: rgba(40, 40, 40, 0.7);
  font-family: monospace;
}

/* Processing Animation */
.abra-thinking-container {
  margin: 12px 0;
}

.abra-thinking-step {
  color: #ccc;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.abra-step-checkmark {
  color: #25d366;
  margin-right: 8px;
}

.abra-loader {
  border: 2px solid #333;
  border-top: 2px solid #25d366;
  border-radius: 50%;
  width: 12px;
  height: 12px;
  animation: spin 1s linear infinite;
  margin-right: 8px;
}

.abra-success-message {
  background-color: rgba(37, 211, 102, 0.1);
  border: 1px solid rgba(37, 211, 102, 0.3);
  color: #25d366;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}

/* Input Area */
.abra-input-container {
  display: flex;
  margin-top: 8px;
  position: relative;
}

.abra-input {
  flex: 1;
  padding: 10px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background-color: rgba(26, 26, 26, 0.8);
  color: #f0f0f0;
  font-size: 0.95rem;
}

.abra-input:focus {
  outline: none;
  border-color: rgba(37, 211, 102, 0.5);
}

.abra-send-button {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: #25d366;
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.abra-send-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Button Styles */
.abra-button-container {
  position: fixed;
  bottom: 32px;
  right: 32px;
  z-index: 9999;
}

.abra-circle-button {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #25d366;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);
  transition: transform 0.2s ease;
}

.abra-circle-button:hover {
  transform: scale(1.05);
}

.abra-at-symbol {
  color: black;
  font-weight: bold;
  font-size: 1.5rem;
}

.abra-dock-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 300px;
  background: rgba(18, 18, 18, 0.9);
  border-radius: 20px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  z-index: 9999;
}

.abra-dock-form {
  display: flex;
  align-items: center;
  padding: 8px 12px;
}

.abra-dock-input {
  flex: 1;
  background: rgba(30, 30, 30, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  outline: none;
  font-size: 0.95rem;
  color: #f0f0f0;
  padding: 8px 12px;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.abra-dock-input:focus {
  border-color: #25d366;
  box-shadow: 0 0 0 2px rgba(37, 211, 102, 0.4);
}

.abra-dock-input::placeholder {
  color: #888;
}

.abra-try-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: #aaa;
  padding: 6px 12px 4px;
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: none;
  backdrop-filter: blur(10px);
  letter-spacing: 0.5px;
}

.abra-dock-send {
  background: none;
  border: none;
  color: #25d366;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px;
  transition: transform 0.2s ease;
}

.abra-dock-send:hover {
  transform: scale(1.1);
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Mobile Responsiveness */
@media (max-width: 480px) {
  .abra-container {
    width: calc(100% - 32px);
    right: 16px;
    bottom: 16px;
  }
  
  .abra-button-container {
    bottom: 24px;
    right: 24px;
  }
}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}

/* --------------------------------------------------------------------
   Main:
   Handles command-line arguments.
   Usage:
     abra-actions init [projectRoot]
     abra-actions generate [projectRoot]
-------------------------------------------------------------------- */
function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: abra-actions <init|generate> [projectRoot]");
    process.exit(1);
  }
  const command = args[0];
  const projectRoot = args[1] || process.cwd();

  if (command === 'init') {
    writeActionRegistry([], projectRoot);
    writeExecutor(projectRoot);
    writeAbraComponent(projectRoot);
    writeAssistantStyles(projectRoot);
  } else if (command === 'generate') {
    generateActionsManifest(projectRoot);
    // Optionally regenerate the executor/component/styles if needed.
    writeExecutor(projectRoot);
    writeAbraComponent(projectRoot);
    writeAssistantStyles(projectRoot);
  } else {
    console.error("Unknown command. Use 'init' or 'generate'.");
    process.exit(1);
  }
}

main();
