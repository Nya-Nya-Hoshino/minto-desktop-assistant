'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const portableOnly = process.argv.includes('--portable-only');

async function run() {
  const { auditConfiguration, auditUnpacked, writeReleaseHashes } = require('./package-audit');
  auditConfiguration(root);
  // Separate builds keep portable.flag out of the installed application.
  if (!portableOnly) {
    await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never' });
    auditUnpacked(path.join(root, 'dist', 'win-unpacked'), false);
  }
  await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['zip'], Arch.x64), publish: 'never', config: {
    // Builder merges array overrides with the base configuration.
    extraFiles: [{ from: 'build/portable.flag', to: 'portable.flag' }]
  } });
  auditUnpacked(path.join(root, 'dist', 'win-unpacked'), true);
  await writeReleaseHashes(root);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
