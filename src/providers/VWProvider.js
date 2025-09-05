import { BaseProvider } from '../base/BaseProvider.js';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';

export class VWProvider extends BaseProvider {
  constructor() {
    super('vw');
    
    // Parse file filters from environment
    this.downloadFilter = process.env.VW_DOWNLOAD_FILTER ? 
      process.env.VW_DOWNLOAD_FILTER.split(',').map(f => f.trim()) : [];
    
    // Define download categories for VW/ODIS
    this.downloadCategories = {
      'odis_service': {
        'installation': 'ODIS-Service Installation',
        'update': 'ODIS-Service Update'
      },
      'fmc': {
        'installer': 'FMC-Installer'
      }
    };
  }

  async checkLoginStatus() {
    if (!this.page) {
      return false;
    }
    
    try {
      const loginCheckResult = await this.page.evaluate(() => {
        const pageText = document.body.innerText || document.body.textContent || '';
        
        // Look for both "Angemeldet als" and "iamneteu" strings
        const hasAngemeldetAls = pageText.includes('Angemeldet als');
        const hasIamneteu = pageText.includes('iamneteu');
        
        // Also check in the specific form-like div
        const formLikeDiv = document.querySelector('div.form-like');
        let foundInForm = false;
        
        if (formLikeDiv) {
          const formText = formLikeDiv.innerText || formLikeDiv.textContent || '';
          foundInForm = formText.includes('Angemeldet als') && formText.includes('iamneteu');
        }
        
        const success = (hasAngemeldetAls && hasIamneteu) || foundInForm;
        
        return {
          success,
          hasAngemeldetAls,
          hasIamneteu,
          foundInForm,
          hasFormLikeDiv: !!formLikeDiv,
          currentUrl: window.location.href
        };
      });
      
      this.logger.debug(`Login-Status Check: ${JSON.stringify(loginCheckResult)}`);
      return loginCheckResult.success;
    } catch (error) {
      this.logger.debug(`Fehler beim Login-Status Check: ${error.message}`);
      return false;
    }
  }

  async login() {
    if (this.isLoggedIn) {
      this.logger.info('✅ Bereits eingeloggt');
      return true;
    }

    this.logger.info('🔐 Logge bei VW ein...');
    
    try {
      // Navigate to VW auth page
      await this.page.goto(process.env.VW_AUTH_URL, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for login form - VW might use different selectors
      await this.page.waitForSelector('input[name="username"], input[name="user"], input[type="text"]', { timeout: 10000 });
      
      // Fill credentials
      await this.page.fill('input[name="username"], input[name="user"], input[type="text"]', process.env.VW_USERNAME);
      await this.page.fill('input[name="password"], input[type="password"]', process.env.VW_PASSWORD);
      
      // Click login button
      this.logger.debug('Klicke Login-Button...');
      await this.page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Anmelden")');
      this.logger.debug('Login-Button geklickt');
      
      // Wait for login to process and check for success indicators
      this.logger.debug('Warte auf Login-Verarbeitung...');
      
      // Try multiple approaches to detect successful login
      let loginSuccess = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!loginSuccess && attempts < maxAttempts) {
        attempts++;
        this.logger.debug(`Login-Check Versuch ${attempts}/${maxAttempts}`);
        
        // Wait a bit between attempts
        await this.page.waitForTimeout(2000);
        
        // Check for login success
        loginSuccess = await this.checkLoginStatus();
        
        if (loginSuccess) {
          this.logger.debug('Login erfolgreich erkannt!');
          break;
        } else {
          // Debug: Show current page content snippet
          const pageContent = await this.page.evaluate(() => {
            const body = document.body;
            if (body) {
              const text = body.innerText || body.textContent || '';
              return text.substring(0, 500) + (text.length > 500 ? '...' : '');
            }
            return 'No body content';
          });
          this.logger.debug(`Aktuelle Seite (Ausschnitt): ${pageContent}`);
        }
        
        // Also try to wait for URL change (non-blocking)
        try {
          await this.page.waitForURL('**/erwin**', { timeout: 1000 });
          this.logger.debug('URL-Änderung erkannt, prüfe erneut...');
        } catch (error) {
          // URL change timeout is expected, continue
        }
      }
      
      if (loginSuccess) {
        this.isLoggedIn = true;
        this.logger.info('✅ Login erfolgreich! (Angemeldet als + iamneteu gefunden)');
        return true;
      } else {
        // Fallback: Check URL as before
        const currentUrl = this.page.url();
        this.logger.warn(`Login-Verifikation fehlgeschlagen nach ${attempts} Versuchen. URL: ${currentUrl}`);
        
        if (currentUrl.includes('erwin') || currentUrl.includes('volkswagen')) {
          this.isLoggedIn = true;
          this.logger.info('✅ Login erfolgreich! (URL-basierte Verifikation)');
          return true;
        } else {
          throw new Error(`Login verification failed - No "Angemeldet als" and "iamneteu" text found after ${attempts} attempts. URL: ${currentUrl}`);
        }
      }
      
    } catch (error) {
      this.logger.error(`❌ Login fehlgeschlagen: ${error.message}`);
      return false;
    }
  }

  async navigateToDownloads() {
    this.logger.info('🧭 Navigiere zu VW Downloads...');
    
    try {
      // Navigate to download page
      await this.page.goto(process.env.VW_DOWNLOAD_URL, {
        waitUntil: 'networkidle',
        timeout: 60000
      });
      
      // Wait for the page to load
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(3000);
      
      // Verify we're still logged in after navigation
      const stillLoggedIn = await this.checkLoginStatus();
      
      if (!stillLoggedIn) {
        this.logger.warn('⚠️ Login-Status nach Navigation verloren, versuche erneut einzuloggen...');
        this.isLoggedIn = false;
        const loginSuccess = await this.login();
        if (!loginSuccess) {
          throw new Error('Re-login nach Navigation fehlgeschlagen');
        }
      }
      
      const currentUrl = this.page.url();
      this.logger.info(`✅ Erfolgreich zu VW Downloads navigiert: ${currentUrl}`);
      
      return true;
    } catch (error) {
      this.logger.error(`❌ Navigation zu VW Downloads fehlgeschlagen: ${error.message}`);
      return false;
    }
  }

  async findDownloads() {
    this.logger.info('🔍 Suche nach VW Downloads...');
    
    try {
      // Wait for the page to be fully loaded
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
      
      // Execute JavaScript to find all download links with better filename extraction
      const downloads = await this.page.evaluate(() => {
        const foundDownloads = [];
        
        // Function to search for downloads in a document
        function searchForDownloads(doc) {
          // Find all links that might be downloads
          const links = doc.querySelectorAll('a[href]');
          
          links.forEach(link => {
            const href = link.href;
            const text = link.textContent.trim();
            
            // Skip PDF files completely
            if (href.toLowerCase().includes('.pdf') || text.toLowerCase().includes('.pdf')) {
              return;
            }
            
            // Check if this looks like a download link for VW/ODIS
            if (href && (href.includes('download') || href.includes('odis') || href.includes('fmc') || 
                        href.includes('software') || href.includes('update') || href.includes('installer') ||
                        href.includes('DownloadODIS') || href.includes('DownloadFMC')) && text) {
              // Try to extract the actual filename from the text or surrounding elements
              let actualFilename = text;
              
              // Look for filename in the link's parent elements
              let parent = link.parentElement;
              while (parent && parent !== document.body) {
                const parentText = parent.textContent || '';
                
                // Look for patterns like "filename.zip (size)" or "filename.zip"
                const filenameMatch = parentText.match(/([A-Za-z0-9_\-\.]+\.(zip|exe|bin|istapdata))\s*\([^)]*\)/i);
                if (filenameMatch) {
                  actualFilename = filenameMatch[1];
                  break;
                }
                
                // Look for just the filename without size
                const simpleFilenameMatch = parentText.match(/([A-Za-z0-9_\-\.]+\.(zip|exe|bin|istapdata))/i);
                if (simpleFilenameMatch && simpleFilenameMatch[1].length > 5) {
                  actualFilename = simpleFilenameMatch[1];
                  break;
                }
                
                parent = parent.parentElement;
              }
              
              foundDownloads.push({
                title: text,
                url: href,
                actualFilename: actualFilename,
                method: 'link_search_main'
              });
            }
          });
          
          // Also look for buttons that might trigger downloads
          const buttons = doc.querySelectorAll('button, [role="button"]');
          buttons.forEach(button => {
            const text = button.textContent.trim();
            const onclick = button.getAttribute('onclick');
            
            if (text && (onclick?.includes('download') || text.toLowerCase().includes('download'))) {
              foundDownloads.push({
                title: text,
                url: onclick || '#',
                actualFilename: text,
                method: 'button_search_main'
              });
            }
          });
        }
        
        // Search in main document
        searchForDownloads(document);
        
        return { downloads: foundDownloads };
      });
      
      const foundDownloads = downloads.downloads;
      
      this.logger.debug(`Gefundene Downloads (roh): ${foundDownloads.length}`);
      foundDownloads.forEach((download, index) => {
        this.logger.debug(`  ${index + 1}. "${download.title}" -> ${download.url} [${download.method}]`);
        if (download.actualFilename) {
          this.logger.debug(`     -> Dateiname: ${download.actualFilename}`);
        }
      });
      
      // Special debug for FMC links
      const fmcLinks = foundDownloads.filter(d => 
        d.url.includes('fmc') || d.title.includes('FMC') || d.title.includes('fmc')
      );
      if (fmcLinks.length > 0) {
        this.logger.debug(`🔍 FMC-Links gefunden: ${fmcLinks.length}`);
        fmcLinks.forEach((link, index) => {
          this.logger.debug(`  FMC${index + 1}. "${link.title}" -> ${link.url}`);
        });
      } else {
        this.logger.debug(`❌ Keine FMC-Links gefunden`);
      }
      
      // Categorize downloads
      const categorizedDownloads = this.categorizeDownloads(foundDownloads);
      
      this.logger.info(`✅ ${Object.keys(categorizedDownloads).length} Downloads kategorisiert`);
      
      return categorizedDownloads;
      
    } catch (error) {
      this.logger.error(`❌ Fehler beim Suchen der Downloads: ${error.message}`);
      return {};
    }
  }

  categorizeDownloads(downloads) {
    const categorized = {};
    
    this.logger.debug(`Kategorisiere VW Downloads...`);
    this.logger.debug(`Verwende Filter: ${this.downloadFilter.join(', ')}`);
    
    for (const download of downloads) {
      const title = download.title.toLowerCase();
      const url = download.url.toLowerCase();
      let category = null;
      let appType = null;
      
      this.logger.debug(`Prüfe Download: "${download.title}" -> ${download.url}`);
      
      // Check if this download matches any of the configured filters
      const matchesFilter = this.downloadFilter.some(filterText => {
        const filterLower = filterText.toLowerCase();
        return title.includes(filterLower) || download.title.includes(filterText);
      });
      
      if (!matchesFilter) {
        this.logger.debug(`❌ Download entspricht nicht dem Filter: ${download.title}`);
        continue;
      }
      
      // VW/ODIS categorization - improved matching
      if ((title.includes('odis-service') || title.includes('odis_service')) && 
          (title.includes('installation') || title.includes('install'))) {
        appType = 'odis_service';
        category = 'installation';
      }
      else if ((title.includes('odis-service') || title.includes('odis_service')) && 
               (title.includes('update') || title.includes('update'))) {
        appType = 'odis_service';
        category = 'update';
      }
      else if ((title.includes('fmc') || title.includes('flashmediacreator') || title.includes('flashmedia') || 
                title.includes('FMC-Installer')) && 
               (title.includes('installer') || title.includes('install') || title.includes('download') || 
                title.includes('FMC-Installer'))) {
        appType = 'fmc';
        category = 'installer';
      }
      
      if (category && appType && !categorized[category]) {
        categorized[category] = {
          ...download,
          category,
          appType,
          displayName: this.downloadCategories[appType][category],
          version: this.extractVersion(download.url, download.actualFilename || download.title),
          originalFilename: download.actualFilename || download.title
        };
        
        this.logger.debug(`✅ Kategorisiert: ${download.title} -> ${category} (Dateiname: ${download.actualFilename || download.title}, Version: ${categorized[category].version})`);
      } else if (!category) {
        this.logger.debug(`❌ Unkategorisiert: ${download.title} (${download.url})`);
      } else if (categorized[category]) {
        this.logger.debug(`❌ Kategorie bereits besetzt: ${category} für ${download.title}`);
      }
    }
    
    return categorized;
  }

  async downloadFile(download) {
    this.logger.info(`⬇️ Lade herunter: ${download.displayName}`);
    this.logger.debug(`   URL: ${download.url}`);
    
    try {
      // Use the original filename if available, otherwise extract from URL
      let fileName = download.originalFilename;
      
      if (!fileName || fileName === 'download' || fileName.length < 5) {
        fileName = this.extractCleanFilename(download.url);
        this.logger.debug(`   Extracted filename from URL: ${fileName}`);
      } else {
        this.logger.debug(`   Using original filename: ${fileName}`);
      }
      
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

  extractVersion(url, filename = '') {
    // First try to extract from filename if provided
    if (filename) {
      this.logger.debug(`Versuche Version aus Dateiname zu extrahieren: "${filename}"`);
      
      // Pattern for VW/ODIS versions like 25_1_0_20250820 or 25_1_0-EU_20250820
      const filenamePatterns = [
        /(\d+_\d+_\d+[A-Z-]*_\d{8})/,  // 25_1_0_20250820 or 25_1_0-EU_20250820
        /(\d+_\d+_\d+_\d{8})/,         // 25_1_0_20250820 (fallback)
        /(\d+\.\d+\.\d+\.\d+)/,         // 3.74.0.930
        /(\d+\.\d+\.\d+)/,               // 4.53.30
        /(\d+-\d+-\d+)/,                 // 04-25-10
        /(\d{4}-\d{2}-\d{2})/,           // 2025-02-03
      ];

      for (let i = 0; i < filenamePatterns.length; i++) {
        const pattern = filenamePatterns[i];
        const match = filename.match(pattern);
        if (match) {
          this.logger.debug(`Version aus Dateiname extrahiert: ${match[1]} aus ${filename} (Pattern ${i + 1})`);
          return match[1];
        }
      }
      
      this.logger.debug(`Kein Pattern passt für Dateiname: "${filename}"`);
    }

    // Fallback to URL patterns
    const urlPatterns = [
      /(\d+\.\d+\.\d+\.\d+)/,  // 3.74.0.930
      /(\d+\.\d+\.\d+)/,        // 4.53.30
      /(\d+-\d+-\d+)/,          // 04-25-10
    ];

    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        this.logger.debug(`Version aus URL extrahiert: ${match[1]} aus ${url}`);
        return match[1];
      }
    }

    this.logger.debug(`Keine Version gefunden in URL: ${url} oder Dateiname: ${filename}`);
    return 'unknown';
  }

  async checkForUpdates() {
    this.logger.info('🔍 Prüfe auf VW Updates...');
    
    // Always verify login status, even if we think we're logged in
    const loginStatus = await this.checkLoginStatus();
    if (!loginStatus || !this.isLoggedIn) {
      this.logger.info('🔐 Login-Status überprüfen...');
      const loginSuccess = await this.login();
      if (!loginSuccess) {
        this.logger.error('❌ Login fehlgeschlagen, überspringe Update-Check');
        return;
      }
    }

    // Navigate to downloads
    const navigationSuccess = await this.navigateToDownloads();
    if (!navigationSuccess) {
      this.logger.error('❌ Navigation zu VW Downloads fehlgeschlagen, überspringe Update-Check');
      return;
    }

    // Find downloads
    const downloads = await this.findDownloads();
    
    // Check which downloads are new
    const updates = [];
    for (const [category, download] of Object.entries(downloads)) {
      if (this.isNewVersion(category, download.version)) {
        updates.push(download);
        this.logger.info(`🆕 Neue Version gefunden: ${download.displayName} (${download.version})`);
      } else {
        this.logger.info(`✅ Aktuelle Version bereits vorhanden: ${download.displayName} (${download.version})`);
      }
    }

    // Initialize counters
    let successCount = 0;
    let failCount = 0;

    // Download updates
    if (updates.length > 0) {
      this.logger.info(`📥 ${updates.length} VW Updates werden heruntergeladen...`);
      
      for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        this.logger.info(`📥 Download ${i + 1}/${updates.length}: ${update.displayName}`);
        
        try {
          const success = await this.downloadFile(update);
          if (success) {
            successCount++;
          } else {
            failCount++;
          }
          
          // Add delay between downloads
          if (i < updates.length - 1) {
            this.logger.info('⏳ Warte 3 Sekunden vor dem nächsten Download...');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
        } catch (error) {
          this.logger.error(`❌ Fehler beim Download von ${update.displayName}: ${error.message}`);
          failCount++;
        }
      }
      
      this.logger.info(`📊 VW Download-Statistik: ${successCount} erfolgreich, ${failCount} fehlgeschlagen`);
      
    } else {
      this.logger.info(`✅ Keine VW Updates verfügbar`);
    }

    // Update last check timestamp even if no new downloads were found
    await this.updateLastCheck();

    return { successCount, failCount };
  }

  async run() {
    try {
      await this.initialize();
      
      // Get check interval from environment (default: 6 hours)
      const checkIntervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS) || 6;
      const checkIntervalMs = checkIntervalHours * 60 * 60 * 1000;
      
      this.logger.info(`🔄 VW Downloader läuft im Dauerbetrieb`);
      this.logger.info(`📁 Downloads werden in ${this.downloadDir} gespeichert`);
      this.logger.info(`⏰ Update-Checks alle ${checkIntervalHours} Stunden (${checkIntervalMs / 1000 / 60} Minuten)`);
      
      // Run initial check
      this.logger.info('🚀 Führe ersten VW Update-Check durch...');
      await this.checkForUpdates();
      
      // Set up continuous operation
      while (true) {
        this.logger.info(`⏳ Warte ${checkIntervalHours} Stunden bis zum nächsten VW Update-Check...`);
        
        // Wait for the specified interval
        await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
        
        this.logger.info('🔄 Führe regelmäßigen VW Update-Check durch...');
        
        try {
          // Restart browser to prevent memory leaks
          this.logger.info('🔄 Starte Browser neu...');
          await this.cleanup();
          await this.launchBrowser();
          
          // Reset login status after browser restart
          this.isLoggedIn = false;
          
          await this.checkForUpdates();
        } catch (error) {
          this.logger.error(`❌ Fehler beim VW Update-Check: ${error.message}`);
          this.logger.info('🔄 Versuche es beim nächsten Intervall erneut...');
          
          // Ensure browser is cleaned up even if there's an error
          try {
            await this.cleanup();
          } catch (cleanupError) {
            this.logger.error(`❌ Fehler beim Aufräumen: ${cleanupError.message}`);
          }
        }
      }
      
    } catch (error) {
      this.logger.error(`❌ Kritischer Fehler: ${error.message}`);
      await this.cleanup();
      process.exit(1);
    }
  }
}
