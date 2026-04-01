const admin = require('firebase-admin');

// We first try to initialize using Vercel environment variables (secure deployment strategy)
// If those aren't available, we look for a local service_account.json
try {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    // Vercel handles multiline strings differently, we ensure newlines are parsed correctly
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
    console.log('Firebase Admin initialized successfully via environment variables.');
  } else {
    // Fall back to local file
    try {
      const serviceAccount = require('../../service_account.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized successfully via local JSON file.');
    } catch(e) {
      console.warn('FCM Setup Warning: No Vercel environment variables or service_account.json found. Firebase Admin not initialized.');
    }
  }
} catch(err) {
  console.error("Firebase admin init error:", err);
}

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!admin.apps.length || !fcmToken) return;

  const message = {
    notification: { title, body },
    data,
    token: fcmToken
  };

  try {
    await admin.messaging().send(message);
    console.log(`Push notification sent to token: ${fcmToken.slice(0, 10)}...`);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

module.exports = {
  sendPushNotification,
  admin
};
