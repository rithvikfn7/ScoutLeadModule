# FN7 React Frontend

React frontend application built with FN7 SDK, providing Firebase operations and context helpers.

## 🚀 Quick Start

### Prerequisites

- Node.js 14.0.0 or higher
- npm or yarn
- Firebase project with web app configuration

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Firebase configuration as a JSON string:
   ```bash
   REACT_APP_FIREBASE_CONFIG={"apiKey":"your-api-key","authDomain":"your-project.firebaseapp.com","projectId":"your-project-id","storageBucket":"your-project.appspot.com","messagingSenderId":"123456789","appId":"your-app-id"}

   # Optional: API Base URL (defaults to dev if not provided)
   REACT_APP_API_BASE_URL=https://atlas.dev2.app.fn7.io
   ```

   **Note:**
   - The Firebase config should be a single JSON string containing the complete `firebaseConfig` object from Firebase Console
   - The `REACT_APP_` prefix is required by Create React App to expose environment variables to the browser
   - **Recommended:** Use environment configuration files instead (see Advanced Configuration below)

3. **Run the development server**
   ```bash
   npm start
   ```

   The app will open at `http://localhost:3000`

## 📋 Configuration

### Environment Configuration File

Edit `src/config/environment.js` with your Firebase configuration:

```javascript
export const environment = {
  firebase: {
    apiKey: 'your-api-key',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: 'your-app-id',
  },
  apiBaseUrl: undefined, // Local mode (recommended for development)
};
```

### Getting Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create a new one)
3. Go to **Project Settings** (gear icon)
4. Scroll to **"Your apps"** section
5. Click the web icon (`</>`) to add a web app
6. Copy the `firebaseConfig` object values to your `environment.js` file

### Local Mode vs Server Mode

- **Local Mode** (`mode: 'local'`): No backend calls, automatic defaults, works immediately
- **Server Mode** (`mode: 'server'`): Backend calls enabled, requires authentication and `apiBaseUrl`

## 🔐 Authentication

The Frontend SDK supports two modes:

### Local Mode (Recommended for Development)

When `mode: 'local'` is set in the SDK config, it automatically:
- Skips backend authentication calls
- Uses hardcoded defaults for `user_context` and `app_context`
- Populates `localStorage` with default values (so your app can access them)
- Works immediately out of the box

**Setup:**
```javascript
// src/sdk.js
import FN7SDK from 'https://fn7.io/.fn7-sdk/frontend/latest/sdk.esm.js';
import { environment } from './config/environment';

const sdk = new FN7SDK({
  mode: 'local',  // Enables local mode
  firebaseConfig: environment.firebase
});
```

### Server Mode (Dev/Prod)

When `mode: 'server'` is set, the SDK:
- Requires `localStorage.user_context` and `localStorage.app_context`
- Makes backend calls for authentication
- Full security and custom claims support

**Setup:**
```javascript
// src/sdk.js
import FN7SDK from 'https://fn7.io/.fn7-sdk/frontend/latest/sdk.esm.js';
import { environment } from './config/environment.dev';

const sdk = new FN7SDK({
  mode: 'server',  // Server mode
  firebaseConfig: environment.firebase,
  apiBaseUrl: environment.apiBaseUrl
});

// Set localStorage (typically done by FN7 platform)
localStorage.setItem('user_context', JSON.stringify({
  user_id: 'your-user-id',
  org_hkey: 'your-org-hkey',
  application_id: 'your-app-id'
}));

localStorage.setItem('app_context', JSON.stringify({
  application_id: 'your-app-id',
  org_hkey: 'your-org-hkey'
}));
```

**Recommendation:** Use Local Mode for development, Server Mode for testing with real backend.

## 🔧 Usage Examples

### Basic CRUD Operations

```javascript
import sdk from './sdk';

// Read data
const userData = await sdk.getFirebaseData('Users', 'user123');

// Create data
const newChat = await sdk.createFirebaseData('Chats', 'chat456', {
  message: 'Hello',
  timestamp: new Date().toISOString()
});

// Update data
const updated = await sdk.updateFirebaseData('Chats', 'chat456', {
  message: 'Updated message'
});

// Delete data
await sdk.deleteFirebaseData('Chats', 'chat456');
```

### Real-time Listeners

```javascript
// Start a Firebase listener (returns Observable)
import sdk from './sdk';

const subscription = sdk.startFirebaseListener('Users', 'user123').subscribe({
  next: (data) => {
    console.log('User data updated:', data);
  },
  error: (error) => {
    console.error('Listener error:', error);
  }
});

// Stop listening
subscription.unsubscribe();
```

### Storage Operations

```javascript
// Upload files (takes arrays of filenames and files)
const files = [file1, file2];
const filenames = ['image1.jpg', 'image2.png'];
const urls = await sdk.uploadToStorage(filenames, files, 'assets');

// Get download URL
const downloadUrl = await sdk.getFromStorage('assets', 'image1.jpg');

// Get file as blob
const blob = await sdk.getBlobFromStorage('assets', 'image1.jpg');
```

### Atomic Increments

```javascript
// Get Firestore utilities
const utils = sdk.getFirestoreUtilities();

// Use atomic increment in updates
await sdk.updateFirebaseData('Users', 'user123', {
  loginCount: utils.increment(1),  // Atomically increments by 1
  score: utils.increment(5)        // Atomically increments by 5
});
```

### Context Helpers

```javascript
// Get current user ID
const userId = sdk.getUserId();

// Get user's organization hkey
const orgHkey = sdk.getUserOrgHkey();

// Get user role
const userRole = sdk.getUserRole();

// Get organization role
const orgRole = sdk.getOrgRole();

// Get application ID
const appId = sdk.applicationId();

// Get application name/URL prefix
const appName = sdk.applicationName();

// Get application's organization hkey
const appOrgHkey = sdk.getApplicationOrgHkey();

// Check if base app
const isBase = sdk.isBaseApp();
```

## 🛠️ Development

### Scripts

- `npm start` - Start development server with hot reload
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App (irreversible)

### Project Structure

```
src/
├── index.js          # Application entry point
├── index.css         # Global styles
├── App.js            # Main App component
├── App.css           # App component styles
├── sdk.js            # FN7 SDK initialization
└── components/       # Your React components (optional)
```

## 🎨 UI Guidelines

For FN7 micro modules, please follow these design guidelines:

- **Font**: Use Sora font family (already included in index.css)
- **Theme**: Light theme
- **Colors**: Follow the color palette specified in `UI_CONTEXT.md` in the root directory

## 📦 Building for Production

```bash
npm run build
```

This creates an optimized production build in the `build/` folder.

## 📖 Documentation

- [Main Template README](../README.md) - For complete micro module setup guide
- [FN7 Frontend SDK](../fn7-sdk/frontend-sdk.md) - Complete Frontend SDK documentation with API reference
- [FN7 Python SDK](../fn7-sdk/python-sdk.md) - Python SDK documentation
- [FN7 Node.js Backend](../nodejs-backend/README.md) - Node.js backend documentation

## 🔧 Advanced Configuration

### Environment Configuration Files Pattern

This template follows the SDK's recommended environment configuration pattern. Environment-specific configuration files are provided in `src/config/`:

- `environment.js` - Local development (default, Local Mode enabled)
- `environment.dev.js` - Development environment
- `environment.prod.js` - Production environment

**To use environment-specific configs:**

1. Edit the appropriate environment file (e.g., `environment.js` for local) with your Firebase config
2. Update `src/sdk.js` to import the correct environment file:

```javascript
// For local development (Local Mode - recommended)
import { environment } from './config/environment';

// For development
import { environment } from './config/environment.dev';

// For production
import { environment } from './config/environment.prod';
```

3. Configure your build process to select the appropriate file based on the target environment

**Example environment file structure:**

```javascript
// Local Mode (environment.js)
export const environment = {
  firebase: {
    apiKey: 'your-api-key',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: 'your-app-id',
  },
  apiBaseUrl: undefined, // Not needed in local mode
};

// Server Mode (environment.dev.js or environment.prod.js)
export const environment = {
  firebase: { /* same structure */ },
  apiBaseUrl: 'https://atlas.dev2.app.fn7.io', // Used in server mode
};
```

**SDK Initialization:**

```javascript
// src/sdk.js
import FN7SDK from 'https://fn7.io/.fn7-sdk/frontend/latest/sdk.esm.js';
import { environment } from './config/environment';

// Determine mode based on apiBaseUrl
const mode = environment.apiBaseUrl ? 'server' : 'local';

const sdk = new FN7SDK({
  mode: mode,
  firebaseConfig: environment.firebase,
  apiBaseUrl: environment.apiBaseUrl
});

export default sdk;
```

This pattern is described in detail in the [FN7 SDK Documentation](../fn7-sdk/frontend-sdk.md#environment-configuration).

### Local Development with SDK

For local SDK testing, you can serve the SDK from a local server:

```bash
cd packages/frontend/dist
python3 -m http.server 8082
# or
npx serve -p 8082
```

Then import in your code:

```javascript
const SDK = await import('http://localhost:8082/sdk.esm.js');
```

## 🗑️ Don't Need React Frontend?

**Note:** React frontend is typically required for FN7 micro modules. Only delete this folder if you're building a backend-only module.
