#!/usr/bin/env node

import dotenv from 'dotenv';
import { EmailService } from './src/utils/EmailService.js';

// Load environment variables
dotenv.config();

async function testEmail() {
    console.log('📧 E-Mail Test Script gestartet...\n');
    
    try {
        // Create email service instance
        const emailService = new EmailService();
        
        // Test connection first
        console.log('🔍 Teste E-Mail-Verbindung...');
        const connectionTest = await emailService.testConnection();
        
        if (!connectionTest.success) {
            console.error('❌ E-Mail-Verbindung fehlgeschlagen:');
            console.error(`   ${connectionTest.message}`);
            console.log('\n📋 Überprüfen Sie Ihre E-Mail-Konfiguration in der .env-Datei:');
            console.log('   - EMAIL_SMTP_HOST');
            console.log('   - EMAIL_SMTP_PORT');
            console.log('   - EMAIL_USER');
            console.log('   - EMAIL_PASS');
            process.exit(1);
        }
        
        console.log('✅ E-Mail-Verbindung erfolgreich!');
        console.log(`   ${connectionTest.message}\n`);
        
        // Create test data
        const testUpdates = [
            {
                displayName: 'ISTA-P Installationsprogramm',
                version: '4.40.20',
                category: 'installer',
                fileSize: 2048576000, // 2 GB
                fileName: 'ISTA-P_4.40.20_Installer.exe'
            },
            {
                displayName: 'ISTA-P Datenarchiv',
                version: '4.40.20',
                category: 'data_archive',
                fileSize: 10737418240, // 10 GB
                fileName: 'ISTA-P_4.40.20_DataArchive.zip'
            },
            {
                displayName: 'ODIS-Service Installation',
                version: '3.0.1',
                category: 'installation',
                fileSize: 524288000, // 500 MB
                fileName: 'ODIS-Service_3.0.1_Installer.exe'
            }
        ];
        
        // Send test email for BMW
        console.log('📤 Sende BMW Test-E-Mail...');
        const bmwResult = await emailService.sendNewVersionNotification('bmw', testUpdates.slice(0, 2));
        
        if (bmwResult) {
            console.log('✅ BMW Test-E-Mail erfolgreich gesendet!');
        } else {
            console.log('❌ BMW Test-E-Mail fehlgeschlagen!');
        }
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Send test email for VW
        console.log('📤 Sende VW Test-E-Mail...');
        const vwResult = await emailService.sendNewVersionNotification('vw', testUpdates.slice(2));
        
        if (vwResult) {
            console.log('✅ VW Test-E-Mail erfolgreich gesendet!');
        } else {
            console.log('❌ VW Test-E-Mail fehlgeschlagen!');
        }
        
        console.log('\n🎉 E-Mail-Test abgeschlossen!');
        console.log('📬 Überprüfen Sie Ihr E-Mail-Postfach: notifier@herstellerdiagnose.eu');
        
    } catch (error) {
        console.error('❌ Fehler beim E-Mail-Test:');
        console.error(`   ${error.message}`);
        console.error('\n🔧 Mögliche Lösungen:');
        console.error('   1. Überprüfen Sie Ihre Internetverbindung');
        console.error('   2. Überprüfen Sie die SMTP-Konfiguration');
        console.error('   3. Überprüfen Sie Benutzername und Passwort');
        console.error('   4. Überprüfen Sie, ob der SMTP-Server erreichbar ist');
        process.exit(1);
    }
}

// Run the test
testEmail();
