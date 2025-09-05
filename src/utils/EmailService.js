import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

export class EmailService {
  constructor() {
    this.enabled = process.env.EMAIL_ENABLED === 'true';
    this.transporter = null;
    
    if (this.enabled) {
      this.setupTransporter();
    }
  }

  setupTransporter() {
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: parseInt(process.env.EMAIL_SMTP_PORT) || 465,
        secure: process.env.EMAIL_SMTP_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      console.log('📧 E-Mail-Service konfiguriert');
    } catch (error) {
      console.error('❌ E-Mail-Service Konfiguration fehlgeschlagen:', error);
      this.enabled = false;
    }
  }

  async sendNewVersionNotification(provider, updates) {
    if (!this.enabled || !this.transporter) {
      console.log('📧 E-Mail-Benachrichtigungen deaktiviert');
      return false;
    }

    try {
      const subject = `🆕 Neue Versionen verfügbar - ${provider.toUpperCase()} Provider`;
      const html = this.generateEmailHTML(provider, updates);

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: subject,
        html: html,
        attachments: this.getLogoAttachment()
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ E-Mail-Benachrichtigung gesendet:', result.messageId);
      return true;
    } catch (error) {
      console.error('❌ E-Mail-Versand fehlgeschlagen:', error);
      return false;
    }
  }

  async sendLoginFailureNotification(provider, errorMessage) {
    if (!this.enabled || !this.transporter) {
      console.log('📧 E-Mail-Benachrichtigungen deaktiviert');
      return false;
    }

    try {
      const subject = `❌ Login-Fehler - ${provider.toUpperCase()} Provider`;
      const html = this.generateLoginFailureHTML(provider, errorMessage);

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: subject,
        html: html,
        attachments: this.getLogoAttachment()
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Login-Fehler E-Mail gesendet:', result.messageId);
      return true;
    } catch (error) {
      console.error('❌ Login-Fehler E-Mail-Versand fehlgeschlagen:', error);
      return false;
    }
  }

  generateEmailHTML(provider, updates) {
    const providerName = provider.toUpperCase();
    const updateCount = updates.length;
    const currentDate = new Date().toLocaleString('de-DE');
    
    return `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Neue Versionen verfügbar - ${providerName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8f9fa;
            margin: 0;
            padding: 20px;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header img {
            max-width: 200px;
            height: auto;
            margin-bottom: 15px;
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 2rem;
        }
        .header p {
            margin: 0;
            opacity: 0.9;
            font-size: 1.1rem;
        }
        .content {
            padding: 30px;
        }
        .summary {
            background: #e8f5e8;
            border-left: 4px solid #28a745;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 0 8px 8px 0;
        }
        .summary h2 {
            margin: 0 0 10px 0;
            color: #155724;
            font-size: 1.3rem;
        }
        .summary p {
            margin: 0;
            color: #155724;
        }
        .updates-list {
            margin-bottom: 30px;
        }
        .update-item {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.3s ease;
        }
        .update-item:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .update-item h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.2rem;
        }
        .update-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }
        .detail-item {
            background: white;
            padding: 10px;
            border-radius: 5px;
            border-left: 3px solid #3498db;
        }
        .detail-label {
            font-weight: bold;
            color: #495057;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .detail-value {
            color: #2c3e50;
            margin-top: 5px;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #6c757d;
            font-size: 0.9rem;
            border-top: 1px solid #dee2e6;
        }
        .footer a {
            color: #3498db;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .badge {
            display: inline-block;
            padding: 4px 8px;
            background: #28a745;
            color: white;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .provider-badge {
            background: ${provider === 'bmw' ? '#e74c3c' : '#f39c12'};
        }
        @media (max-width: 600px) {
            .update-details {
                grid-template-columns: 1fr;
            }
            .header h1 {
                font-size: 1.5rem;
            }
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="cid:logo" alt="IAM-NET GmbH Logo" />
            <p>Neue Versionen verfügbar - ${providerName} Provider</p>
        </div>
        
        <div class="content">
            <div class="summary">
                <h2>📊 Update-Zusammenfassung</h2>
                <p><span class="badge provider-badge">${providerName}</span> Es wurden <strong>${updateCount}</strong> neue Version${updateCount > 1 ? 'en' : ''} gefunden und heruntergeladen.</p>
            </div>
            
            <div class="updates-list">
                <h2 style="color: #2c3e50; margin-bottom: 20px;">🆕 Verfügbare Updates</h2>
                ${updates.map(update => `
                    <div class="update-item">
                        <h3>${update.displayName || update.category}</h3>
                        <div class="update-details">
                            <div class="detail-item">
                                <div class="detail-label">Version</div>
                                <div class="detail-value">${update.version || 'Unbekannt'}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Dateigröße</div>
                                <div class="detail-value">${update.fileSize ? this.formatFileSize(update.fileSize) : 'Unbekannt'}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Kategorie</div>
                                <div class="detail-value">${update.category || 'Unbekannt'}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Download-Status</div>
                                <div class="detail-value">✅ Erfolgreich</div>
                            </div>
                        </div>
                        ${update.fileName ? `
                            <div style="margin-top: 15px; padding: 10px; background: #e8f5e8; border-radius: 5px; border-left: 3px solid #28a745;">
                                <strong>📁 Dateiname:</strong> ${update.fileName}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="footer">
            <p>Diese Benachrichtigung wurde automatisch vom IAM-NET GmbH Fileserver generiert.</p>
            <p>Zeitstempel: ${currentDate}</p>
            <p><a href="${process.env.BASE_URL || 'http://localhost:3000'}">Web Dashboard öffnen</a></p>
        </div>
    </div>
</body>
</html>
    `;
  }

  generateLoginFailureHTML(provider, errorMessage) {
    const providerName = provider.toUpperCase();
    const currentDate = new Date().toLocaleString('de-DE');
    
    return `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login-Fehler - ${providerName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8f9fa;
            margin: 0;
            padding: 20px;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header img {
            max-width: 200px;
            height: auto;
            margin-bottom: 15px;
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 2rem;
        }
        .header p {
            margin: 0;
            opacity: 0.9;
            font-size: 1.1rem;
        }
        .content {
            padding: 30px;
        }
        .error-summary {
            background: #f8d7da;
            border-left: 4px solid #dc3545;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 0 8px 8px 0;
        }
        .error-summary h2 {
            margin: 0 0 10px 0;
            color: #721c24;
            font-size: 1.3rem;
        }
        .error-summary p {
            margin: 0;
            color: #721c24;
        }
        .error-details {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .error-details h3 {
            margin: 0 0 15px 0;
            color: #2c3e50;
            font-size: 1.2rem;
        }
        .error-message {
            background: white;
            padding: 15px;
            border-radius: 5px;
            border-left: 3px solid #dc3545;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            color: #721c24;
            word-break: break-word;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #6c757d;
            font-size: 0.9rem;
            border-top: 1px solid #dee2e6;
        }
        .footer a {
            color: #3498db;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .badge {
            display: inline-block;
            padding: 4px 8px;
            background: #dc3545;
            color: white;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .provider-badge {
            background: ${provider === 'bmw' ? '#e74c3c' : '#f39c12'};
        }
        @media (max-width: 600px) {
            .header h1 {
                font-size: 1.5rem;
            }
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="cid:logo" alt="IAM-NET GmbH Logo" />
            <p>${providerName} Provider - Authentifizierung fehlgeschlagen</p>
        </div>
        
        <div class="content">
            <div class="error-summary">
                <h2>🚨 Kritischer Fehler</h2>
                <p><span class="badge provider-badge">${providerName}</span> Der Login-Prozess für den ${providerName} Provider ist fehlgeschlagen. Möglicherweise ist das Passwort abgelaufen oder die Anmeldedaten sind ungültig.</p>
            </div>
            
            <div class="error-details">
                <h3>🔍 Fehlerdetails</h3>
                <div class="error-message">
                    ${errorMessage || 'Unbekannter Fehler beim Login-Prozess'}
                </div>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #856404;">⚠️ Erforderliche Maßnahmen</h3>
                <ul style="margin: 0; color: #856404;">
                    <li>Überprüfen Sie die Anmeldedaten in der .env-Datei</li>
                    <li>Stellen Sie sicher, dass das Passwort nicht abgelaufen ist</li>
                    <li>Testen Sie die Anmeldung manuell im Browser</li>
                    <li>Kontaktieren Sie den Provider-Support falls nötig</li>
                </ul>
            </div>
        </div>
        
        <div class="footer">
            <p>Diese Benachrichtigung wurde automatisch vom IAM-NET GmbH Fileserver generiert.</p>
            <p>Zeitstempel: ${currentDate}</p>
            <p><a href="${process.env.BASE_URL || 'http://localhost:3000'}">Web Dashboard öffnen</a></p>
        </div>
    </div>
</body>
</html>
    `;
  }

  getLogoAttachment() {
    try {
      const logoPath = path.join(process.cwd(), 'logo.jpg');
      if (fs.existsSync(logoPath)) {
        return [{
          filename: 'logo.jpg',
          path: logoPath,
          cid: 'logo'
        }];
      } else {
        console.warn('⚠️ Logo-Datei nicht gefunden:', logoPath);
        return [];
      }
    } catch (error) {
      console.warn('⚠️ Fehler beim Laden des Logos:', error.message);
      return [];
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async testConnection() {
    if (!this.enabled || !this.transporter) {
      return { success: false, message: 'E-Mail-Service deaktiviert' };
    }

    try {
      await this.transporter.verify();
      return { success: true, message: 'E-Mail-Verbindung erfolgreich' };
    } catch (error) {
      return { success: false, message: `E-Mail-Verbindung fehlgeschlagen: ${error.message}` };
    }
  }
}
