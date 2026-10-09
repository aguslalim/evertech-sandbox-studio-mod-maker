import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = [
  'index.html', 'css/styles.css', 'js/app.js', 'vendor/jszip.min.js',
  'README.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE.md', 'docs/ARCHITECTURE.md'
];
const problems = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) problems.push(`Missing required file: ${file}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const vendor = fs.readFileSync(path.join(root, 'vendor/jszip.min.js'), 'utf8');

for (const asset of ['css/styles.css', 'vendor/jszip.min.js', 'js/app.js']) {
  if (!html.includes(asset)) problems.push(`index.html does not reference ${asset}`);
}
if (!html.includes('<!doctype html>') && !html.includes('<!DOCTYPE html>')) problems.push('index.html is missing a doctype.');
if (!html.includes('id="downloadZip"')) problems.push('Expected ZIP export control was not found.');
if (!app.includes('function exportZip') && !app.includes('async function exportZip')) problems.push('ZIP export function was not found.');
if (!app.includes('zipProfile')) problems.push('ZIP compression profile logic was not found.');
if (!vendor.includes('JSZip v3.10.1')) problems.push('Vendored JSZip license/version header was not found.');
if (css.length < 1000) problems.push('Stylesheet looks unexpectedly small.');

for (const [name, source] of [['Application JavaScript', app], ['Vendored JSZip', vendor]]) {
  try {
    new vm.Script(source, { filename: name });
  } catch (error) {
    problems.push(`${name} syntax error: ${error.message}`);
  }
}

if (problems.length) {
  console.error(problems.map(p => `FAIL: ${p}`).join('\n'));
  process.exit(1);
}
console.log('PASS: required files exist');
console.log('PASS: HTML asset references and key export controls exist');
console.log('PASS: app.js and vendored JSZip parse without syntax errors');
console.log(`INFO: index ${Buffer.byteLength(html)} bytes; CSS ${Buffer.byteLength(css)} bytes; app JS ${Buffer.byteLength(app)} bytes; vendor JS ${Buffer.byteLength(vendor)} bytes`);
