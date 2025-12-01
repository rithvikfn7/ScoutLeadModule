/**
 * Seed Buyer Items for PLG SaaS (analytics) — poor trial→paid leadset
 * 
 * This script uses Firebase Admin SDK to seed buyer items.
 * 
 * Run with: node scripts/seedBuyerItems.js
 * 
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON env var in backend/.env
 */

const path = require('path');

// Load dotenv from backend folder
try {
  require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
    path: path.join(__dirname, '..', 'backend', '.env'),
  });
} catch (e) {
  console.warn('Could not load dotenv:', e.message);
}

const admin = require(path.join(__dirname, '..', 'backend', 'node_modules', 'firebase-admin'));

// Try to initialize Firebase Admin
let db;
try {
  // Try service account JSON from env
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use default credentials file
    admin.initializeApp();
  } else {
    // Try to use the frontend's Firebase config for emulator/local testing
    console.log('⚠️  No Firebase credentials found. Using emulator mode...');
    admin.initializeApp({
      projectId: 'scout-leadsets-local',
    });
  }
  db = admin.firestore();
} catch (error) {
  console.error('❌ Failed to initialize Firebase:', error.message);
  console.log('\nTo fix this, set one of:');
  console.log('  - FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
  console.log('  - GOOGLE_APPLICATION_CREDENTIALS environment variable');
  process.exit(1);
}

const LEADSET_ID = 'ls_saas_plg_analytics_trial_to_paid';
const TENANT_PREFIX = '7000000001.1000000001';

// Sample buyer items for PLG SaaS analytics companies struggling with trial-to-paid conversion
const BUYER_ITEMS = [
  {
    entity: {
      company: 'Metricly',
      domain: 'metricly.io',
    },
    platform: 'Twitter',
    snippet: 'Our trial-to-paid is stuck at 4%. We\'ve tried email sequences, in-app guides, nothing moves the needle. Anyone here cracked PLG onboarding for analytics tools?',
    recency: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    score: 92,
    sourceUrl: 'https://twitter.com/metriclyio/status/12345',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['churn_risk_complaint', 'help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'Help seeking', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'DataPulse',
      domain: 'datapulse.com',
    },
    platform: 'LinkedIn',
    snippet: 'Honest question for PLG founders: How do you identify which trial users are actually evaluating vs just tire-kicking? Our analytics dashboard is complex and we lose 80% before they see value.',
    recency: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    score: 88,
    sourceUrl: 'https://linkedin.com/posts/datapulse-12345',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question', 'social_proof_seek'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'Help seeking', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'InsightFlow',
      domain: 'insightflow.ai',
    },
    platform: 'Reddit',
    snippet: 'We\'re a Series A analytics platform. Trialists drop off at the "connect data source" step. Thinking about using AI agents to guide users through setup. Anyone tried this approach?',
    recency: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    score: 95,
    sourceUrl: 'https://reddit.com/r/SaaS/comments/abc123',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question', 'churn_risk_complaint'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'AI interest', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'ChartHero',
      domain: 'charthero.io',
    },
    platform: 'Twitter',
    snippet: 'Hot take: Most PLG analytics tools fail because they expect users to know what questions to ask. We need better audience research before building features. Who\'s doing this well?',
    recency: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    score: 78,
    sourceUrl: 'https://twitter.com/charthero/status/67890',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['social_proof_seek', 'help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Audience research need', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'RevMetrics',
      domain: 'revmetrics.co',
    },
    platform: 'Slack Community',
    snippet: 'Our PLG motion is struggling. Trial users love the product in demos but churn before activation. Looking for someone who\'s solved the "aha moment" problem for complex analytics.',
    recency: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    score: 90,
    sourceUrl: 'https://slack.com/revops-community',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['churn_risk_complaint', 'help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'Help seeking', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'Amplitude Competitor',
      domain: 'trackify.dev',
    },
    platform: 'Hacker News',
    snippet: 'Show HN: We built a simpler Amplitude alternative. Problem is, "simpler" still means 20+ steps to first insight. How do other analytics tools handle onboarding complexity?',
    recency: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    score: 85,
    sourceUrl: 'https://news.ycombinator.com/item?id=12345',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question', 'comparison_language'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Onboarding issue', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'GrowthLens',
      domain: 'growthlens.io',
    },
    platform: 'Twitter',
    snippet: 'Unpopular opinion: PLG doesn\'t work for analytics tools without significant hand-holding. Our trial-to-paid jumped from 3% to 12% after adding concierge onboarding. But that doesn\'t scale.',
    recency: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    score: 82,
    sourceUrl: 'https://twitter.com/growthlens/status/11111',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['social_proof_seek', 'churn_risk_complaint'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'Funnel.ai',
      domain: 'funnel-ai.com',
    },
    platform: 'LinkedIn',
    snippet: 'Looking for beta testers: We\'re building an AI copilot for analytics onboarding. It watches user behavior and proactively suggests next steps. Would love feedback from other PLG founders.',
    recency: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    score: 75,
    sourceUrl: 'https://linkedin.com/posts/funnelai-67890',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['social_proof_seek'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'AI interest', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'SegmentHQ',
      domain: 'segmenthq.io',
    },
    platform: 'Reddit',
    snippet: 'Our analytics tool has a 14-day trial. Data shows 70% of users who don\'t connect a data source in day 1 never come back. Any strategies for reducing time-to-value?',
    recency: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    score: 91,
    sourceUrl: 'https://reddit.com/r/startups/comments/xyz789',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question', 'churn_risk_complaint'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'Help seeking', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'Dashbird',
      domain: 'dashbird.io',
    },
    platform: 'Twitter',
    snippet: 'We\'ve A/B tested 15 different onboarding flows. Best performer: personalized dashboard templates based on industry. Still only 8% trial-to-paid. What am I missing?',
    recency: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    score: 87,
    sourceUrl: 'https://twitter.com/dashbird/status/22222',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question', 'social_proof_seek'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'KPIStack',
      domain: 'kpistack.com',
    },
    platform: 'Slack Community',
    snippet: 'Anyone using AI agents for GTM? We\'re exploring automated lead qualification based on product usage signals. Current process is too manual and we\'re missing hot leads.',
    recency: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
    score: 79,
    sourceUrl: 'https://slack.com/productled-community',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'AI interest', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'Mixboard',
      domain: 'mixboard.co',
    },
    platform: 'LinkedIn',
    snippet: 'Controversial take: The PLG playbook from Slack/Notion doesn\'t work for analytics. Our users need guidance, not self-serve. Considering adding sales-assist to our motion.',
    recency: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    score: 73,
    sourceUrl: 'https://linkedin.com/posts/mixboard-33333',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['churn_risk_complaint'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'GTM challenge', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'Statsig Clone',
      domain: 'abmetrics.io',
    },
    platform: 'Hacker News',
    snippet: 'Ask HN: How do you onboard technical users to complex analytics tools? Our docs are great but trial users still get stuck. Thinking about interactive tutorials.',
    recency: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
    score: 84,
    sourceUrl: 'https://news.ycombinator.com/item?id=67890',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Onboarding issue', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'PipelineIQ',
      domain: 'pipelineiq.ai',
    },
    platform: 'Twitter',
    snippet: 'We finally cracked 15% trial-to-paid! Secret: We stopped showing the full product. New users see a simplified "quick start" mode first. Happy to share learnings.',
    recency: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    score: 70,
    sourceUrl: 'https://twitter.com/pipelineiq/status/44444',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['social_proof_seek'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Success story', satisfied: 'yes' },
    ],
  },
  {
    entity: {
      company: 'EventTrack',
      domain: 'eventtrack.dev',
    },
    platform: 'Reddit',
    snippet: 'Series A analytics startup here. We\'re hemorrhaging trial users. Considering building an AI agent that auto-generates insights from connected data. Is this the future of PLG?',
    recency: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    score: 93,
    sourceUrl: 'https://reddit.com/r/SaaS/comments/def456',
    matches: {
      segment: ['SaaS PLG (analytics)'],
      intent: ['churn_risk_complaint', 'help_seeking_question'],
    },
    evaluations: [
      { criterion: 'PLG company', satisfied: 'yes' },
      { criterion: 'Trial conversion issue', satisfied: 'yes' },
      { criterion: 'AI interest', satisfied: 'yes' },
    ],
  },
];

async function seedBuyerItems() {
  console.log('🌱 Seeding buyer items for PLG SaaS analytics leadset...\n');
  
  const runId = `run_seed_${Date.now()}`;
  
  // Build document paths using FN7 tenant structure
  const buildDocPath = (docType, docId) => `${TENANT_PREFIX}/${docType}.${docId}`;
  
  try {
    // Create run document
    console.log(`📋 Creating run: ${runId}`);
    const runDoc = {
      id: runId,
      leadsetId: LEADSET_ID,
      websetId: `exa_webset_seed_${Date.now()}`,
      status: 'completed',
      counters: {
        found: BUYER_ITEMS.length,
        enriched: 0,
        selected: 0,
        analyzed: BUYER_ITEMS.length,
      },
      cost: { estimate: 0, spent: 0 },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      createdBy: 'seed-script',
    };
    
    await db.doc(buildDocPath('leadsetRuns', runId)).set(runDoc);
    
    // Create buyer items
    console.log(`📦 Creating ${BUYER_ITEMS.length} buyer items...\n`);
    
    const batch = db.batch();
    
    for (let i = 0; i < BUYER_ITEMS.length; i++) {
      const item = BUYER_ITEMS[i];
      const itemId = `${runId}_item_${i + 1}`;
      
      const itemDoc = {
        ...item,
        id: itemId,
        itemId,
        runId,
        leadsetId: LEADSET_ID,
        enrichment: { status: 'none' },
        createdAt: new Date().toISOString(),
      };
      
      batch.set(db.doc(buildDocPath('leadsetRunItems', itemId)), itemDoc);
      console.log(`  ✅ ${item.entity.company} (${item.entity.domain})`);
    }
    
    await batch.commit();
    
    // Update leadset with lastRunId
    console.log(`\n🔄 Updating leadset with lastRunId...`);
    await db.doc(buildDocPath('leadsets', LEADSET_ID)).update({
      lastRunId: runId,
      status: 'idle',
    });
    
    // Update docStatus to trigger frontend refresh
    console.log(`📡 Triggering frontend refresh...`);
    await db.doc(buildDocPath('docStatus', 'status')).set({
      version: Date.now(),
      lastChange: new Date().toISOString(),
      collections: ['leadsets', 'leadsetRuns', 'leadsetRunItems'],
      leadsetId: LEADSET_ID,
      runId,
    }, { merge: true });
    
    console.log(`\n✨ Done! Seeded ${BUYER_ITEMS.length} buyer items for "${LEADSET_ID}"`);
    console.log(`\n🌐 Refresh the frontend to see the data.`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

seedBuyerItems();
