const { build, Platform, Arch } = require('electron-builder');
const { build: base } = require('../package.json');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} for the signed Windows release.`);
  return value;
}

async function run() {
  const azureSignOptions = {
    publisherName: required('WINDOWS_SIGNING_PUBLISHER'),
    endpoint: required('WINDOWS_SIGNING_ENDPOINT'),
    codeSigningAccountName: required('WINDOWS_SIGNING_ACCOUNT'),
    certificateProfileName: required('WINDOWS_SIGNING_PROFILE'),
  };
  await build({
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
    config: { ...base, forceCodeSigning: true, win: { ...base.win, azureSignOptions } },
  });
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
