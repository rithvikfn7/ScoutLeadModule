const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getSDK } = require('../src/sdk');

dotenv.config();

async function main() {
  const sdk = getSDK({ mode: process.env.FN7_SDK_MODE || 'local' });
  const leadsetsPath = path.resolve(__dirname, '../../data/leadsets.json');
  const settingsPath = path.resolve(__dirname, '../../data/settings.json');

  const leadsets = JSON.parse(fs.readFileSync(leadsetsPath, 'utf-8'));
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

  await Promise.all(
    leadsets.map((leadset) => sdk.createFirebaseData('leadsets', leadset.id, leadset))
  );
  await sdk.createFirebaseData('settings', settings.id, settings);
  await sdk.createFirebaseData('docStatus', 'status', {
    version: 1,
    lastChange: new Date().toISOString(),
    collections: ['leadsets', 'settings'],
  });

  console.log(`Seeded ${leadsets.length} leadsets and settings document.`);
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});

