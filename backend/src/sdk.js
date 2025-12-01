/**
 * SDK Initialization
 * Creates a singleton instance of FN7SDK for reuse across the application
 *
 * SDK Modes:
 * - 'local': Local development mode - authContext (JWT token) is optional
 * - 'server': Production mode - authContext (JWT token) required
 */

const { FN7SDK } = require('@fn7/sdk-node');

// Singleton pattern - create SDK instance once and reuse it
let sdkInstance = null;

/**
 * Get or create the FN7 SDK instance
 * @param {Object} [options] - Optional configuration overrides
 * @param {string} [options.mode] - SDK mode ('local' or 'server'), defaults to 'local'
 * @param {string} [options.storageBucketName] - Storage bucket name (overrides env var)
 * @returns {FN7SDK} FN7SDK instance
 */
function getSDK(options = {}) {
  if (!sdkInstance) {
    // Check if required environment variable is set
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. ' +
        'Please set it in your .env file or environment variables.'
      );
    }

    // Determine mode - default to 'local' for development
    const mode = options.mode || 'local';
    const storageBucketName = options.storageBucketName || process.env.FIREBASE_STORAGE_BUCKET;

    // Initialize SDK with unified config object
    sdkInstance = new FN7SDK({
      mode: mode,
      storageBucketName: storageBucketName
    });

    console.log(`✅ FN7 SDK initialized successfully (mode: ${mode})`);
  }

  return sdkInstance;
}

/**
 * Reset SDK instance (useful for testing)
 */
function resetSDK() {
  sdkInstance = null;
}

module.exports = { getSDK, resetSDK };

