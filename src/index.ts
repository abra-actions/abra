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
  const registryPath = path.join(projectRoot, 'src/abra-actions/actionRegistry.ts');
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
  const file = path.join(root, 'src/abra-actions/actionRegistry.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote empty actionRegistry.ts (manual mode)`);
}

function writeConfigFile(root: string) {
  const out = `// AUTO-GENERATED BY ABRA CLI
// Customize this config file as needed

import actionRegistry from './abra-actions/actionRegistry';
import actions from './abra-actions/__generated__/actions.json';

const abraConfig = {
  apiKey: process.env.ABRA_API_KEY || "",
  actionRegistry,
  actions: actions.actions
};

export default abraConfig;
`;
  const file = path.join(root, 'src/abra.config.ts');
  fs.writeFileSync(file, out);
  console.log(`✅ Wrote abra.config.ts`);
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
    writeConfigFile(projectRoot);
  } else if (command === 'generate') {
    generateActionsManifest(projectRoot);
  } else {
    console.error("Unknown command. Use 'init' or 'generate'.");
    process.exit(1);
  }
}

main();
