import { EmailService } from './src/utils/EmailService.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testLoginFailureEmail() {
    console.log('📧 Teste Login-Fehler E-Mail-Benachrichtigung...\n');
    
    try {
        const emailService = new EmailService();
        
        // Test connection
        const connectionTest = await emailService.testConnection();
        if (!connectionTest.success) {
            console.error('❌ E-Mail-Verbindung fehlgeschlagen:', connectionTest.message);
            process.exit(1);
        }
        
        console.log('✅ E-Mail-Verbindung OK');
        
        // Test BMW login failure
        console.log('\n🔴 Teste BMW Login-Fehler E-Mail...');
        const bmwResult = await emailService.sendLoginFailureNotification('bmw', 'Login verification failed - URL: https://auth.bmwgroup.com/auth/XUI/?realm=/internetb2x&goto=...');
        
        if (bmwResult) {
            console.log('✅ BMW Login-Fehler E-Mail erfolgreich gesendet!');
        } else {
            console.log('❌ BMW Login-Fehler E-Mail fehlgeschlagen!');
        }
        
        // Wait a bit between emails
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test VW login failure
        console.log('\n🔴 Teste VW Login-Fehler E-Mail...');
        const vwResult = await emailService.sendLoginFailureNotification('vw', 'Login verification failed - No "Angemeldet als" and "iamneteu" text found after 10 attempts. URL: https://volkswagen.erwin-store.com/erwin/showHome.do');
        
        if (vwResult) {
            console.log('✅ VW Login-Fehler E-Mail erfolgreich gesendet!');
        } else {
            console.log('❌ VW Login-Fehler E-Mail fehlgeschlagen!');
        }
        
        console.log('\n📬 Überprüfen Sie: notifier@herstellerdiagnose.eu');
        console.log('✅ Login-Fehler E-Mail-Test abgeschlossen!');
        
    } catch (error) {
        console.error('❌ Fehler:', error.message);
        process.exit(1);
    }
}

testLoginFailureEmail();
