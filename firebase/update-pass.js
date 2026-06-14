import admin from 'firebase-admin';
import fs from 'fs';

// Membaca file JSON di ES Module lebih aman menggunakan 'fs'
const serviceAccount = JSON.parse(fs.readFileSync('./firebase-service-account.json', 'utf8'));
const newPasswords = JSON.parse(fs.readFileSync('./new_passwords.json', 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

async function updatePasswordsBatch() {
    for (const user of newPasswords) {
        try {
            await admin.auth().updateUser(user.uid, {
                password: user.newPassword
            });
            console.log(`Berhasil update password untuk UID: ${user.uid}`);
        } catch (error) {
            console.error(`Gagal update UID ${user.uid}:`, error.message);
        }
    }
}

updatePasswordsBatch();