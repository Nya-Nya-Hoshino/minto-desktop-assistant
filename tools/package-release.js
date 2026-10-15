'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const buildOutput=process.env.MINTO_BUILD_OUTPUT||'dist';
const outputConfig={directories:{output:buildOutput}};
const portableOnly = process.argv.includes('--portable-only');

async function run() {
  const protectedData=path.resolve(root,buildOutput,'win-unpacked','data');
  if(fs.existsSync(path.join(protectedData,'settings.json'))||fs.existsSync(path.join(protectedData,'saves','index.json')))
    throw new Error('构建输出目录含日常存档或设置，已停止。请将 MINTO_BUILD_OUTPUT 设为独立的新构建目录，再按完整备份与副本核对流程部署。');
  const { auditConfiguration, auditUnpacked, writeReleaseHashes } = require('./package-audit');
  auditConfiguration(root);
  // Separate builds keep portable.flag out of the installed application.
  if (!portableOnly) {
    await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never',config:outputConfig });
    auditUnpacked(path.resolve(root,buildOutput,'win-unpacked'), false);
  }
  await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['zip'], Arch.x64), publish: 'never', config: {
    ...outputConfig,
    // Builder merges array overrides with the base configuration.
    extraFiles: [{ from: 'build/portable.flag', to: 'portable.flag' }]
  } });
  auditUnpacked(path.resolve(root,buildOutput,'win-unpacked'), true);
  await writeReleaseHashes(root,buildOutput);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
