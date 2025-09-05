import { BMWProvider } from './providers/BMWProvider.js';
import { VWProvider } from './providers/VWProvider.js';
import { WebServer } from './web/server.js';
import winston from 'winston';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure main logger
const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] [MAIN]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'main-downloader.log' })
  ]
});

class CarDownloaderManager {
  constructor() {
    this.providers = new Map();
    this.runningProviders = new Set();
    this.webServer = null;
    this.isWebMode = false;
  }

  async initialize() {
    logger.info('🚀 Car Downloader Manager wird initialisiert...');
    
    // Initialize providers based on environment configuration
    if (process.env.BMW_USERNAME && process.env.BMW_PASSWORD) {
      this.providers.set('bmw', new BMWProvider());
      logger.info('✅ BMW Provider initialisiert');
    }
    
    if (process.env.VW_USERNAME && process.env.VW_PASSWORD) {
      this.providers.set('vw', new VWProvider());
      logger.info('✅ VW Provider initialisiert');
    }
    
    if (this.providers.size === 0) {
      logger.error('❌ Keine Provider konfiguriert! Bitte überprüfen Sie die .env Datei.');
      process.exit(1);
    }
    
    logger.info(`📊 ${this.providers.size} Provider(s) bereit: ${Array.from(this.providers.keys()).join(', ')}`);
  }

  async runProvider(providerName) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      logger.error(`❌ Provider '${providerName}' nicht gefunden!`);
      return false;
    }

    if (this.runningProviders.has(providerName)) {
      logger.warn(`⚠️ Provider '${providerName}' läuft bereits!`);
      return false;
    }

    try {
      this.runningProviders.add(providerName);
      logger.info(`🚀 Starte Provider: ${providerName.toUpperCase()}`);
      
      await provider.run();
      
    } catch (error) {
      logger.error(`❌ Fehler beim Ausführen von Provider '${providerName}': ${error.message}`);
      return false;
    } finally {
      this.runningProviders.delete(providerName);
    }
  }

  async runAllProviders() {
    logger.info('🚀 Starte alle Provider...');
    
    const providerPromises = Array.from(this.providers.keys()).map(providerName => 
      this.runProvider(providerName)
    );
    
    try {
      await Promise.all(providerPromises);
    } catch (error) {
      logger.error(`❌ Fehler beim Ausführen der Provider: ${error.message}`);
    }
  }

  async runSingleCheck(providerName = null) {
    if (providerName) {
      // Run single provider check
      const provider = this.providers.get(providerName);
      if (!provider) {
        logger.error(`❌ Provider '${providerName}' nicht gefunden!`);
        return;
      }
      
      logger.info(`🔍 Führe einmaligen Check für ${providerName.toUpperCase()} durch...`);
      
      try {
        await provider.initialize();
        await provider.checkForUpdates();
        await provider.cleanup();
        logger.info(`✅ Check für ${providerName.toUpperCase()} abgeschlossen`);
      } catch (error) {
        logger.error(`❌ Fehler beim Check von ${providerName.toUpperCase()}: ${error.message}`);
        await provider.cleanup();
      }
    } else {
      // Run all providers once
      logger.info('🔍 Führe einmaligen Check für alle Provider durch...');
      
      for (const [providerName, provider] of this.providers) {
        try {
          logger.info(`🔍 Checke ${providerName.toUpperCase()}...`);
          await provider.initialize();
          await provider.checkForUpdates();
          await provider.cleanup();
          logger.info(`✅ Check für ${providerName.toUpperCase()} abgeschlossen`);
        } catch (error) {
          logger.error(`❌ Fehler beim Check von ${providerName.toUpperCase()}: ${error.message}`);
          await provider.cleanup();
        }
      }
    }
  }

  async cleanup() {
    logger.info('🧹 Bereinige alle Provider...');
    
    for (const [providerName, provider] of this.providers) {
      try {
        await provider.cleanup();
        logger.info(`✅ ${providerName.toUpperCase()} bereinigt`);
      } catch (error) {
        logger.error(`❌ Fehler beim Bereinigen von ${providerName.toUpperCase()}: ${error.message}`);
      }
    }
  }

  getProviderStatus() {
    const status = {};
    for (const [providerName, provider] of this.providers) {
      status[providerName] = {
        running: this.runningProviders.has(providerName),
        lastUpdate: provider.metadata?.lastUpdate || 'Nie',
        downloadCount: Object.keys(provider.metadata?.downloads || {}).length
      };
    }
    return status;
  }

  async startWebServer() {
    if (this.webServer) {
      logger.warn('⚠️ Web Server läuft bereits!');
      return;
    }

    try {
      this.webServer = new WebServer();
      this.webServer.manager = this; // Referenz für API-Calls
      await this.webServer.start();
      this.isWebMode = true;
      logger.info('🌐 Web Server erfolgreich gestartet');
    } catch (error) {
      logger.error(`❌ Fehler beim Starten des Web Servers: ${error.message}`);
      throw error;
    }
  }

  async stopWebServer() {
    if (!this.webServer) {
      logger.warn('⚠️ Web Server läuft nicht!');
      return;
    }

    try {
      // Web Server stoppen (falls eine stop-Methode existiert)
      this.webServer = null;
      this.isWebMode = false;
      logger.info('🛑 Web Server gestoppt');
    } catch (error) {
      logger.error(`❌ Fehler beim Stoppen des Web Servers: ${error.message}`);
    }
  }

  async triggerProviderCheck(providerName) {
    if (!providerName) {
      logger.info('🔍 Starte Check für alle Provider...');
      await this.runSingleCheck();
    } else {
      logger.info(`🔍 Starte Check für Provider: ${providerName.toUpperCase()}`);
      await this.runSingleCheck(providerName);
    }
  }

  async triggerProviderStart(providerName) {
    if (!providerName) {
      logger.info('🚀 Starte alle Provider...');
      await this.runAllProviders();
    } else {
      logger.info(`🚀 Starte Provider: ${providerName.toUpperCase()}`);
      await this.runProvider(providerName);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const provider = args[1];

// Create manager instance
const manager = new CarDownloaderManager();

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  logger.info('\n👋 Beende Car Downloader Manager...');
  await manager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\n👋 Beende Car Downloader Manager...');
  await manager.cleanup();
  process.exit(0);
});

// Main execution
async function main() {
  try {
    await manager.initialize();
    
    switch (command) {
      case 'bmw':
        logger.info('🚗 Starte nur BMW Provider...');
        await manager.runProvider('bmw');
        break;
        
      case 'vw':
        logger.info('🚗 Starte nur VW Provider...');
        await manager.runProvider('vw');
        break;
        
      case 'all':
        logger.info('🚗 Starte alle Provider...');
        await manager.runAllProviders();
        break;
        
      case 'check':
        if (provider && ['bmw', 'vw'].includes(provider)) {
          await manager.runSingleCheck(provider);
        } else {
          await manager.runSingleCheck();
        }
        break;
        
      case 'status':
        const status = manager.getProviderStatus();
        logger.info('📊 Provider Status:');
        for (const [providerName, providerStatus] of Object.entries(status)) {
          logger.info(`  ${providerName.toUpperCase()}: ${providerStatus.running ? '🟢 Läuft' : '🔴 Gestoppt'} | Letzte Aktualisierung: ${providerStatus.lastUpdate} | Downloads: ${providerStatus.downloadCount}`);
        }
        break;
        
      case 'web':
        logger.info('🌐 Starte Web Dashboard...');
        await manager.startWebServer();
        
        // Keep the process running
        logger.info('🔄 Web Dashboard läuft. Drücken Sie Ctrl+C zum Beenden.');
        process.on('SIGINT', async () => {
          logger.info('\n👋 Beende Web Dashboard...');
          await manager.stopWebServer();
          await manager.cleanup();
          process.exit(0);
        });
        break;
        
      default:
        logger.info('📖 Car Downloader Manager - Verwendung:');
        logger.info('  node src/main.js bmw          - Starte nur BMW Provider');
        logger.info('  node src/main.js vw            - Starte nur VW Provider');
        logger.info('  node src/main.js all           - Starte alle Provider');
        logger.info('  node src/main.js check         - Einmaliger Check aller Provider');
        logger.info('  node src/main.js check bmw     - Einmaliger Check nur BMW');
        logger.info('  node src/main.js check vw      - Einmaliger Check nur VW');
        logger.info('  node src/main.js status        - Zeige Provider Status');
        logger.info('  node src/main.js web           - Starte Web Dashboard');
        break;
    }
    
  } catch (error) {
    logger.error(`❌ Kritischer Fehler: ${error.message}`);
    await manager.cleanup();
    process.exit(1);
  }
}

// Start the application
main();
