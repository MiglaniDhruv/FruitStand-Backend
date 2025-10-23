// check-missing-npm-deps.js
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import module from 'module';

const builtins = new Set(module.builtinModules);
const projectDir = path.resolve('.');
const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
const installed = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);

const importRegex = /import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g;
const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

function getAllTsFiles(dir) {
  let files = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(file => {
    const res = path.resolve(dir, file.name);
    if (file.isDirectory()) files = files.concat(getAllTsFiles(res));
    else if (file.name.endsWith('.ts') || file.name.endsWith('.js')) files.push(res);
  });
  return files;
}

const tsFiles = getAllTsFiles(projectDir);
let imports = new Set();

tsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  let match;
  while ((match = importRegex.exec(content))) imports.add(match[1]);
  while ((match = requireRegex.exec(content))) imports.add(match[1]);
});

// Filter: only npm packages
const packages = [...imports].filter(i => {
  if (i.startsWith('.') || i.startsWith('/')) return false; // ignore relative
  if (builtins.has(i.replace(/^node:/, ''))) return false;   // ignore built-in Node
  if (i.includes('{') || i.includes('}')) return false;      // ignore garbage
  if (i.startsWith('node:')) return false;                  // ignore node: protocol
  return true;
}).map(i => {
  // For subpaths like 'drizzle-orm/neon-serverless', keep only main package
  if (i.startsWith('@')) return i.split('/').slice(0, 2).join('/'); // scoped package
  return i.split('/')[0];
});

const missing = [...new Set(packages)].filter(p => !installed.has(p));

if (missing.length === 0) {
  console.log('✅ All npm dependencies are installed.');
} else {
  console.log('❌ Missing npm dependencies:', missing.join(', '));
  console.log('\nInstalling missing npm dependencies...');
  execSync(`npm install ${missing.join(' ')}`, { stdio: 'inherit' });
  console.log('✅ Installed missing npm dependencies!');
}
