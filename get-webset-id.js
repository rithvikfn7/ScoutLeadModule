// Quick script to get websetId from Firebase
const { FN7SDK } = require('@fn7/sdk-node');
require('dotenv').config();

const sdk = new FN7SDK({
  mode: process.env.FN7_SDK_MODE || 'local',
  storageBucketName: process.env.FIREBASE_STORAGE_BUCKET,
});

async function getWebsetId() {
  try {
    // Get all runs
    const allDocs = await sdk.searchFirebaseData({}, 1000);
    const runs = Array.isArray(allDocs) ? allDocs : Object.values(allDocs || {});
    const runDocs = runs.filter(doc => doc.doc_type === 'runs');
    
    console.log('\n=== All Runs with WebsetIds ===\n');
    runDocs.forEach(run => {
      console.log(`Run ID: ${run.id}`);
      console.log(`Leadset ID: ${run.leadsetId}`);
      console.log(`Webset ID: ${run.websetId || 'NOT SET'}`);
      console.log(`Status: ${run.status}`);
      console.log(`Created: ${run.createdAt}`);
      console.log('---\n');
    });
    
    // Get latest run for the beauty leadset
    const beautyRuns = runDocs
      .filter(run => run.leadsetId === 'ls_dtc_us_beauty_cac_ugc11')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
    if (beautyRuns.length > 0) {
      const latestRun = beautyRuns[0];
      console.log('\n=== Latest Run for Beauty Leadset ===\n');
      console.log(`Run ID: ${latestRun.id}`);
      console.log(`Webset ID: ${latestRun.websetId || 'NOT SET'}`);
      console.log(`Status: ${latestRun.status}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getWebsetId();
