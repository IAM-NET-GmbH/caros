# E-Mail Test Scripts

Dieses Verzeichnis enthält Scripts zum Testen der E-Mail-Benachrichtigungen.

## Verfügbare Scripts

### 1. Vollständiger E-Mail-Test
```bash
npm run test:email
# oder
node test-email.js
```

**Was passiert:**
- Testet die E-Mail-Verbindung
- Sendet eine BMW Test-E-Mail mit 2 Updates
- Sendet eine VW Test-E-Mail mit 1 Update
- Zeigt detaillierte Informationen an

### 2. Einfacher E-Mail-Test
```bash
npm run send:email
# oder
node send-test-email.js
```

**Was passiert:**
- Testet die E-Mail-Verbindung
- Sendet eine einfache Test-E-Mail
- Minimaler Output

## E-Mail-Konfiguration

Die E-Mail-Einstellungen werden aus der `.env`-Datei gelesen:

```env
EMAIL_ENABLED=true
EMAIL_SMTP_HOST="smtp.ionos.de"
EMAIL_SMTP_PORT=465
EMAIL_SMTP_SECURE=true
EMAIL_USER="notifier@herstellerdiagnose.eu"
EMAIL_PASS="notifier@44225#fileserver"
EMAIL_FROM="notifier@herstellerdiagnose.eu"
EMAIL_TO="notifier@herstellerdiagnose.eu"
```

## Fehlerbehebung

### E-Mail-Verbindung fehlgeschlagen
1. Überprüfen Sie Ihre Internetverbindung
2. Überprüfen Sie die SMTP-Konfiguration in der `.env`-Datei
3. Überprüfen Sie Benutzername und Passwort
4. Überprüfen Sie, ob der SMTP-Server erreichbar ist

### E-Mail wird nicht empfangen
1. Überprüfen Sie den Spam-Ordner
2. Überprüfen Sie die E-Mail-Adresse in `EMAIL_TO`
3. Überprüfen Sie die E-Mail-Adresse in `EMAIL_FROM`

## E-Mail-Inhalt

Die Test-E-Mails enthalten:
- **Betreff**: "🆕 Neue Versionen verfügbar - [PROVIDER] Provider"
- **Inhalt**: Schöne HTML-E-Mail mit:
  - Provider-spezifische Farbkodierung
  - Detaillierte Update-Informationen
  - Version, Dateigröße, Kategorie
  - Download-Status
  - Zeitstempel und Dashboard-Link

## Automatische E-Mail-Benachrichtigungen

E-Mail-Benachrichtigungen werden automatisch gesendet, wenn:
- Neue Versionen von BMW- oder VW-Dateien gefunden werden
- Die Downloads erfolgreich abgeschlossen werden
- `EMAIL_ENABLED=true` in der `.env`-Datei gesetzt ist
