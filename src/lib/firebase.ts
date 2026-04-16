import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use the named database if provided, otherwise fallback to default
const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
console.log('Using Firestore Database ID:', dbId);

// Initialize Firestore with robust settings
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, dbId);

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Test connection to Firestore and handle offline state
async function testConnection() {
  try {
    const { doc, getDocFromServer, clearIndexedDbPersistence } = await import('firebase/firestore');
    
    // Attempt to reach the server
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log('Firestore connection: ONLINE');
  } catch (error: any) {
    console.warn('Firestore initial connection test result:', error.message);
    if (error.message?.includes('the client is offline')) {
      console.error('Firestore is OFFLINE. Attempting to clear persistence...');
      const { clearIndexedDbPersistence } = await import('firebase/firestore');
      await clearIndexedDbPersistence(db);
      window.location.reload(); // Reload to try fresh
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
