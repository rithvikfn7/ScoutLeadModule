/**
 * Local Development Environment Configuration
 * Following the SDK pattern: https://fn7.io/.fn7-sdk/frontend/latest/docs
 *
 * This file is for local development. For Create React App, you can also use
 * .env files with REACT_APP_ prefix, but this pattern allows for better
 * build-time configuration selection.
 *
 * Local Mode: Set apiBaseUrl to undefined to enable local mode.
 * In local mode, the SDK automatically uses hardcoded defaults for
 * user_context and app_context - no manual setup needed!
 */

// Try to parse Firebase config from environment variable if available
let firebaseConfig = null;

if (process.env.REACT_APP_FIREBASE_CONFIG) {
  try {
    firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
  } catch (e) {
    console.warn('Failed to parse REACT_APP_FIREBASE_CONFIG:', e.message);
  }
}

// Fallback to hardcoded config for local development
// Replace these with your actual Firebase config values
if (!firebaseConfig) {
  firebaseConfig = {
    apiKey: 'AIzaSyExample-placeholder',
    authDomain: 'your-project.firebaseapp.com',
    databaseURL: 'https://your-project.firebaseio.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef',
    measurementId: 'G-XXXXXXXXXX',
  };
}

export const environment = {
  firebase: firebaseConfig,
  // Set to 'https://atlas.dev2.app.fn7.io' for dev environment
  // Set to undefined for local mode (no backend auth calls)
  apiBaseUrl: process.env.REACT_APP_API_BASE_URL || undefined,
};
