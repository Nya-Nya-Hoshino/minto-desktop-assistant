'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { path7za } = require('7zip-bin');
const { SaveStore } = require('../services/save-store');
const { auditUnpacked } = require('./package-audit');
const { VoiceRuntime } = require('../services/voice-runtime');
const { VoiceService } = require('../services/voice-service');

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MINTO_DATA_DIR;
    const child = spawn(executable, args, { windowsHide: true, env, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(path.basename(executable) + ' exited ' + code + '\n' + output.slice(-6000))));
  });
}
async function desktop(executable, output, singleInstanceData) {
  const first = run(executable, ['--verify', '--verify-output=' + output], { cwd: path.dirname(executable) });
  let secondLaunchGuarded;
  if (singleInstanceData) {
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(path.join(singleInstanceData, 'settings.json')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(path.join(singleInstanceData, 'settings.json')));
    const secondOutput = output + '-second-instance';
    await run(executable, ['--verify', '--verify-output=' + secondOutput], { cwd: path.dirname(executable) });
    secondLaunchGuarded = !fs.existsSync(path.join(secondOutput, 'desktop.json'));
    assert.ok(secondLaunchGuarded, 'Same data root opened a second desktop instance');
  }
  await first;
  const results = JSON.parse(fs.readFileSync(path.join(output, 'desktop.json'), 'utf8'));
  assert.ok(results.diagnostics.ready && results.results.every(row => row.passed));
  const settings = JSON.parse(fs.readFileSync(path.join(output, 'settings-dom.json'), 'utf8'));
  return { checks: results.results.length, dataRoot: settings.dataRoot, saveId: results.state.saveId, ...(secondLaunchGuarded === undefined ? {} : { secondLaunchGuarded }) };
}
async function verifyPortable(root, output) {
  const manifest = require(path.join(root, 'package.json'));
  const archive = path.join(root, 'dist', 'MintoAssistant-' + manifest.version + '-windows-x64.zip');
  const target = path.join(output, 'portable');
  await run(path7za, ['x', archive, '-o' + target, '-y']);
  auditUnpacked(target, true);
  const executable = path.join(target, 'MintoAssistant.exe');
  const first = await desktop(executable, path.join(output, 'portable-first'), path.join(target, 'data'));
  assert.equal(first.dataRoot, path.join(target, 'data'));
  const store = new SaveStore(first.dataRoot);
  const marker = '再起動しても、この会話を覚えているのです。';
  store.append('存档持久化验收', marker, { emotion: 'happy', pose: 'mPose3' });
  const second = await desktop(executable, path.join(output, 'portable-restart'));
  assert.equal(second.saveId, first.saveId);
  assert.equal(new SaveStore(second.dataRoot).current().messages.at(-1).content, marker);
  const offlineVoice = await verifyOfflineVoice(target, output);
  return { first, second, markerPreserved: true, executable, offlineVoice };
}
async function verifyOfflineVoice(target, output) {
  const names = ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HTTPS_PROXY', 'HTTP_PROXY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.HF_HUB_OFFLINE = '1'; process.env.TRANSFORMERS_OFFLINE = '1';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1'; process.env.HTTP_PROXY = 'http://127.0.0.1:1';
  const manager = new VoiceRuntime(path.join(output, 'offline-voice'), { runtimeRoot: path.join(target, 'resources', 'runtime') });
  try {
    await manager.start();
    const settings = JSON.parse(fs.readFileSync(path.join(target, 'data', 'settings.json'), 'utf8'));
    const voice = new VoiceService(manager.config(settings.voice));
    const models = await voice.info();
    const start = Date.now();
    const bytes = await voice.synthesize('マスター、おかえりなのです。ボクと一緒に、少し休むのですよ。');
    assert.ok(bytes.length > 44 && bytes.subarray(0, 4).toString('ascii') === 'RIFF');
    const audio = path.join(output, 'offline-voice.wav');
    fs.writeFileSync(audio, bytes);
    return { models: Object.keys(models), bytes: bytes.length, milliseconds: Date.now() - start, audio, externalNetworkDisabled: true };
  } finally {
    manager.stop();
    for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
  }
}
async function verifyInstaller(root, output) {
  const manifest = require(path.join(root, 'package.json'));
  const installer = path.join(root, 'dist', 'MintoAssistant-Setup-' + manifest.version + '-windows-x64.exe');
  const target = path.join(output, 'installed');
  await run(installer, ['/S', '/currentuser', '/D=' + target]);
  auditUnpacked(target, false);
  const executable = path.join(target, 'MintoAssistant.exe');
  const result = await desktop(executable, path.join(output, 'installer-launch'));
  assert.notEqual(result.dataRoot, path.join(target, 'data'));
  assert.notEqual(result.dataRoot, path.join(root, '_data'));
  fs.writeFileSync(path.join(output, 'installer-launch.json'), JSON.stringify(result, null, 2));
  const uninstaller = path.join(target, 'Uninstall MintoAssistant.exe');
  assert.ok(fs.existsSync(uninstaller));
  await run(uninstaller, ['/S', '/currentuser']);
  // NSIS may finish cleanup through its temporary child after the parent exits.
  const deadline = Date.now() + 30000;
  while (fs.existsSync(target) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(!fs.existsSync(target), 'Test installation directory was not removed');
  return { ...result, installationRemoved: true };
}
async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'release-verification', randomUUID());
  fs.mkdirSync(output, { recursive: true });
  const portable = await verifyPortable(root, output);
  const installed = await verifyInstaller(root, output);
  const result = { output, portable, installed };
  fs.writeFileSync(path.join(output, 'release-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
module.exports = { run, desktop, verifyPortable, verifyInstaller };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
