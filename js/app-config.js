const fallbackFirebaseConfig = {
  apiKey: "AIzaSyD6aFkE8CEYA7ACXlF--BMV7XLkfi4fvWI",
  authDomain: "simple-ujian.firebaseapp.com",
  projectId: "simple-ujian",
  storageBucket: "simple-ujian.firebasestorage.app",
  messagingSenderId: "133707273043",
  appId: "1:133707273043:web:213433c1b1016f721587a6",
};

export const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    fallbackFirebaseConfig.authDomain,
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID ||
    fallbackFirebaseConfig.projectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    fallbackFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
};

export const roles = {
  admin: "admin",
  siswa: "siswa",
};

export const STORAGE_KEYS = {
  examAttempt: "simpleUjian:attempt",
  timer: "simpleUjian:timer",
};
