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
import React, { useState, useEffect, useRef, useMemo } from "react";
import actionsJson from './__generated__/actions.json';
import { executeAction } from './__generated__/abra-executor.ts';
import './AbraAssistant.css';

const BACKEND_URL = "http://localhost:4000";

const AbraAssistant = () => {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [currentExample, setCurrentExample] = useState(0);
  const [, setTypingIndex] = useState(0);
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isAutoDemo, setIsAutoDemo] = useState(true);
  const textInputRef = useRef(null);
  const contentRef = useRef(null);

  const examples = useMemo(() => [{
    query: "What are my saved items?",
    thinking: [
      "Analyzing user session ✓",
      "Fetching saved items ✓",
      "Rendering UI..."
    ],
    success: "You have 3 saved items: 'Vintage Seiko', 'Cartier Santos', 'Omega Speedmaster'."
  }], []);

  useEffect(() => {
    if (!expanded) {
      setCurrentExample(0);
      setTypingIndex(0);
      setThinkingStep(0);
      setShowThinking(false);
      setShowSuccess(false);
      setInput('');
    } else {
      setIsAutoDemo(true);
    }
  }, [expanded]);

  useEffect(() => {
    let typingInterval;
    let initialDelay;

    if (expanded && isAutoDemo) {
      setTypingIndex(0);
      setThinkingStep(0);
      setShowThinking(false);
      setShowSuccess(false);
      setInput('');

      initialDelay = setTimeout(() => {
        const example = examples[currentExample].query;
        typingInterval = setInterval(() => {
          setTypingIndex(prev => {
            if (prev < example.length) {
              setInput(example.slice(0, prev + 1));
              return prev + 1;
            } else {
              clearInterval(typingInterval);
              setTimeout(() => setShowThinking(true), 300);
              return prev;
            }
          });
        }, 40);
      }, 500);
    }

    return () => {
      clearTimeout(initialDelay);
      clearInterval(typingInterval);
    };
  }, [expanded, currentExample, isAutoDemo, examples]);

  useEffect(() => {
    let stepInterval;

    if (showThinking && isAutoDemo) {
      setThinkingStep(0);
      stepInterval = setInterval(() => {
        setThinkingStep(prev => {
          if (prev < examples[currentExample].thinking.length) {
            return prev + 1;
          } else {
            clearInterval(stepInterval);
            setTimeout(() => {
              setShowSuccess(true);
              setTimeout(() => {
                setExpanded(false);
                setIsAutoDemo(false);
              }, 2000);
            }, 700);
            return prev;
          }
        });
      }, 800);
    }

    return () => clearInterval(stepInterval);
  }, [showThinking, currentExample, isAutoDemo]);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (isAutoDemo) {
      setIsAutoDemo(false);
      setShowThinking(false);
      setShowSuccess(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isAutoDemo) return;

    setShowThinking(true);
    setThinkingStep(0);

    try {
      const res = await fetch(\`\${BACKEND_URL}/api/resolve-action\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: input, actions: actionsJson.actions })
      });
      const aiResponse = await res.json();
      const executionResult = await executeAction(aiResponse.action, aiResponse.params);
      setShowSuccess(true);
      setTimeout(() => {
        setShowThinking(false);
        setShowSuccess(false);
        setInput('');
        if (textInputRef.current) textInputRef.current.focus();
      }, 3000);
    } catch (err) {
      console.error(err);
      setShowThinking(false);
      setShowSuccess(false);
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

          {showThinking && (
            <div className="abra-thinking-container">
              {examples[currentExample].thinking.map((step, index) => (
                <div key={index} className="abra-thinking-step">
                  {thinkingStep > index ? (
                    <span className="abra-step-checkmark">✓</span>
                  ) : thinkingStep === index ? (
                    <span className="abra-loader"></span>
                  ) : (
                    <span style={{ width: '20px' }}></span>
                  )}
                  {step.replace('✓', '').trim()}
                </div>
              ))}
            </div>
          )}

          {showSuccess && (
            <div className="abra-success-message">
              ✅ Executed successfully.
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
            readOnly={isAutoDemo}
          />
          <button 
            type="submit" 
            className="abra-send-button"
            aria-label="Send message"
            disabled={isAutoDemo}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
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
  const content = `.abra-button-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
}

.abra-circle-button {
  background-color: black;
  border: 2px solid #00ff7f;
  border-radius: 50%;
  width: 56px;
  height: 56px;
  font-size: 24px;
  color: #00ff7f;
  cursor: pointer;
  box-shadow: 0 0 8px #00ff7f;
  transition: all 0.2s ease;
}

.abra-circle-button:hover {
  transform: scale(1.08);
  box-shadow: 0 0 12px #00ff7f;
}

.abra-at-symbol {
  font-weight: bold;
}

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 360px;
  max-height: 80vh;
  background: #0a0a0a;
  color: #00ff7f;
  border: 2px solid #00ff7f;
  border-radius: 10px;
  box-shadow: 0 0 12px #00ff7f;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.abra-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #00ff7f;
  background: black;
}

.abra-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.abra-close-button {
  background: transparent;
  border: none;
  color: #00ff7f;
  font-size: 18px;
  cursor: pointer;
}

.abra-content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 12px;
  background-color: #111;
}

.abra-message-container {
  margin-bottom: 16px;
}

.abra-message {
  font-size: 14px;
  margin-bottom: 12px;
}

.abra-thinking-container {
  margin-top: 12px;
}

.abra-thinking-step {
  display: flex;
  align-items: center;
  font-size: 13px;
  margin-bottom: 6px;
}

.abra-step-checkmark {
  margin-right: 8px;
  color: #00ff7f;
}

.abra-loader {
  margin-right: 8px;
  width: 16px;
  height: 16px;
  border: 2px solid #00ff7f;
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: abra-spin 1s linear infinite;
}

@keyframes abra-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.abra-success-message {
  margin-top: 16px;
  font-size: 13px;
  color: #00ff7f;
  background: rgba(0, 255, 127, 0.1);
  padding: 8px;
  border-left: 2px solid #00ff7f;
}

.abra-input-container {
  display: flex;
  align-items: center;
  padding: 10px;
  border-top: 1px solid #00ff7f;
  background: #0a0a0a;
}

.abra-input {
  flex-grow: 1;
  padding: 8px 10px;
  background: black;
  color: #00ff7f;
  border: 1px solid #00ff7f;
  border-radius: 4px;
  font-size: 13px;
  margin-right: 8px;
}

.abra-send-button {
  background: #00ff7f;
  color: black;
  border: none;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.abra-send-button:hover {
  background: #00cc66;
}
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('✅ Wrote AbraAssistant.css');
}


const projectRoot = process.argv[2] || process.cwd();
main(projectRoot);
