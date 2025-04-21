import ts from 'typescript';
import fs from 'fs';
import path from 'path';

export interface ScrapedContent {
  routes: string[];
  navLabels: string[];
  sections: { heading: string; content: string }[];
}

function getAllFiles(dir: string, ext: string[] = ['.tsx', 'jsx']): string[] {
  const files: string[] = [];
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, ext));
    } else if (ext.includes(path.extname(fullPath))) {
      files.push(fullPath);
    }
  });
  return files;
}

function extractTextFromJsx(node: ts.Node): string[] {
  const text: string[] = [];

  function recurse(n: ts.Node) {
    if (ts.isJsxText(n)) {
      const t = n.getText().trim();
      if (t) text.push(t);
    } else if (ts.isStringLiteral(n)) {
      const t = n.text.trim();
      if (t) text.push(t);
    }
    ts.forEachChild(n, recurse);
  }

  recurse(node);
  return text;
}

export function scrapeDOMFromSource(rootDir: string): ScrapedContent {
  const files = getAllFiles(rootDir);

  const routes: Set<string> = new Set();
  const navLabels: Set<string> = new Set();
  const sections: { heading: string; content: string }[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
        const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText() : node.tagName.getText();
        const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;

        // Routes: <a href="/...">
        if (tag === 'a' || tag === 'Link') {
          for (const attr of attributes.properties) {
            if (
              ts.isJsxAttribute(attr) &&
              attr.name.getText() === 'href' &&
              attr.initializer &&
              ts.isStringLiteral(attr.initializer)
            ) {
              routes.add(attr.initializer.text);
            }
          }

          const label = extractTextFromJsx(node).join(' ').trim();
          if (label) navLabels.add(label);
        }

        // Headings
        if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
          const heading = extractTextFromJsx(node).join(' ').trim();
          if (heading) sections.push({ heading, content: '' });
        }

        // Paragraphs: assign to last heading
        if (tag === 'p') {
          const last = sections.at(-1);
          if (last) {
            const content = extractTextFromJsx(node).join(' ').trim();
            if (content) last.content += ' ' + content;
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    ts.forEachChild(source, visit);
  }

  return {
    routes: [...routes],
    navLabels: [...navLabels],
    sections,
  };
}
