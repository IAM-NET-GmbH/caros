import { MetadataManager } from '../utils/MetadataManager.js';
import winston from 'winston';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] [STATUS]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

class StatusReporter {
  constructor() {
    this.baseDir = process.env.DOWNLOAD_DIR || '/mnt/storagebox/providers';
    this.metadataManager = new MetadataManager(this.baseDir);
  }

  async generateReport() {
    logger.info('📊 Generiere Status-Report...');
    
    try {
      const report = await this.metadataManager.generateStatusReport();
      
      console.log('\n' + '='.repeat(80));
      console.log('🚗 CAR DOWNLOADER - STATUS REPORT');
      console.log('='.repeat(80));
      console.log(`📅 Generiert am: ${new Date(report.generatedAt).toLocaleString('de-DE')}`);
      console.log(`🔄 Letzte globale Aktualisierung: ${report.lastGlobalUpdate ? new Date(report.lastGlobalUpdate).toLocaleString('de-DE') : 'Nie'}`);
      console.log(`📊 Anzahl Provider: ${report.totalProviders}`);
      console.log('='.repeat(80));
      
      if (report.totalProviders === 0) {
        console.log('❌ Keine Provider konfiguriert oder aktiv');
        return;
      }
      
      for (const [providerName, providerData] of Object.entries(report.providers)) {
        console.log(`\n🚗 ${providerName.toUpperCase()} PROVIDER`);
        console.log('-'.repeat(40));
        console.log(`📅 Letzte Aktualisierung: ${providerData.lastUpdate ? new Date(providerData.lastUpdate).toLocaleString('de-DE') : 'Nie'}`);
        console.log(`📊 Status: ${providerData.status}`);
        console.log(`📥 Downloads: ${providerData.downloadCount}`);
        console.log(`💾 Gesamtgröße: ${providerData.totalSize}`);
        
        if (providerData.categories.length > 0) {
          console.log(`📂 Kategorien: ${providerData.categories.join(', ')}`);
        }
        
        // Calculate time since last update
        if (providerData.lastUpdate) {
          const lastUpdate = new Date(providerData.lastUpdate);
          const now = new Date();
          const diffHours = Math.floor((now - lastUpdate) / (1000 * 60 * 60));
          const diffDays = Math.floor(diffHours / 24);
          
          if (diffDays > 0) {
            console.log(`⏰ Letzte Aktualisierung: vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`);
          } else if (diffHours > 0) {
            console.log(`⏰ Letzte Aktualisierung: vor ${diffHours} Stunde${diffHours > 1 ? 'n' : ''}`);
          } else {
            console.log(`⏰ Letzte Aktualisierung: vor weniger als einer Stunde`);
          }
        }
      }
      
      console.log('\n' + '='.repeat(80));
      console.log('✅ Status-Report abgeschlossen');
      console.log('='.repeat(80) + '\n');
      
    } catch (error) {
      logger.error(`❌ Fehler beim Generieren des Status-Reports: ${error.message}`);
    }
  }

  async cleanupOldData(daysToKeep = 30) {
    logger.info(`🧹 Bereinige alte Daten (älter als ${daysToKeep} Tage)...`);
    
    try {
      const cleanedCount = await this.metadataManager.cleanupOldMetadata(daysToKeep);
      
      if (cleanedCount > 0) {
        logger.info(`✅ ${cleanedCount} alte Einträge bereinigt`);
      } else {
        logger.info('✅ Keine alten Einträge gefunden');
      }
      
    } catch (error) {
      logger.error(`❌ Fehler beim Bereinigen: ${error.message}`);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const days = parseInt(args[1]) || 30;
  
  const reporter = new StatusReporter();
  
  switch (command) {
    case 'cleanup':
      await reporter.cleanupOldData(days);
      break;
      
    case 'report':
    default:
      await reporter.generateReport();
      break;
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  logger.info('\n👋 Beende Status Reporter...');
  process.exit(0);
});

// Start the application
main();
