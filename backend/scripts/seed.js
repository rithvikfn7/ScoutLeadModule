const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getSDK } = require('../src/sdk');

dotenv.config();

async function main() {
  const sdk = getSDK({ mode: process.env.FN7_SDK_MODE || 'local' });
  // Allow overriding leadsets source file, default to data/leadsets.json
  const leadsetsPath =
    process.env.FN7_LEADSETS_PATH ||
    path.resolve(__dirname, '../../data/leadsets.json');
  const settingsPath = path.resolve(__dirname, '../../data/settings.json');

  const rawLeadsets = JSON.parse(fs.readFileSync(leadsetsPath, 'utf-8'));
  // Support multiple formats:
  //  - an array of leadsets: [ { id, ... }, ... ]
  //  - a collection object: { session_id, lead_sets: [ { doc_id, ... }, ... ], ... }
  //  - new standard format: { leadset_documents: [ ... ] }
  //  - legacy format: { leadsets: [ ... ] }
  let leadsets = Array.isArray(rawLeadsets)
    ? rawLeadsets
    : Array.isArray(rawLeadsets.leadset_documents)
    ? rawLeadsets.leadset_documents
    : Array.isArray(rawLeadsets.lead_sets)
    ? rawLeadsets.lead_sets
    : Array.isArray(rawLeadsets.leadsets)
    ? rawLeadsets.leadsets
    : [];
  
  // Extract sessionId from collection or first leadset document
  const collectionSessionId = rawLeadsets.session_id || rawLeadsets.sessionId || leadsets[0]?.session_id || null;

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

  await Promise.all(
    leadsets.map((leadset) => {
      const id = leadset.id || leadset.doc_id;
      if (!id) {
        throw new Error(
          `Leadset missing id/doc_id field: ${JSON.stringify(leadset)}`
        );
      }
      // Add sessionId to each leadset if available
      const leadsetDoc = {
        ...leadset,
        id,
        sessionId: leadset.sessionId || leadset.session_id || collectionSessionId || null,
      };
      return sdk.createFirebaseData('leadsets', id, leadsetDoc);
    })
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

