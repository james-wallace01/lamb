const admin = require('firebase-admin');

let initialized = false;

const parseServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const trimmed = raw.trim();
    try {
      if (trimmed.startsWith('{')) return JSON.parse(trimmed);
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (err) {
      throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON (expected JSON or base64 JSON)');
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
};

const initFirebaseAdmin = () => {
  if (initialized) return admin;

  try {
    const serviceAccount = parseServiceAccount();

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      console.log('[firebase] initialized with service account');
      return admin;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      initialized = true;
      console.log('[firebase] initialized with application default credentials');
      return admin;
    }

    console.log('[firebase] not configured (no credentials provided)');
    return null;
  } catch (err) {
    console.error('[firebase] init failed:', err.message);
    return null;
  }
};

const firebaseEnabled = () => initialized;

const requireFirebaseAuth = async (req, res, next) => {
  if (!initialized) {
    return res.status(503).json({ error: 'Firebase is not configured on this server' });
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match ? match[1] : null;

  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid Firebase ID token' });
  }
};

module.exports = {
  initFirebaseAdmin,
  firebaseEnabled,
  requireFirebaseAuth,
};
