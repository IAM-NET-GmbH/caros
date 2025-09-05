import { chromium } from 'playwright';
import winston from 'winston';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MetadataManager } from '../utils/MetadataManager.js';
import { EmailService } from '../utils/EmailService.js';

// Load environment variables
dotenv.config();

export class BaseProvider {
  constructor(providerName) {
    this.providerName = providerName;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.baseDownloadDir = process.env.DOWNLOAD_DIR || '/mnt/storagebox/providers';
    this.downloadDir = path.join(this.baseDownloadDir, providerName);
    this.isLoggedIn = false;
    this.metadata = {};
    this.metadataManager = new MetadataManager(this.baseDownloadDir);
    this.emailService = new EmailService();
    
    // Configure logger
    this.logger = winston.createLogger({
      level: process.env.DEBUG === 'true' ? 'debug' : 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level.toUpperCase()}] [${providerName.toUpperCase()}]: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: `${providerName}-downloader.log` })
      ]
    });
  }

  async initialize() {
    this.logger.info(`🚀 ${this.providerName.toUpperCase()} Provider wird initialisiert...`);
    this.logger.info(`📁 Download-Verzeichnis: ${this.downloadDir}`);
    
    // Create download directory
    await fs.mkdir(this.downloadDir, { recursive: true });
    
    // Load metadata
    await this.loadMetadata();
    
    // Launch browser
    await this.launchBrowser();
  }

  async launchBrowser() {
    this.logger.info('🌐 Starte Browser...');
    
    this.browser = await chromium.launch({
      headless: process.env.HEADLESS === 'true',
      args: ['--disable-blink-features=AutomationControlled']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE',
      acceptDownloads: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    this.page = await this.context.newPage();
    
    // Log console messages for debugging
    if (process.env.DEBUG === 'true') {
      this.page.on('console', msg => {
        if (msg.type() === 'error') {
          this.logger.debug(`Browser Console Error: ${msg.text()}`);
        }
      });
    }
  }

  async loadMetadata() {
    try {
      const metadataPath = path.join(this.downloadDir, `${this.providerName}_metadata.json`);
      const data = await fs.readFile(metadataPath, 'utf-8');
      this.metadata = JSON.parse(data);
      this.logger.debug(`${this.providerName} Metadata geladen`);
    } catch (error) {
      this.logger.debug(`Keine ${this.providerName} Metadata gefunden, starte mit leerem State`);
      this.metadata = {
        lastUpdate: null,
        downloads: {}
      };
    }
    
    // Also load global metadata
    const globalMetadata = await this.metadataManager.loadGlobalMetadata();
    if (globalMetadata.providers[this.providerName]) {
      this.logger.debug(`Global metadata für ${this.providerName} geladen`);
    }
  }

  async updateMetadata(category, data) {
    // Ensure downloads object exists
    if (!this.metadata.downloads) {
      this.metadata.downloads = {};
    }
    
    this.metadata.downloads[category] = data;
    this.metadata.lastUpdate = new Date().toISOString();
    const metadataPath = path.join(this.downloadDir, `${this.providerName}_metadata.json`);
    await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2));
    
    // Also update global metadata
    await this.metadataManager.updateProviderMetadata(this.providerName, this.metadata);
    
    this.logger.debug(`${this.providerName} Metadata aktualisiert für ${category}`);
  }

  async updateLastCheck() {
    // Update lastUpdate timestamp even if no new downloads were found
    this.metadata.lastUpdate = new Date().toISOString();
    const metadataPath = path.join(this.downloadDir, `${this.providerName}_metadata.json`);
    await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2));
    
    // Also update global metadata
    await this.metadataManager.updateProviderMetadata(this.providerName, this.metadata);
    
    this.logger.debug(`${this.providerName} Last check timestamp aktualisiert`);
  }

  async cleanupOldVersions(category, newFileName) {
    try {
      // Check if there's an existing file for this category
      if (this.metadata.downloads && this.metadata.downloads[category]) {
        const existingDownload = this.metadata.downloads[category];
        const existingFileName = existingDownload.fileName;
        
        // Only cleanup if the filename is different (new version)
        if (existingFileName && existingFileName !== newFileName) {
          const existingFilePath = path.join(this.downloadDir, existingFileName);
          
          try {
            // Check if the old file exists
            await fs.access(existingFilePath);
            
            // Remove the old file
            await fs.unlink(existingFilePath);
            this.logger.info(`🗑️ Alte Version entfernt: ${existingFileName}`);
            
            // Update metadata to remove the old file reference
            delete this.metadata.downloads[category];
            const metadataPath = path.join(this.downloadDir, `${this.providerName}_metadata.json`);
            await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2));
            
            // Also update global metadata
            await this.metadataManager.updateProviderMetadata(this.providerName, this.metadata);
            
          } catch (error) {
            // File doesn't exist or couldn't be deleted - that's okay
            this.logger.debug(`Alte Datei ${existingFileName} existiert nicht oder konnte nicht gelöscht werden: ${error.message}`);
          }
        }
      }
      
      // Also check for similar files in the directory that might be old versions
      await this.cleanupSimilarFiles(category, newFileName);
      
    } catch (error) {
      this.logger.warn(`Fehler beim Aufräumen alter Versionen für ${category}: ${error.message}`);
    }
  }

  async cleanupSimilarFiles(category, newFileName) {
    try {
      // Get the base name without version and extension for comparison
      const newBaseName = this.getBaseFileName(newFileName);
      const newExtension = path.extname(newFileName);
      
      // Read all files in the download directory
      const files = await fs.readdir(this.downloadDir);
      
      for (const file of files) {
        // Skip JSON metadata files and the new file itself
        if (file.endsWith('.json') || file === newFileName) {
          continue;
        }
        
        const fileBaseName = this.getBaseFileName(file);
        const fileExtension = path.extname(file);
        
        // Check if this file has the same base name and extension as the new file
        if (fileBaseName === newBaseName && fileExtension === newExtension) {
          const filePath = path.join(this.downloadDir, file);
          
          try {
            // Remove the similar file
            await fs.unlink(filePath);
            this.logger.info(`🗑️ Ähnliche alte Datei entfernt: ${file}`);
          } catch (error) {
            this.logger.debug(`Ähnliche Datei ${file} konnte nicht gelöscht werden: ${error.message}`);
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Fehler beim Aufräumen ähnlicher Dateien: ${error.message}`);
    }
  }

  getBaseFileName(fileName) {
    // Remove version numbers and common patterns to get base name
    let baseName = path.basename(fileName, path.extname(fileName));
    
    // Remove common version patterns
    baseName = baseName.replace(/_\d+\.\d+\.\d+.*$/, ''); // Remove _3.74.0.930 patterns
    baseName = baseName.replace(/_\d{4}-\d{2}-\d{2}.*$/, ''); // Remove _2025-02-03 patterns
    baseName = baseName.replace(/_\d+-\d+-\d+.*$/, ''); // Remove _25_1_0 patterns
    baseName = baseName.replace(/_\d+\.\d+.*$/, ''); // Remove _3.0.12 patterns
    
    return baseName;
  }

  async downloadFile(download) {
    this.logger.info(`⬇️ Lade herunter: ${download.displayName}`);
    this.logger.debug(`   URL: ${download.url}`);
    
    try {
      // Extract clean filename first
      let fileName = this.extractCleanFilename(download.url);
      this.logger.debug(`   Extracted filename: ${fileName}`);
      
      if (!fileName || fileName === 'download' || fileName.length < 5) {
        const version = download.version !== 'unknown' ? `_${download.version}` : '';
        const extension = this.getFileExtension(download.url);
        fileName = `${download.category}${version}${extension}`;
        this.logger.debug(`   Generated fallback filename: ${fileName}`);
      }
      
      // Clean up old versions before downloading new one
      await this.cleanupOldVersions(download.category, fileName);
      
      // Set up file path
      const filePath = path.join(this.downloadDir, fileName);
      
      // Use axios for direct download (more reliable)
      this.logger.debug(`   Starte Download mit axios...`);
      try {
        const axios = (await import('axios')).default;
        
        // Get cookies from the browser context
        const cookies = await this.context.cookies();
        const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        
        this.logger.debug(`   Cookies extrahiert: ${cookies.length} Cookies`);
        
        // Download with axios
        const response = await axios({
          method: 'GET',
          url: download.url,
          responseType: 'stream',
          headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/octet-stream,application/zip,application/x-msdownload,*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          timeout: 300000 // 5 minutes
        });
        
        this.logger.debug(`   HTTP Response erhalten: ${response.status} ${response.statusText}`);
        
        // Create write stream
        const writer = createWriteStream(filePath);
        response.data.pipe(writer);
        
        // Wait for download to complete
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        this.logger.debug(`   Download-Stream abgeschlossen`);
        
        // Verify file
        const stats = await fs.stat(filePath);
        if (stats.size > 0) {
          this.logger.info(`✅ Download abgeschlossen: ${fileName} (${this.formatFileSize(stats.size)})`);
          
          // Update metadata
          await this.updateMetadata(download.category, {
            ...download,
            fileName,
            filePath,
            fileSize: stats.size,
            downloadedAt: new Date().toISOString()
          });
          
          return true;
        } else {
          throw new Error('Downloaded file is empty');
        }
        
      } catch (error) {
        this.logger.error(`❌ Download fehlgeschlagen: ${error.message}`);
        
        // Try to delete partial file
        try {
          await fs.unlink(filePath);
        } catch (e) {
          // Ignore deletion errors
        }
        
        return false;
      }
      
    } catch (error) {
      this.logger.error(`❌ Download fehlgeschlagen: ${error.message}`);
      return false;
    }
  }

  extractCleanFilename(url) {
    try {
      // Check if this is a redirect URL or direct URL
      let finalUrl = url;
      
      // Extract filename from URL
      const urlParts = url.split('/');
      let filename = urlParts[urlParts.length - 1];
      
      this.logger.debug(`   Original filename: ${filename}`);
      
      // Remove query parameters (everything after ?)
      if (filename.includes('?')) {
        filename = filename.split('?')[0];
        this.logger.debug(`   After removing query params: ${filename}`);
      }
      
      // Remove URL encoding
      filename = decodeURIComponent(filename);
      this.logger.debug(`   After URL decoding: ${filename}`);
      
      // Additional cleanup: remove any remaining query parameters or unwanted suffixes
      if (filename.includes('&signed=true')) {
        filename = filename.replace('&signed=true', '');
        this.logger.debug(`   After removing &signed=true: ${filename}`);
      }
      
      // Validate filename
      if (filename && filename.length > 0 && filename !== 'download') {
        this.logger.debug(`   Final clean filename: ${filename}`);
        return filename;
      }
      
      this.logger.debug(`   Invalid filename, returning null`);
      return null;
    } catch (error) {
      this.logger.debug(`Fehler beim Extrahieren des Dateinamens: ${error.message}`);
      return null;
    }
  }

  getFileExtension(url) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('.exe')) return '.exe';
    if (urlLower.includes('.zip')) return '.zip';
    if (urlLower.includes('.istapdata')) return '.istapdata';
    return '.bin'; // Default extension
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return parseFloat(gb.toFixed(2)) + ' GB';
  }

  extractVersion(url) {
    const patterns = [
      /(\d+\.\d+\.\d+\.\d+)/,  // 3.74.0.930
      /(\d+\.\d+\.\d+)/,        // 4.53.30
      /(\d+-\d+-\d+)/,          // 04-25-10
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'unknown';
  }

  isNewVersion(category, version) {
    const lastVersion = this.metadata.downloads?.[category]?.version;
    
    if (!lastVersion) {
      return true; // No previous version, download it
    }

    if (version === 'unknown') {
      return false; // Can't compare unknown versions
    }

    return version !== lastVersion;
  }

  async sendNewVersionNotification(updates) {
    if (!updates || updates.length === 0) {
      return;
    }

    try {
      this.logger.info(`📧 Sende E-Mail-Benachrichtigung für ${updates.length} neue Version(en)`);
      const success = await this.emailService.sendNewVersionNotification(this.providerName, updates);
      
      if (success) {
        this.logger.info('✅ E-Mail-Benachrichtigung erfolgreich gesendet');
      } else {
        this.logger.warn('⚠️ E-Mail-Benachrichtigung konnte nicht gesendet werden');
      }
    } catch (error) {
      this.logger.error('❌ Fehler beim Senden der E-Mail-Benachrichtigung:', error);
    }
  }

  async sendLoginFailureNotification(errorMessage) {
    try {
      this.logger.info(`📧 Sende Login-Fehler E-Mail-Benachrichtigung für ${this.providerName.toUpperCase()}`);
      const success = await this.emailService.sendLoginFailureNotification(this.providerName, errorMessage);
      
      if (success) {
        this.logger.info('✅ Login-Fehler E-Mail-Benachrichtigung erfolgreich gesendet');
      } else {
        this.logger.warn('⚠️ Login-Fehler E-Mail-Benachrichtigung konnte nicht gesendet werden');
      }
    } catch (error) {
      this.logger.error('❌ Fehler beim Senden der Login-Fehler E-Mail-Benachrichtigung:', error);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.logger.info('🔒 Browser geschlossen');
    }
  }

  // Abstract methods to be implemented by subclasses
  async login() {
    throw new Error('login() method must be implemented by subclass');
  }

  async findDownloads() {
    throw new Error('findDownloads() method must be implemented by subclass');
  }

  async checkForUpdates() {
    throw new Error('checkForUpdates() method must be implemented by subclass');
  }
}
