import { BaseProvider } from '../base/BaseProvider.js';

export class BMWProvider extends BaseProvider {
  constructor() {
    super('bmw');
    
    // Parse file filters from environment
    this.istaPFilter = process.env.BMW_ISTA_P_FILTER ? 
      process.env.BMW_ISTA_P_FILTER.split(',').map(f => f.trim()) : [];
    this.istaNextFilter = process.env.BMW_ISTA_NEXT_FILTER ? 
      process.env.BMW_ISTA_NEXT_FILTER.split(',').map(f => f.trim()) : [];
    
    // Define download categories for both ISTA-P and ISTA-Next
    this.downloadCategories = {
      'ista-p': {
        'installer': 'Installationsprogramm ISTA/P',
        'data_archive': 'Datenarchiv ISTA/P'
      },
      'ista-next': {
        'client': 'Installationsdatei ISTA Client',
        'programming_data': 'ISTA Programmierdaten',
        'icom_firmware': 'ICOM Next Firmware',
        'ptd_driver': 'BMW PTD-Treiber'
      }
    };
  }

  async login() {
    if (this.isLoggedIn) {
      this.logger.info('✅ Bereits eingeloggt');
      return true;
    }

    this.logger.info('🔐 Logge bei BMW ein...');
    
    try {
      // Navigate to auth page
      await this.page.goto(process.env.BMW_AUTH_URL, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for login form
      await this.page.waitForSelector('input[name="j_username"], input[type="text"]', { timeout: 10000 });
      
      // Fill credentials
      await this.page.fill('input[name="j_username"], input[type="text"]', process.env.BMW_USERNAME);
      await this.page.fill('input[name="j_password"], input[type="password"]', process.env.BMW_PASSWORD);
      
      // Click login button
      await this.page.click('button[type="submit"], input[type="submit"]');
      
      // Wait for redirect
      try {
        await this.page.waitForURL('**/startpage-workshop**', { timeout: 30000 });
      } catch (error) {
        // Fallback: wait for any aos.bmwgroup.com page
        await this.page.waitForURL('https://aos.bmwgroup.com/**', { timeout: 30000 });
      }
      
      // Additional wait for page to fully load
      await this.page.waitForLoadState('networkidle');
      
      // Check if we're on the startpage-workshop (successful login)
      const currentUrl = this.page.url();
      if (currentUrl.includes('startpage-workshop') || currentUrl.includes('aos.bmwgroup.com')) {
        this.isLoggedIn = true;
        this.logger.info('✅ Login erfolgreich!');
        return true;
      } else {
        throw new Error(`Login verification failed - URL: ${currentUrl}`);
      }
      
    } catch (error) {
      this.logger.error(`❌ Login fehlgeschlagen: ${error.message}`);
      
      // Send email notification for login failure
      await this.sendLoginFailureNotification(error.message);
      
      return false;
    }
  }

  async navigateToApplication(appType) {
    const appName = appType === 'ista-p' ? 'ISTA-P' : 'ISTA-Next';
    const appUrl = appType === 'ista-p' ? process.env.BMW_ISTA_P_URL : process.env.BMW_ISTA_NEXT_URL;
    
    this.logger.info(`🧭 Navigiere zu ${appName}...`);
    
    try {
      // Navigate directly to the application
      await this.page.goto(appUrl, {
        waitUntil: 'networkidle',
        timeout: 60000
      });
      
      // Wait for the page to load
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(3000);
      
      const currentUrl = this.page.url();
      this.logger.info(`✅ Erfolgreich zu ${appName} navigiert: ${currentUrl}`);
      
      return true;
    } catch (error) {
      this.logger.error(`❌ Navigation zu ${appName} fehlgeschlagen: ${error.message}`);
      return false;
    }
  }

  async findDownloads(appType) {
    const appName = appType === 'ista-p' ? 'ISTA-P' : 'ISTA-Next';
    this.logger.info(`🔍 Suche nach Downloads auf der ${appName} Seite...`);
    
    try {
      // Wait for the page to be fully loaded
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
      
      // Wait for frames to load
      this.logger.debug('Warte auf Frames...');
      try {
        await this.page.waitForFunction(() => {
          const frames = document.querySelectorAll('iframe');
          return frames.length > 0;
        }, { timeout: 10000 });
        this.logger.debug('Frames gefunden');
      } catch (e) {
        this.logger.debug('Keine Frames gefunden, suche nur in Hauptseite');
      }
      
      // Execute JavaScript to find all download links (including frames)
      const downloads = await this.page.evaluate(() => {
        const foundDownloads = [];
        const frameInfo = {
          totalFrames: 0,
          accessibleFrames: 0,
          totalLinks: 0,
          downloadLinks: 0
        };
        
        // Function to search for downloads in a document
        function searchForDownloads(doc, frameInfo = 'main') {
          // Find all links that might be downloads
          const links = doc.querySelectorAll('a[href]');
          
          links.forEach(link => {
            const href = link.href;
            const text = link.textContent.trim();
            
            // Skip PDF files completely
            if (href.toLowerCase().includes('.pdf') || text.toLowerCase().includes('.pdf')) {
              return;
            }
            
            // Check if this looks like a download link
            if (href && href.includes('/api/v2/downloads') && text) {
              foundDownloads.push({
                title: text,
                url: href,
                method: `link_search_${frameInfo}`
              });
            }
          });
          
          // Also look for buttons that might trigger downloads
          const buttons = doc.querySelectorAll('button, [role="button"]');
          buttons.forEach(button => {
            const text = button.textContent.trim();
            const onclick = button.getAttribute('onclick');
            
            if (text && onclick && onclick.includes('download')) {
              foundDownloads.push({
                title: text,
                url: onclick,
                method: `button_search_${frameInfo}`
              });
            }
          });
        }
        
        // Search in main document
        searchForDownloads(document, 'main');
        
        // Search in all frames
        const frames = document.querySelectorAll('iframe');
        frameInfo.totalFrames = frames.length;
        
        frames.forEach((frame, index) => {
          try {
            const frameDoc = frame.contentDocument || frame.contentWindow?.document;
            if (frameDoc) {
              frameInfo.accessibleFrames++;
              searchForDownloads(frameDoc, `frame_${index}`);
            }
          } catch (e) {
            // Frame might be cross-origin and inaccessible
            // Skip this frame
          }
        });
        
        return { downloads: foundDownloads, frameInfo };
      });
      
      // Log frame information
      this.logger.debug(`Frame-Analyse: ${downloads.frameInfo.totalFrames} Frames gefunden, ${downloads.frameInfo.accessibleFrames} zugänglich`);
      
      const foundDownloads = downloads.downloads;
      
      this.logger.debug(`Gefundene Downloads (roh): ${foundDownloads.length}`);
      foundDownloads.forEach((download, index) => {
        this.logger.debug(`  ${index + 1}. ${download.title}: ${download.url} [${download.method}]`);
      });
      
      // Additional debug: Check for programming data specifically
      const programmingDataLinks = foundDownloads.filter(d => 
        d.url.toLowerCase().includes('programmingdata') || 
        d.url.toLowerCase().includes('istauss_programmingdata_') ||
        d.title.toLowerCase().includes('programmierdaten')
      );
      if (programmingDataLinks.length > 0) {
        this.logger.debug(`🔍 Potentielle Programmierdaten-Links gefunden: ${programmingDataLinks.length}`);
        programmingDataLinks.forEach((link, index) => {
          this.logger.debug(`  PD${index + 1}. ${link.title}: ${link.url}`);
        });
      } else {
        this.logger.debug(`❌ Keine Programmierdaten-Links gefunden`);
      }
      
      // Categorize downloads
      const categorizedDownloads = this.categorizeDownloads(foundDownloads, appType);
      
      this.logger.info(`✅ ${Object.keys(categorizedDownloads).length} Downloads kategorisiert`);
      
      return categorizedDownloads;
      
    } catch (error) {
      this.logger.error(`❌ Fehler beim Suchen der Downloads: ${error.message}`);
      return {};
    }
  }

  categorizeDownloads(downloads, appType) {
    const categorized = {};
    const validCategories = Object.keys(this.downloadCategories[appType] || {});
    
    // Get the appropriate filter for this app type
    const filter = appType === 'ista-p' ? this.istaPFilter : this.istaNextFilter;
    
    this.logger.debug(`Kategorisiere Downloads für ${appType}...`);
    this.logger.debug(`Verwende Filter: ${filter.join(', ')}`);
    
    for (const download of downloads) {
      const title = download.title.toLowerCase();
      const url = download.url.toLowerCase();
      let category = null;
      
      this.logger.debug(`Prüfe Download: "${download.title}" -> ${download.url}`);
      
      // Check if this download matches any of the configured filters
      const matchesFilter = filter.some(filterText => {
        const filterLower = filterText.toLowerCase();
        return title.includes(filterLower) || download.title.includes(filterText);
      });
      
      if (!matchesFilter) {
        this.logger.debug(`❌ Download entspricht nicht dem Filter: ${download.title}`);
        continue;
      }
      
      if (appType === 'ista-p') {
        // ISTA-P categorization
        if (title.includes('installationsprogramm') || 
            title.includes('installationsdatei') || 
            url.includes('istaoss') || 
            url.includes('bdrclient')) {
          category = 'installer';
        }
        else if (title.includes('datenarchiv') || 
                 url.includes('commondat') || 
                 url.includes('.istapdata') ||
                 (url.includes('ista-p') && url.includes('commondat'))) {
          category = 'data_archive';
        }
      } else if (appType === 'ista-next') {
        // ISTA-Next categorization - Order matters!
        if (title.includes('programmierdaten') || 
            url.includes('ISTAOSS_ProgrammingData_')) {
          category = 'programming_data';
        }
        else if (title.includes('installationsdatei') || 
                 title.includes('client') || 
                 url.includes('istaoss') || 
                 url.includes('client')) {
          category = 'client';
        }
        else if ((title.includes('icom') && title.includes('firmware')) || 
                 url.includes('ICOM-Next-FW') ||
                 (url.includes('icom') && url.includes('fw'))) {
          category = 'icom_firmware';
        }
        else if (title.includes('ptd') || 
                 title.includes('treiber') || 
                 url.includes('ptd') ||
                 url.includes('passthru')) {
          category = 'ptd_driver';
        }
      }
      
      if (category && validCategories.includes(category) && !categorized[category]) {
        categorized[category] = {
          ...download,
          category,
          appType,
          displayName: this.downloadCategories[appType][category],
          version: this.extractVersion(download.url)
        };
        
        this.logger.debug(`✅ Kategorisiert: ${download.title} -> ${category}`);
      } else if (!category) {
        this.logger.debug(`❌ Unkategorisiert: ${download.title} (${download.url})`);
      } else if (!validCategories.includes(category)) {
        this.logger.debug(`❌ Ungültige Kategorie: ${category} für ${download.title}`);
      } else if (categorized[category]) {
        this.logger.debug(`❌ Kategorie bereits besetzt: ${category} für ${download.title}`);
      }
    }
    
    return categorized;
  }

  async checkForUpdates() {
    this.logger.info('🔍 Prüfe auf Updates...');
    
    if (!this.isLoggedIn) {
      const loginSuccess = await this.login();
      if (!loginSuccess) {
        this.logger.error('❌ Login fehlgeschlagen, überspringe Update-Check');
        // Login failure notification is already sent in the login() method
        return;
      }
    }

    let totalSuccessCount = 0;
    let totalFailCount = 0;

    // Check ISTA-P
    this.logger.info('📥 Prüfe ISTA-P Downloads...');
    const istaPSuccess = await this.checkApplicationUpdates('ista-p');
    totalSuccessCount += istaPSuccess.successCount;
    totalFailCount += istaPSuccess.failCount;

    // Add delay between applications
    this.logger.info('⏳ Warte 5 Sekunden vor ISTA-Next...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check ISTA-Next
    this.logger.info('📥 Prüfe ISTA-Next Downloads...');
    const istaNextSuccess = await this.checkApplicationUpdates('ista-next');
    totalSuccessCount += istaNextSuccess.successCount;
    totalFailCount += istaNextSuccess.failCount;

    this.logger.info(`📊 Gesamt-Download-Statistik: ${totalSuccessCount} erfolgreich, ${totalFailCount} fehlgeschlagen`);
    
    // Update last check timestamp even if no new downloads were found
    await this.updateLastCheck();
  }

  async checkApplicationUpdates(appType) {
    const appName = appType === 'ista-p' ? 'ISTA-P' : 'ISTA-Next';
    this.logger.info(`🔍 Prüfe ${appName} auf Updates...`);
    
    // Navigate to application
    const navigationSuccess = await this.navigateToApplication(appType);
    if (!navigationSuccess) {
      this.logger.error(`❌ Navigation zu ${appName} fehlgeschlagen, überspringe Update-Check`);
      return { successCount: 0, failCount: 0 };
    }

    // Find downloads
    const downloads = await this.findDownloads(appType);
    
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
      this.logger.info(`📥 ${updates.length} Updates für ${appName} werden heruntergeladen...`);
      
      const successfulUpdates = [];
      
      for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        this.logger.info(`📥 Download ${i + 1}/${updates.length}: ${update.displayName}`);
        
        try {
          const success = await this.downloadFile(update);
          if (success) {
            successCount++;
            successfulUpdates.push(update);
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
      
      this.logger.info(`📊 ${appName} Download-Statistik: ${successCount} erfolgreich, ${failCount} fehlgeschlagen`);
      
      // Send email notification for successful downloads
      if (successfulUpdates.length > 0) {
        await this.sendNewVersionNotification(successfulUpdates);
      }
      
    } else {
      this.logger.info(`✅ Keine Updates für ${appName} verfügbar`);
    }

    return { successCount, failCount };
  }

  async run() {
    try {
      await this.initialize();
      
      // Get check interval from environment (default: 6 hours)
      const checkIntervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS) || 6;
      const checkIntervalMs = checkIntervalHours * 60 * 60 * 1000;
      
      this.logger.info(`🔄 BMW ISTA Downloader läuft im Dauerbetrieb`);
      this.logger.info(`📁 Downloads werden in ${this.downloadDir} gespeichert`);
      this.logger.info(`⏰ Update-Checks alle ${checkIntervalHours} Stunden (${checkIntervalMs / 1000 / 60} Minuten)`);
      
      // Run initial check
      this.logger.info('🚀 Führe ersten Update-Check durch...');
      await this.checkForUpdates();
      
      // Set up continuous operation
      while (true) {
        this.logger.info(`⏳ Warte ${checkIntervalHours} Stunden bis zum nächsten Update-Check...`);
        
        // Wait for the specified interval
        await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
        
        this.logger.info('🔄 Führe regelmäßigen Update-Check durch...');
        
        try {
          // Restart browser to prevent memory leaks
          this.logger.info('🔄 Starte Browser neu...');
          await this.cleanup();
          await this.launchBrowser();
          
          // Reset login status after browser restart
          this.isLoggedIn = false;
          
          await this.checkForUpdates();
        } catch (error) {
          this.logger.error(`❌ Fehler beim Update-Check: ${error.message}`);
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
