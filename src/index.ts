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
  const allFiles = getAllTSFiles(path.join(projectRoot, 'src'));
  const program = ts.createProgram(allFiles, { allowJs: false });
  const checker = program.getTypeChecker();
  const registryPath = path.join(projectRoot, 'src/abra-actions/__generated__/actionRegistry.ts');
  const sourceFile = program.getSourceFile(registryPath);
  if (!sourceFile) {
    console.error(`Could not read source file from ${registryPath}`);
    process.exit(1);
  }
  const actions: any[] = [];
  let registryObjectLiteral: ts.ObjectLiteralExpression | null = null;
  ts.forEachChild(sourceFile, node => {
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(decl => {
        if (decl.name.getText() === 'actionRegistry' && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          registryObjectLiteral = decl.initializer;
        }
      });
    }
  });
  if (!registryObjectLiteral) {
    console.error("Could not find actionRegistry object literal in registry file.");
    process.exit(1);
  }
  function resolveFunctionSignature(identifier: ts.Identifier): { name: string; signature: ts.Signature } | null {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (!symbol) {
      return null;
    }
    const targetSymbol = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    const declarations = targetSymbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return null;
    }
    let signature: ts.Signature | undefined = undefined;
    for (const d of declarations) {
      if (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d) || ts.isMethodDeclaration(d)) {
        signature = checker.getSignatureFromDeclaration(d as ts.SignatureDeclaration);
        if (signature) break;
      }
    }
    if (!signature) {
      const type = checker.getTypeOfSymbolAtLocation(targetSymbol, declarations[0]);
      signature = type.getCallSignatures()[0];
    }
    if (!signature) {
      return null;
    }
    console.log(`Type of '${identifier.text}':`, checker.typeToString(checker.getTypeOfSymbolAtLocation(targetSymbol, declarations[0])));
    return { name: identifier.text || targetSymbol.getName() || 'default', signature };
  }
  function extractParams(signature: ts.Signature): Record<string, any> {
    const params: Record<string, any> = {};
    for (const param of signature.getParameters()) {
      const decl = param.declarations?.[0];
      if (!decl) continue;
      const type = checker.getTypeOfSymbolAtLocation(param, decl);
      const serialized = serializeType(type, checker, new Map(), new Set(), new Set());
      const bindingName = (decl as any).name;
      if (bindingName && ts.isObjectBindingPattern(bindingName) && serialized && typeof serialized === "object") {
        Object.assign(params, serialized);
      } else {
        const paramName = param.getName();
        params[paramName] = serialized;
      }
    }
    return params;
  }
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
    actions.push({ name: prop.name.getText(), parameters });
  }
  const outPath = path.join(projectRoot, 'src/abra-actions/__generated__/actions.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ actions }, null, 2));
  console.log(`✅ Wrote actions.json based on actionRegistry.ts (${actions.length} action(s))`);
}


function writeActionRegistry(_: any, root: string): void {
  const out = `// AUTO-GENERATED BY ABRA CLI 
// Import your functions below and register them.

export const actionRegistry = {
  // IMPORT FUNCTIONS HERE:
};
`;
  const file = path.join(root, 'src/abra-actions/__generated__/actionRegistry.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote empty actionRegistry.ts (manual mode)`);
}


function writeExecutor(root: string): void {
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

function writeAbraComponent(root: string): void {
  const out = `// AUTO-GENERATED BY ABRA CLI — DO NOT EDIT MANUALLY
import React, { useState, useEffect, useRef } from "react";
import actionsJson from './__generated__/actions.json';
import { executeAction } from './__generated__/abra-executor';
import './AbraAssistant.css';

const BACKEND_URL = "https://api.abra-actions.com";

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
  previousContext: { action: string, params: Record<string, any> } | null;
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
    showSuccess: false,
    previousContext: null,
  });

  const textInputRef = useRef<HTMLTextAreaElement>(null);
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

  // Function to adjust input height based on content
  const adjustInputHeight = () => {
    if (textInputRef.current) {
      textInputRef.current.style.height = 'auto';
      const scrollHeight = textInputRef.current.scrollHeight;
      // Set a maximum height (adjust as needed)
      const maxHeight = 120;
      textInputRef.current.style.height = \`\${Math.min(scrollHeight, maxHeight)}px\`;
    }
  };

  useEffect(() => {
    // Adjust input height whenever input changes
    adjustInputHeight();
  }, [state.input]);

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
  }, [state.isProcessing, processingSteps.length]);

  const toggleExpanded = () => {
    updateState({ expanded: !state.expanded });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateState({ input: e.target.value });
  };

  // Handle key presses in the textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift key)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
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
          actions: actionsJson.actions,
          previousContext: state.previousContext
        })
      });
  
      const aiResponse = await res.json();
  
      if (aiResponse.followup) {
        updateState({
          status: aiResponse.followup.message,
          previousContext: {
            action: aiResponse.action,
            params: { 
              ...state.previousContext?.params,
              ...aiResponse.params
            }
          },
          input: '',
          isLoading: false,
          isProcessing: false,
        });
        return;
      }
  
      const executionResult = await executeAction(aiResponse.action, aiResponse.params);
  
      if (executionResult.success) {
        updateState({
          result: executionResult.result,
          status: \`Successfully executed: \${aiResponse.action}\`,
          input: '',
          previousContext: null, 
          showSuccess: true
        });
  
        setTimeout(() => {
          updateState({ showSuccess: false });
          textInputRef.current?.focus();
        }, 4000);
      } else {
        throw new Error(executionResult.error);
      }
    } catch (err: any) {
      updateState({
        error: err.message,
        status: "Operation failed"
      });
    } finally {
      updateState({
        isLoading: false,
        isProcessing: false
      });
    }
  };
  
  // Function to handle example clicks
  const handleExampleClick = (example: string) => {
    updateState({ input: example });
    if (textInputRef.current) {
      textInputRef.current.focus();
    }
  };

  // Arrow icon component
  const ArrowIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 5L19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  if (!state.expanded) {
    return (
      <div className="abra-dock-container">
        <form onSubmit={handleSubmit} className="abra-dock-form">
          <input
            type="text"
            placeholder="Ask Abra anything..."
            value={state.input}
            onChange={(e) => updateState({ input: e.target.value })}
            onFocus={toggleExpanded}
            className="abra-dock-input"
          />
          <button
            type="submit"
            className="abra-dock-send"
            disabled={state.isLoading || !state.input.trim()}
          >
            <ArrowIcon />
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
            <strong>Try Abra with some of our favorites:</strong>
            <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
              {[
                "Contact the team",
                "Take me to the GitHub docs",
                "Subscribe to mailing list",
                "Tweet about Abra",
                "Share this page with friends",
                "Setup time"
              ].map((example, index) => (
                <li 
                  key={index} 
                  onClick={() => handleExampleClick(example)}
                >
                  {example}
                </li>
              ))}
            </ul>
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

          {state.status && !state.isProcessing && !state.error && !state.showSuccess && (
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
            <div className="abra-message">
              {typeof state.result === 'string'
                ? state.result
                : JSON.stringify(state.result, null, 2)}
            </div>
          )}

          {state.showSuccess && !state.error && (
            <div className="abra-success-message">
              <div className="abra-success-icon">✓</div>
              Operation completed successfully
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="abra-input-container">
          <textarea
            ref={textInputRef}
            placeholder="Type what you want to do..."
            value={state.input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="abra-input"
            readOnly={state.isLoading}
            rows={1}
          />
          <button 
            type="submit" 
            className="abra-send-button"
            aria-label="Send message"
            disabled={state.isLoading || !state.input.trim()}
          >
            <ArrowIcon />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AbraAssistant;`;

  const file = path.join(root, 'src/abra-actions/AbraAssistant.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote AbraAssistant.tsx`);
}

function writeAssistantStyles(root: string): void {
  const file = path.join(root, 'src/abra-actions/AbraAssistant.css');
  const content = `/* Import Krona One font */
@import url('https://fonts.googleapis.com/css2?family=Krona+One&display=swap');
/* Import Inter font for consistent typography */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-width: calc(100% - 48px);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(74, 229, 131, 0.15);
  background-color: rgba(14, 14, 14, 0.95);
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
  background-color: rgba(14, 14, 14, 0.98);
}

.abra-title {
  margin: 0;
  color: #f0f0f0;
  font-size: 1.25rem;
  font-weight: 500;
  font-family: 'Krona One', sans-serif;
  letter-spacing: -0.02em;
}

.abra-close-button {
  background: none;
  border: none;
  color: #999;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.abra-close-button:hover {
  color: #4AE583;
}

.abra-content {
  padding: 16px;
  background-color: #111111;
  max-height: 60vh;
  overflow-y: auto;
  transition: max-height 0.3s ease-out;
}

.abra-message-container {
  margin-bottom: 16px;
}

.abra-message {
  background-color: rgba(255, 255, 255, 0.03);
  color: #f0f0f0;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.95rem;
  line-height: 1.5;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.abra-message strong {
  color: #fff;
  font-family: 'Krona One', sans-serif;
  font-size: 0.9rem;
  letter-spacing: -0.01em;
}

.abra-message ul {
  margin-top: 10px;
}

.abra-message li {
  margin-bottom: 6px;
  color: #ccc;
  position: relative;
  transition: color 0.15s ease, transform 0.15s ease;
  padding-left: 5px;
}

.abra-message li:hover {
  color: #4AE583;
  cursor: pointer;
  transform: translateX(2px);
}

.error-message {
  background: linear-gradient(135deg, rgba(255, 82, 82, 0.08) 0%, rgba(255, 82, 82, 0.02) 100%) !important;
  border: none !important;
  position: relative;
  color: #ff8a8a !important;
  box-shadow: 0 4px 12px rgba(255, 82, 82, 0.15);
  overflow: hidden;
}

.error-message::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(to bottom, #ff5252, rgba(255, 82, 82, 0.5));
}

.error-message::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255, 82, 82, 0.5), transparent);
}

.result-message {
  background-color: rgba(40, 40, 40, 0.7);
  font-family: monospace;
}

.abra-thinking-container {
  margin: 12px 0;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.abra-thinking-step {
  color: #aaa;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.abra-step-checkmark {
  color: #4AE583;
  margin-right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.abra-loader {
  border: 2px solid rgba(74, 229, 131, 0.1);
  border-top: 2px solid #4AE583;
  border-right: 2px solid #4AE583;
  border-radius: 50%;
  width: 14px;
  height: 14px;
  animation: spin 0.8s linear infinite;
  margin-right: 8px;
}

.abra-success-message {
  background: linear-gradient(135deg, rgba(74, 229, 131, 0.08) 0%, rgba(74, 229, 131, 0.02) 100%);
  border: none;
  color: #4AE583;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
  position: relative;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 12px rgba(74, 229, 131, 0.1);
  overflow: hidden;
  display: flex;
  align-items: center;
}

.abra-success-message::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(to bottom, #4AE583, rgba(74, 229, 131, 0.5));
}

.abra-success-message::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(74, 229, 131, 0.5), transparent);
}

.abra-success-icon {
  margin-right: 8px;
  width: 20px;
  height: 20px;
  background: rgba(74, 229, 131, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.abra-input-container {
  display: flex;
  margin-top: 8px;
  position: relative;
}

.abra-input {
  flex: 1;
  padding: 12px 46px 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(20, 20, 20, 0.8);
  color: #f0f0f0;
  font-size: 0.95rem;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 46px;
  height: auto;
  max-height: 120px;
  overflow-y: auto;
  resize: none;
  transition: border-color 0.2s ease, min-height 0.2s ease, box-shadow 0.2s ease;
}

.abra-input:focus {
  outline: none;
  border-color: rgba(74, 229, 131, 0.5);
  box-shadow: 0 0 0 2px rgba(74, 229, 131, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}

.abra-send-button {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(74, 229, 131, 0.9);
  border: none;
  border-radius: 8px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.abra-send-button:hover {
  transform: translateY(-50%) scale(1.05);
  background-color: #4AE583;
}

.abra-send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(74, 229, 131, 0.3);
}

.abra-dock-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 340px;
  background: rgba(18, 18, 18, 0.95);
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(74, 229, 131, 0.15);
  backdrop-filter: blur(10px);
  z-index: 9999;
  overflow: hidden;
}

.abra-dock-form {
  display: flex;
  align-items: center;
  padding: 8px;
  position: relative;
}

.abra-dock-input {
  flex: 1;
  background: rgba(25, 25, 25, 0.95);
  border: 1px solid rgba(74, 229, 131, 0.1);
  outline: none;
  font-size: 0.95rem;
  color: #f0f0f0;
  padding: 12px 46px 12px 16px;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 400;
  letter-spacing: -0.01em;
}

.abra-dock-input:focus {
  border-color: #4AE583;
  box-shadow: 0 0 0 2px rgba(74, 229, 131, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}

.abra-dock-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 400;
  opacity: 0.7;
}

.abra-dock-container::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, 
    rgba(74, 229, 131, 0), 
    rgba(74, 229, 131, 0.3), 
    rgba(74, 229, 131, 0));
  z-index: 1;
}

.abra-dock-send {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(74, 229, 131, 0.9);
  border: none;
  border-radius: 8px;
  color: #000;
  height: 32px;
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.abra-dock-send:hover {
  transform: translateY(-50%) scale(1.05);
  background-color: #4AE583;
}

.abra-dock-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(74, 229, 131, 0.3);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Animation for notification messages */
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(74, 229, 131, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(74, 229, 131, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 229, 131, 0); }
}

@keyframes shiftGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@media (max-width: 480px) {
  .abra-container {
    width: calc(100% - 32px);
    right: 16px;
    bottom: 16px;
  }
  
  .abra-dock-container {
    width: calc(100% - 32px);
    right: 16px;
    bottom: 16px;
  }
}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}

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
