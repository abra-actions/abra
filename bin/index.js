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
    const adjustHeight = () => {
      if (contentRef.current && expanded) {
        const contentHeight = contentRef.current.scrollHeight;
        const maxHeight = window.innerHeight * 0.8;
        const minHeight = 300; 
        
        contentRef.current.style.maxHeight = Math.max(minHeight, Math.min(contentHeight + 40, maxHeight)) + 'px';
        
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
  }, [expanded, isProcessing, processingStep, showSuccess]);

  useEffect(() => {
    const heroElement = document.querySelector('.hero');
    const buttonElement = document.querySelector('.abra-button-container');
    
    if (heroElement && buttonElement) {
      buttonElement.style.marginTop = '0';
    }
  }, []);

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
            <div className="abra-thinking-container">
              {processingSteps.map((step, index) => (
                <div key={index} className="abra-thinking-step">
                  {processingStep > index ? (
                    <span className="abra-step-checkmark">✓</span>
                  ) : processingStep === index ? (
                    <span className="abra-loader"></span>
                  ) : (
                    <span style={{width: '20px'}}></span>
                  )}
                  {step}
                </div>
              ))}
            </div>
          )}

          {status && !isProcessing && (
            <div className="abra-message">
              {status}
            </div>
          )}

          {error && (
            <div className="abra-message" style={{color: '#ff5252', backgroundColor: 'rgba(255, 80, 80, 0.1)', borderLeft: '3px solid #ff5252', padding: '12px 14px'}}>
              {error}
            </div>
          )}

          {result && !error && (
            <div className="abra-message" style={{backgroundColor: 'rgba(40, 40, 40, 0.7)', padding: '14px', borderRadius: '6px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {showSuccess && !error && (
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
            value={input}
            onChange={handleInputChange}
            className="abra-input"
            readOnly={isLoading}
          />
          <button 
            type="submit" 
            className="abra-send-button"
            aria-label="Send message"
            disabled={isLoading || !input.trim()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '-1px', marginTop: '0px'}}>
              <path d="M22 2L11 13" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
  const content = `.abra-container {
  position: relative;
  max-width: 500px;
  margin: 0 auto 2rem auto;
  z-index: 100;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.15);
  background-color: rgba(18, 18, 18, 0.95);
  backdrop-filter: blur(10px);
  overflow: hidden;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  max-height: 85vh; 
  min-height: 400px; 
}

.abra-header {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(18, 18, 18, 0.95); 
  z-index: 10; 
}

.abra-title {
  margin: 0;
  color: #F0F0F0;
  font-size: 1.25rem;
  font-weight: 500;
}

.abra-close-button {
  background: none;
  border: none;
  color: #999999;
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.abra-content {
  padding: 20px;
  background-color: #1A1A1A;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transition: max-height 0.3s ease; 
  min-height: 300px; 
}

.abra-message {
  background-color: #1A1A1A;
  padding: 16px 18px;
  border-radius: 10px;
  margin-bottom: 15px;
  color: #E0E0E0;
  font-size: 0.9rem;
  line-height: 1.5;
  letter-spacing: 0.02em;
  width: 95%;
  margin-left: auto;
  margin-right: auto;
  word-wrap: break-word;
}

.abra-thinking-container {
  background-color: transparent;
  border-left: 2px solid #25D366;
  margin: 15px 0;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.abra-thinking-step {
  color: #ccc;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
}

.abra-step-checkmark {
  color: #25D366;
  margin-right: 8px;
}

.abra-loader {
  border: 2px solid #333;
  border-top: 2px solid #25D366;
  border-radius: 50%;
  width: 12px;
  height: 12px;
  animation: spin 1s linear infinite;
  margin-right: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.abra-success-message {
  background-color: rgba(37, 211, 102, 0.08);
  border: 1px solid rgba(37, 211, 102, 0.2);
  color: #25D366;
  border-radius: 10px;
  padding: 14px 16px;
  margin: 15px 0 20px 0;
  font-size: 0.9rem;
  line-height: 1.5;
  animation: pulse 1.5s ease;
}

.abra-suggestion-container {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.abra-suggestion-button {
  background-color: rgba(37, 211, 102, 0.08);
  border: 1px solid rgba(37, 211, 102, 0.3);
  color: #25D366;
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
  letter-spacing: 0.01em;
}

.abra-suggestion-button:hover {
  background-color: rgba(37, 211, 102, 0.15);
  transform: translateY(-2px);
}

.abra-input-container {
  display: flex;
  align-items: center;
  position: relative;
  margin-top: auto;
  margin-bottom: 10px; 
}

.abra-input {
  flex: 1;
  padding: 10px 15px;
  padding-right: 40px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background-color: rgba(26, 26, 26, 0.8);
  color: #F0F0F0;
  font-size: 0.9rem;
  outline: none;
  backdrop-filter: blur(10px);
}

.abra-send-button {
  position: absolute;
  right: 10px;
  background: #25D366;
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.abra-button-container {
  text-align: center;
  margin: 0 auto 2rem auto;
  position: relative;
}

.abra-circle-button {
  width: 65px;
  height: 65px;
  display: block;
  margin: 0 auto;
  border-radius: 50%;
  background-color: #25D366;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(37, 211, 102, 0.35), 0 2px 8px rgba(37, 211, 102, 0.2);
  border: none;
  z-index: 100;
  animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}

.abra-at-symbol {
  font-size: 1.8rem;
  color: black;
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(255,255,255,0.15);
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.abra-send-button:hover {
  background-color: #1fbe59;
}

.abra-circle-button:hover {
  transform: scale(1.05);
}

.abra-close-button:hover {
  color: #ffffff;
}

.abra-input:focus {
  border-color: rgba(37, 211, 102, 0.5);
}

.abra-error-message {
  margin-top: 10px;
  font-size: 13px;
  color: #ff5252;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(255, 80, 80, 0.1);
  border-left: 3px solid #ff5252;
  animation: fadeIn 0.3s ease forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0% { background-color: rgba(37, 211, 102, 0.08); }
  50% { background-color: rgba(37, 211, 102, 0.18); }
  100% { background-color: rgba(37, 211, 102, 0.08); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.4);
  }
  
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 15px rgba(37, 211, 102, 0);
  }
  
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(37, 211, 102, 0);
  }
}

.abra-container {
  animation: fadeIn 0.5s ease-out forwards;
}

.abra-input[readonly] {
  cursor: not-allowed;
  opacity: 0.95;
}

.abra-send-button[disabled] {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Fixed positioning for the real assistant */
.abra-button-container {
  position: fixed;
  bottom: 32px;
  right: 32px;
  z-index: 9999;
}

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-width: 500px; 
  z-index: 10000;
}

@media (max-width: 480px) {
  .abra-container {
    max-width: calc(100% - 40px);
    bottom: 80px;
  }
}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}


const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
