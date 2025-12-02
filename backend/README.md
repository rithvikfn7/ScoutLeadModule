# FN7 Node.js Backend

Backend server built with FN7 SDK for Node.js, providing Firebase operations with security rules enforcement.

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- Firebase project with service account
- npm or yarn

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

   The `.npmrc` file is already configured to use the FN7 SDK registry for `@fn7` scoped packages.

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Firebase service account JSON:
   ```bash
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   FIREBASE_STORAGE_BUCKET=your-storage-bucket.appspot.com
   ```

3. **Run the server**
   ```bash
   npm run dev
   ```

   The server will start on `http://localhost:3000`

## 📋 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | ✅ Yes | Firebase service account JSON as a string |
| `FIREBASE_STORAGE_BUCKET` | ❌ No | Firebase Storage bucket name (optional) |
| `PORT` | ❌ No | Server port (default: 3000) |

### Local Mode

When `mode: 'local'` is set in the SDK config:
- Makes `authContext` (JWT token) optional in all methods
- Uses hardcoded dev token if no token provided
- No need to extract/pass JWT tokens from request headers
- Faster development iteration

```javascript
// Initialize SDK with local mode
const sdk = new FN7SDK({
  mode: 'local',
  storageBucketName: 'your-bucket'
});

// In your code - authContext is optional!
const data = await sdk.getFirebaseData('Users', 'user123'); // No token needed
```

### Getting Firebase Service Account JSON

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** > **Service Accounts**
4. Click **Generate New Private Key**
5. Copy the entire JSON object and paste it as a single-line string in `.env`

**Important:** Never commit `.env` file to version control!

## 🔧 Usage Examples

### Basic CRUD Operations

```javascript
const { getSDK } = require('./sdk');

const sdk = getSDK({ mode: 'local' });
// In local mode, authContext is optional - SDK uses hardcoded dev token automatically
const authContext = undefined; // Optional in local mode

// Read data
const user = await sdk.getFirebaseData('Users', 'user123', authContext);

// Create data
const newChat = await sdk.createFirebaseData('Chats', 'chat456', {
  message: 'Hello',
  timestamp: Date.now()
}, authContext);

// Update data
const updated = await sdk.updateFirebaseData('Chats', 'chat456', {
  message: 'Updated message'
}, authContext);

// Delete data
await sdk.deleteFirebaseData('Chats', 'chat456', authContext);
```

### Atomic Increments

```javascript
const utils = sdk.getFirestoreUtilities();
const authContext = undefined; // Optional in local mode

await sdk.updateFirebaseData('Users', 'user123', {
  loginCount: utils.increment(1),
  score: utils.increment(10)
}, authContext);
```

### Storage Operations

```javascript
const authContext = undefined; // Optional in local mode

// Upload files
const fileNames = ['image.jpg', 'document.pdf'];
const fileBuffers = [buffer1, buffer2];
const urls = await sdk.uploadToStorage(fileNames, fileBuffers, 'assets', authContext);

// Get download URL
const downloadUrl = await sdk.getFromStorage('assets', 'image.jpg', authContext);

// Get file as Buffer
const fileBuffer = await sdk.getBlobFromStorage('assets', 'document.pdf', authContext);
```

## 📚 API Endpoints

### Health Check
- `GET /health` - Server health status

### Users
- `GET /users/:userId` - Get user data
- `POST /users/:userId` - Create user data
- `PUT /users/:userId` - Update user data
- `DELETE /users/:userId` - Delete user data

### Storage
- `POST /storage/upload` - Upload files to Firebase Storage

## 🔐 Authentication

### Local Mode (for Development)

When SDK is initialized with `mode: 'local'`:
- `authContext` (JWT token) is **optional** in all API endpoints
- SDK automatically uses hardcoded dev token if no token provided
- No need to pass `Authorization` header
- Works immediately out of the box

```javascript
const sdk = new FN7SDK({
  mode: 'local',
  storageBucketName: 'your-bucket'
});
```

### Server Mode (Dev/Prod)

When SDK is initialized with `mode: 'server'`:
- All API endpoints require `authContext` (JWT token)
- Extract from `Authorization` header and pass to SDK methods:
  ```
  Authorization: Bearer <your-jwt-token>
  ```
- The JWT token should contain the following claims:
  - `user_id`
  - `org_hkey`
  - `application_id`
  - Other claims as required by your Firebase security rules

```javascript
const sdk = new FN7SDK({
  mode: 'server',
  storageBucketName: 'your-bucket'
});

// In your endpoint
const authContext = req.headers.authorization?.replace('Bearer ', '');
const data = await sdk.getFirebaseData('Users', 'user123', authContext);
```

## 🛠️ Development

### Scripts

- `npm run dev` - Start development server with hot reload (using Node.js --watch)
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run ESLint

### Project Structure

```
src/
├── index.js          # Main entry point
├── sdk.js            # SDK initialization
├── routes/           # API routes (optional)
├── middleware/       # Custom middleware (optional)
└── utils/           # Utility functions (optional)
```

## 📖 Documentation

- [Main Template README](../README.md) - For complete micro module setup guide
- [FN7 Frontend SDK](../fn7-sdk/frontend-sdk.md) - Frontend SDK documentation
- [FN7 Python SDK](../fn7-sdk/python-sdk.md) - Python SDK documentation

## 🗑️ Don't Need Node.js Backend?

If your micro module doesn't need a Node.js backend, you can safely delete this entire `nodejs-backend/` folder.

