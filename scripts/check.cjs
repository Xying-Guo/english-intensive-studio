'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 required');
for (const file of ['core.js', 'content.js', 'dock.js', 'background.js', 'panel.js', 'microphone.js']) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}
const assets = [manifest.background.service_worker, 'sidepanel.html',
  ...manifest.content_scripts.flatMap(entry => entry.js), 'studio.css', 'tokens.css', 'microphone.html'];
for (const file of assets) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
if (manifest.host_permissions.join() !== 'https://www.youtube.com/*') throw new Error('Unexpected host access');
if (manifest.side_panel || manifest.permissions.includes('sidePanel')) throw new Error('The native sidebar must remain available to ChatGPT');
if (manifest.web_accessible_resources.some(entry => entry.resources.some(file => file !== 'sidepanel.html'))) throw new Error('Only the workspace page is web accessible');
if (!manifest.content_security_policy.extension_pages.includes("connect-src 'none'")) throw new Error('Network disabled policy required');
console.log('PASS: JavaScript syntax, manifest assets, YouTube-only host access, and no-network extension CSP.');
