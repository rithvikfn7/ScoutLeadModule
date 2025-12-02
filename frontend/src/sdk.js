/**
 * FN7 SDK Initialization
 *
 * This implementation provides a local mock of the FN7 SDK that works directly
 * with Firebase. It's used when the CDN version is not accessible.
 *
 * For production, replace this with the actual CDN import:
 * import FN7SDK from 'https://fn7.io/.fn7-sdk/frontend/latest/sdk.esm.js';
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  limit as fsLimit,
  getDocs,
  onSnapshot,
  increment as fsIncrement,
} from 'firebase/firestore';
import { environment } from './config/environment';

// Initialize Firebase
const app = initializeApp(environment.firebase);
const db = getFirestore(app);

// Default tenant prefix for FN7 (org_hkey.application_id)
const DEFAULT_TENANT = '7000000001.1000000001';

/**
 * Get the tenant prefix from localStorage or use default
 */
function getTenantPrefix() {
  try {
    const userContext = localStorage.getItem('user_context');
    if (userContext) {
      const parsed = JSON.parse(userContext);
      const orgHkey = parsed.org_hkey?.split('.')[0] || '7000000001';
      const appId = parsed.application_id || '1000000001';
      return `${orgHkey}.${appId}`;
    }
  } catch (e) {
    console.warn('[SDK] Failed to parse user_context:', e);
  }
  return DEFAULT_TENANT;
}

/**
 * Build the full document path using FN7 tenant structure
 * Format: {tenant_prefix}/{docType}.{docId}
 */
function buildDocPath(docType, docId) {
  const tenant = getTenantPrefix();
  return `${tenant}/${docType}.${docId}`;
}

/**
 * Build the collection path for queries
 * Format: {tenant_prefix}
 */
function getCollectionRef() {
  const tenant = getTenantPrefix();
  return collection(db, tenant);
}

/**
 * Local FN7 SDK Implementation
 */
class LocalFN7SDK {
  constructor(config = {}) {
    this.config = config;
    this.mode = config.mode || 'local';

    // Set up localStorage defaults in local mode
    if (this.mode === 'local') {
      this._setupLocalDefaults();
    }

    console.log('[SDK] Local FN7 SDK initialized (mode:', this.mode, ')');
  }

  _setupLocalDefaults() {
    try {
      if (!localStorage.getItem('user_context')) {
        localStorage.setItem(
          'user_context',
          JSON.stringify({
            user_id: '0513467084',
            org_hkey: '7000000001.0742402695',
            user_role: 'Founder',
            org_role: 'Provider',
            application_id: '1000000001',
            id_token: 'local-dev-token',
          })
        );
      }
      if (!localStorage.getItem('app_context')) {
        localStorage.setItem(
          'app_context',
          JSON.stringify({
            doc_id: '1000000001',
            org_hkey: '7000000001',
            application_url_prefix: 'atlas',
          })
        );
      }
    } catch (e) {
      console.warn('[SDK] Could not set localStorage defaults:', e);
    }
  }

  /**
   * Get a single document from Firebase
   * Searches for a document with matching doc_type and id fields
   */
  async getFirebaseData(docType, docId) {
    const colRef = getCollectionRef();
    
    try {
      // Fetch documents and find the one with matching doc_type and id
      const q = query(colRef, fsLimit(500));
      const snapshot = await getDocs(q);
      
      let result = null;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.doc_type === docType && data.id === docId) {
          result = { id: data.id, ...data };
        }
      });
      
      return result;
    } catch (error) {
      console.error('[SDK] getFirebaseData error:', error);
      throw error;
    }
  }

  /**
   * Create a new document in Firebase
   */
  async createFirebaseData(docType, docId, data) {
    const path = buildDocPath(docType, docId);
    const docRef = doc(db, ...path.split('/'));
    await setDoc(docRef, { ...data, id: docId });
    return { id: docId, ...data };
  }

  /**
   * Update an existing document in Firebase
   */
  async updateFirebaseData(docType, docId, data) {
    const path = buildDocPath(docType, docId);
    const docRef = doc(db, ...path.split('/'));
    await updateDoc(docRef, data);
    const snapshot = await getDoc(docRef);
    return { id: docId, ...snapshot.data() };
  }

  /**
   * Delete a document from Firebase
   */
  async deleteFirebaseData(docType, docId) {
    const path = buildDocPath(docType, docId);
    const docRef = doc(db, ...path.split('/'));
    await deleteDoc(docRef);
    return { success: true };
  }

  /**
   * Search Firebase documents
   * @param {string} docType - Document type to filter by (e.g., 'leadsets')
   * @param {Object} options - Query options
   * @param {Array} options.filters - Array of filter objects { field, op, value }
   * @param {Object} options.orderBy - Order by object { field, direction }
   * @param {number} options.limit - Maximum results
   */
  async searchFirebaseData(docType, options = {}) {
    const { filters = [], orderBy } = options;
    // Ensure limit is a valid positive integer
    const limit = Math.max(1, Math.floor(Number(options.limit) || 500));
    const colRef = getCollectionRef();

    // Fetch all docs and filter by doc_type field (matching backend SDK behavior)
    // This avoids the need for composite indexes
    try {
      // Fetch documents with larger limit to account for filtering
      const q = query(colRef, fsLimit(limit * 3));
      const snapshot = await getDocs(q);

      let results = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // Filter by doc_type field (matches backend SDK behavior)
        if (data.doc_type === docType) {
          results.push({ id: data.id || docSnap.id, ...data });
        }
      });

      // Apply additional filters client-side
      if (filters.length > 0) {
        results = results.filter((item) => {
          return filters.every((filter) => {
            const value = item[filter.field];
            switch (filter.op) {
              case '==':
                return value === filter.value;
              case '!=':
                return value !== filter.value;
              case '>':
                return value > filter.value;
              case '>=':
                return value >= filter.value;
              case '<':
                return value < filter.value;
              case '<=':
                return value <= filter.value;
              case 'array-contains':
                return Array.isArray(value) && value.includes(filter.value);
              default:
                return true;
            }
          });
        });
      }

      // Apply ordering client-side
      if (orderBy && orderBy.field) {
        const field = orderBy.field;
        const direction = orderBy.direction || 'asc';
        results.sort((a, b) => {
          const aVal = a[field];
          const bVal = b[field];
          if (aVal === bVal) return 0;
          if (aVal === undefined || aVal === null) return 1;
          if (bVal === undefined || bVal === null) return -1;
          const comparison = aVal < bVal ? -1 : 1;
          return direction === 'desc' ? -comparison : comparison;
        });
      }

      // Apply limit
      return results.slice(0, limit);
    } catch (error) {
      console.error('[SDK] searchFirebaseData error:', error);
      throw error;
    }
  }

  /**
   * Start a real-time listener on a document
   * Returns an object with a subscribe method (Observable-like)
   */
  startFirebaseListener(docType, docId) {
    const path = buildDocPath(docType, docId);
    const docRef = doc(db, ...path.split('/'));

    return {
      subscribe: (observerOrNext) => {
        const observer =
          typeof observerOrNext === 'function'
            ? { next: observerOrNext, error: console.error }
            : observerOrNext;

        const unsubscribe = onSnapshot(
          docRef,
          (snapshot) => {
            if (snapshot.exists()) {
              observer.next?.({ id: docId, ...snapshot.data() });
            }
          },
          (error) => {
            observer.error?.(error);
          }
        );

        return { unsubscribe };
      },
    };
  }

  /**
   * Get Firestore utilities
   */
  getFirestoreUtilities() {
    return {
      increment: (amount) => fsIncrement(amount),
    };
  }

  // Context helpers
  getUserId() {
    try {
      const ctx = JSON.parse(localStorage.getItem('user_context') || '{}');
      return ctx.user_id;
    } catch {
      return null;
    }
  }

  getUserOrgHkey() {
    try {
      const ctx = JSON.parse(localStorage.getItem('user_context') || '{}');
      return ctx.org_hkey;
    } catch {
      return null;
    }
  }

  getUserRole() {
    try {
      const ctx = JSON.parse(localStorage.getItem('user_context') || '{}');
      return ctx.user_role;
    } catch {
      return null;
    }
  }

  getOrgRole() {
    try {
      const ctx = JSON.parse(localStorage.getItem('user_context') || '{}');
      return ctx.org_role;
    } catch {
      return null;
    }
  }

  applicationId() {
    try {
      const ctx = JSON.parse(localStorage.getItem('app_context') || '{}');
      return ctx.doc_id;
    } catch {
      return null;
    }
  }

  applicationName() {
    try {
      const ctx = JSON.parse(localStorage.getItem('app_context') || '{}');
      return ctx.application_url_prefix;
    } catch {
      return null;
    }
  }

  getApplicationOrgHkey() {
    try {
      const ctx = JSON.parse(localStorage.getItem('app_context') || '{}');
      return ctx.org_hkey;
    } catch {
      return null;
    }
  }

  isBaseApp() {
    return false;
  }
}

// Determine mode
const mode = environment.apiBaseUrl ? 'server' : 'local';

// Create and export SDK instance
const sdk = new LocalFN7SDK({
  mode,
  firebaseConfig: environment.firebase,
  apiBaseUrl: environment.apiBaseUrl,
});

export default sdk;
