#!/usr/bin/env node

import dotenv from 'dotenv';
import { EmailService } from './src/utils/EmailService.js';

// Load environment variables
dotenv.config();

async function sendTestEmail() {
    console.log('📧 Sende Test-E-Mail...\n');
    
    try {
        const emailService = new EmailService();
        
        // Test connection
        const connectionTest = await emailService.testConnection();
        if (!connectionTest.success) {
            console.error('❌ E-Mail-Verbindung fehlgeschlagen:', connectionTest.message);
            process.exit(1);
        }
        
        console.log('✅ E-Mail-Verbindung OK');
        
        // Create simple test data
        const testUpdates = [{
            displayName: 'Test Update',
            version: '1.0.0',
            category: 'test',
            fileSize: 1024000,
            fileName: 'test-file.exe'
        }];
        
        // Send test email
        const result = await emailService.sendNewVersionNotification('test', testUpdates);
        
        if (result) {
            console.log('✅ Test-E-Mail erfolgreich gesendet!');
            console.log('📬 Überprüfen Sie: notifier@herstellerdiagnose.eu');
        } else {
            console.log('❌ Test-E-Mail fehlgeschlagen!');
        }
        
    } catch (error) {
        console.error('❌ Fehler:', error.message);
        process.exit(1);
    }
}

sendTestEmail();
