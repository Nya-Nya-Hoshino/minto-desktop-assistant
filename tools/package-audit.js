'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
// GitHub documents ghp_ as the classic PAT prefix; no fixed token length is assumed.
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
function checkTextSecrets(text, file) {
  assert.ok(!/sk-[a-f0-9]{32}/i.test(text), 'Plaintext API key detected in ' + file);
  assert.ok(!/\bghp_[A-Za-z0-9]+\b/.test(text), 'Plaintext GitHub personal access token detected in ' + file);
}

function auditConfiguration(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.build.win.requestedExecutionLevel, 'asInvoker');
  assert.equal(manifest.build.nsis.allowElevation, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.packElevateHelper, false);
  assert.equal(manifest.build.extraResources[0].from, 'runtime');
  assert.equal(manifest.build.extraResources[0].to, 'runtime');
  assert.equal(Object.keys(manifest.dependencies).length, 0);
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  assert.ok(installer.includes('StrCpy $isForceCurrentInstall "1"'));
  assert.ok(!installer.includes('download') && !installer.includes('taskkill'));
  for (const file of ['runtime/python/python.exe', 'runtime/voice_server.py', 'runtime/model_assets/Minto/config.json', 'runtime/model_assets/Minto/Minto.safetensors', 'runtime/model_assets/Minto/style_vectors.npy']) {
    assert.ok(fs.statSync(path.join(root, file)).isFile(), 'Missing release resource: ' + file);
  }
  return manifest;
}
function walk(root, folder = root) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(root, full) : [path.relative(root, full).split(path.sep).join('/')];
  });
}
function auditUnpacked(root, portable) {
  const paths = walk(root);
  assert.equal(fs.existsSync(path.join(root, 'portable.flag')), portable, 'Portable marker must match the target');
  for (const file of paths) {
    assert.ok(!/(^|\/)(_data|private|__pycache__|tests|test|training|originals|raw)(\/|$)/.test(file), 'Forbidden release path: ' + file);
    assert.ok(!/\.(lib|h|hpp|pdb|exp|pyc|pyo|wav)$/i.test(file), 'Development/training file shipped: ' + file);
    assert.ok(!file.includes('deberta-v2-large-japanese-char-wwm-onnx/'), 'Unused ONNX BERT shipped');
    assert.ok(!file.includes('python/Lib/site-packages/Library/bin/'), 'Duplicate runtime DLL directory shipped');
    assert.ok(!file.endsWith('/settings.json'), 'User settings shipped');
    if (/\.(js|json|html|md|txt|py|yaml|yml|toml)$/.test(file)) {
      checkTextSecrets(fs.readFileSync(path.join(root, file), 'utf8'), file);
    }
  }
  for (const file of ['MintoAssistant.exe', 'resources/runtime/python/python.exe', 'resources/runtime/python/Library/bin/mkl_rt.1.dll', 'resources/runtime/python/LICENSE.txt', 'resources/runtime/model_assets/Minto/Minto.safetensors', 'resources/runtime/licenses/Style-Bert-VITS2-LICENSE']) {
    assert.ok(fs.existsSync(path.join(root, file)), 'Missing bundled file: ' + file);
  }
  const executableText = fs.readFileSync(path.join(root, 'MintoAssistant.exe')).toString('utf8');
  assert.ok(executableText.includes('<requestedExecutionLevel level="asInvoker" uiAccess="false"/>'), 'Executable requests elevated execution');
  const archive = path.join(root, 'resources', 'app.asar');
  const entries = asar.listPackage(archive, {}).map(item => item.split(path.sep).join('/'));
  for (const item of entries) {
    assert.ok(!/(^|\/)(_data|private|tools|tests|node_modules|xuan9\.0)(\/|$)/.test(item), 'Unexpected app archive path: ' + item);
    if (/\.(js|json|html|md)$/.test(item)) {
      const text = asar.extractFile(archive, path.normalize(item.replace(/^\//, ''))).toString('utf8');
      checkTextSecrets(text, item);
    }
  }
  assert.ok(entries.includes('/assets/minto/Minto_Tuujou/Minto_Tuujou.model3.json'));
  assert.ok(entries.includes('/assets/minto/minto_Pajama/minto_Pajama.model3.json'));
  const totalBytes = paths.reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
  console.log(JSON.stringify({ event: 'package-audit', portable, files: paths.length, bytes: totalBytes }));
  return { portable, files: paths.length, bytes: totalBytes };
}
async function writeReleaseHashes(root) {
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter(name => /^MintoAssistant-.*\.(exe|zip)$/.test(name));
  const rows = [];
  for (const name of names) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(dist, name))) hash.update(chunk);
    rows.push(hash.digest('hex') + '  ' + name);
  }
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
  console.log(JSON.stringify({ event: 'release-hashes', artifacts: names }));
}
module.exports = { auditConfiguration, auditUnpacked, writeReleaseHashes };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  auditConfiguration(root);
  const unpacked = path.join(root, 'dist', 'win-unpacked');
  if (fs.existsSync(unpacked)) auditUnpacked(unpacked, fs.existsSync(path.join(unpacked, 'portable.flag')));
}
