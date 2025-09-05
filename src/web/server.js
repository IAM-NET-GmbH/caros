import express from 'express';
import basicAuth from 'express-basic-auth';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { MetadataManager } from '../utils/MetadataManager.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WebServer {
  constructor() {
    this.app = express();
    this.port = process.env.WEB_PORT || 3000;
    this.downloadDir = process.env.DOWNLOAD_DIR || '/mnt/storagebox/providers';
    this.baseUrl = process.env.BASE_URL || `http://localhost:${this.port}`;
    this.metadataManager = new MetadataManager(this.downloadDir);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // CORS für alle Routen
    this.app.use(cors());
    
    // JSON parsing
    this.app.use(express.json());
    
    // Static files (CSS, JS, etc.)
    this.app.use('/static', express.static(path.join(__dirname, 'public')));
    
    // Basic Auth für alle Routen außer /health
    this.app.use((req, res, next) => {
      if (req.path === '/health') {
        return next();
      }
      
      const auth = basicAuth({
        users: { 
          [process.env.WEB_USERNAME || 'admin']: process.env.WEB_PASSWORD || 'admin123'
        },
        challenge: true,
        realm: 'IAM-NET GmbH Fileserver'
      });
      
      auth(req, res, next);
    });
  }

  setupRoutes() {
    // Health check (ohne Auth)
    this.app.get('/health', (req, res) => {
      res.json({ status: 'OK', timestamp: new Date().toISOString() });
    });

    // API Routes
    this.app.get('/api/status', async (req, res) => {
      try {
        const globalMetadata = await this.metadataManager.loadGlobalMetadata();
        
        // Erstelle eine vereinfachte Struktur mit tatsächlichen Dateien aus dem Dateisystem
        const providers = {};
        let totalFiles = 0;
        let totalActualFiles = 0;
        
        for (const [providerName, providerData] of Object.entries(globalMetadata.providers)) {
          const files = [];
          let actualFileCount = 0;
          let actualTotalSize = 0;
          
          // Zähle tatsächliche Dateien im Dateisystem
          try {
            const providerDir = path.join(this.downloadDir, providerName);
            const result = await this.countFilesRecursively(providerDir);
            actualFileCount = result.fileCount;
            actualTotalSize = result.totalSize;
          } catch (error) {
            console.warn(`Fehler beim Zählen der Dateien für ${providerName}:`, error.message);
            actualFileCount = 0;
            actualTotalSize = 0;
          }
          
          // Erstelle Dateiliste aus Metadaten (falls verfügbar)
          if (providerData.downloads) {
            for (const [downloadKey, downloadData] of Object.entries(providerData.downloads)) {
              // Extrahiere den Basis-Dateinamen ohne Versionsangabe
              const baseFileName = this.extractBaseFileName(downloadData.fileName);
              
              files.push({
                name: baseFileName,
                version: downloadData.version || 'unbekannt',
                fileName: downloadData.fileName,
                size: downloadData.fileSize || 0,
                sizeFormatted: this.formatFileSize(downloadData.fileSize || 0),
                downloadedAt: downloadData.downloadedAt,
                downloadUrl: `${this.baseUrl}/api/download/${providerName}/${encodeURIComponent(downloadData.fileName)}`
              });
            }
          }
          
          // Sortiere Dateien nach Namen für bessere Vergleichbarkeit
          files.sort((a, b) => a.name.localeCompare(b.name));
          
          providers[providerName] = {
            name: providerName.toUpperCase(),
            lastUpdate: providerData.lastUpdate,
            files: files,
            fileCount: files.length,
            totalSize: files.reduce((sum, file) => sum + file.size, 0),
            actualFiles: actualFileCount,
            actualTotalSize: actualTotalSize,
            actualTotalSizeFormatted: this.formatFileSize(actualTotalSize)
          };
          
          totalFiles += files.length;
          totalActualFiles += actualFileCount;
        }
        
        res.json({
          generatedAt: new Date().toISOString(),
          totalProviders: Object.keys(providers).length,
          totalFiles: totalActualFiles, // Verwende tatsächliche Dateien aus dem Dateisystem
          totalActualFiles: totalActualFiles,
          providers: providers
        });
      } catch (error) {
        console.error('Error in /api/status:', error);
        // Fallback wenn keine Metadaten existieren
        res.json({
          generatedAt: new Date().toISOString(),
          totalProviders: 0,
          totalFiles: 0,
          totalActualFiles: 0,
          providers: {}
        });
      }
    });

    this.app.get('/api/providers', async (req, res) => {
      try {
        const providers = await this.metadataManager.getAllProvidersStatus();
        
        // Erweitere Provider-Daten mit tatsächlichen Datei-Informationen
        const enhancedProviders = {};
        
        for (const [providerName, providerData] of Object.entries(providers)) {
          try {
            const providerDir = path.join(this.downloadDir, providerName);
            
            // Verwende rekursive Funktion für genaue Zählung
            const result = await this.countFilesRecursively(providerDir);
            
            enhancedProviders[providerName] = {
              ...providerData,
              downloadCount: result.fileCount,
              totalSize: this.formatFileSize(result.totalSize),
              actualFiles: result.fileCount,
              actualTotalSize: result.totalSize,
              actualTotalSizeFormatted: this.formatFileSize(result.totalSize)
            };
          } catch (error) {
            // Provider-Verzeichnis existiert nicht oder ist leer
            console.warn(`Fehler beim Verarbeiten von Provider ${providerName}:`, error.message);
            enhancedProviders[providerName] = {
              ...providerData,
              downloadCount: 0,
              totalSize: '0 GB',
              actualFiles: 0,
              actualTotalSize: 0,
              actualTotalSizeFormatted: '0 GB'
            };
          }
        }
        
        res.json(enhancedProviders);
      } catch (error) {
        // Fallback wenn keine Metadaten existieren
        res.json({});
      }
    });

    this.app.get('/api/files/:provider', async (req, res) => {
      try {
        const provider = req.params.provider;
        const providerDir = path.join(this.downloadDir, provider);
        
        // Prüfe ob Provider-Verzeichnis existiert
        try {
          await fs.access(providerDir);
        } catch {
          return res.status(404).json({ error: 'Provider nicht gefunden' });
        }

        // Lade Dateien aus dem Provider-Verzeichnis
        const files = await fs.readdir(providerDir);
        const fileList = [];

        for (const file of files) {
          const filePath = path.join(providerDir, file);
          const stats = await fs.stat(filePath);
          
          // Überspringe Verzeichnisse und JSON-Dateien
          if (stats.isDirectory() || file.endsWith('.json')) {
            continue;
          }

          fileList.push({
            name: file,
            size: stats.size,
            sizeFormatted: this.formatFileSize(stats.size),
            modified: stats.mtime,
            downloadUrl: `${this.baseUrl}/api/download/${provider}/${encodeURIComponent(file)}`
          });
        }

        // Sortiere nach Änderungsdatum (neueste zuerst)
        fileList.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
          provider,
          files: fileList,
          totalFiles: fileList.length,
          totalSize: fileList.reduce((sum, file) => sum + file.size, 0)
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/download/:provider/:filename', async (req, res) => {
      try {
        const provider = req.params.provider;
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(this.downloadDir, provider, filename);

        // Prüfe ob Datei existiert
        try {
          await fs.access(filePath);
        } catch {
          return res.status(404).json({ error: 'Datei nicht gefunden' });
        }

        // Setze Download-Header
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        
        // Stream die Datei mit createReadStream für bessere Performance
        const { createReadStream } = await import('fs');
        const fileStream = createReadStream(filePath);
        
        fileStream.on('error', (error) => {
          console.error('Fehler beim Lesen der Datei:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Fehler beim Lesen der Datei' });
          }
        });
        
        fileStream.pipe(res);
      } catch (error) {
        console.error('Download-Fehler:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Control API Routes
    this.app.post('/api/control/check/:provider?', async (req, res) => {
      try {
        const provider = req.params.provider;
        if (this.manager) {
          await this.manager.triggerProviderCheck(provider);
          res.json({ success: true, message: `Check für ${provider || 'alle Provider'} gestartet` });
        } else {
          res.status(500).json({ error: 'Manager nicht verfügbar' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/control/start/:provider?', async (req, res) => {
      try {
        const provider = req.params.provider;
        if (this.manager) {
          await this.manager.triggerProviderStart(provider);
          res.json({ success: true, message: `Provider ${provider || 'alle Provider'} gestartet` });
        } else {
          res.status(500).json({ error: 'Manager nicht verfügbar' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/control/status', async (req, res) => {
      try {
        if (this.manager) {
          const status = this.manager.getProviderStatus();
          res.json(status);
        } else {
          res.status(500).json({ error: 'Manager nicht verfügbar' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/logs', async (req, res) => {
      try {
        const fs = await import('fs');
        const path = await import('path');
        
        const allLogs = [];
        const logFiles = [
          'main-downloader.log',
          'bmw-downloader.log',
          'vw-downloader.log'
        ];
        
        // Lade alle verfügbaren Log-Dateien
        for (const logFile of logFiles) {
          const logPath = path.join(process.cwd(), logFile);
          
          try {
            if (fs.existsSync(logPath)) {
              const logContent = fs.readFileSync(logPath, 'utf-8');
              const lines = logContent.split('\n').filter(line => line.trim());
              
              // Füge Log-Zeilen mit Datei-Info hinzu
              lines.forEach(line => {
                allLogs.push({
                  file: logFile,
                  line: line,
                  timestamp: this.extractTimestamp(line)
                });
              });
            }
          } catch (error) {
            console.warn(`Fehler beim Lesen von ${logFile}:`, error.message);
          }
        }
        
        // Sortiere alle Logs nach Zeitstempel (älteste zuerst für chronologische Reihenfolge)
        allLogs.sort((a, b) => {
          if (a.timestamp && b.timestamp) {
            return new Date(a.timestamp) - new Date(b.timestamp);
          }
          return 0;
        });
        
        // Nimm die letzten 200 Zeilen (erweitert von 100)
        const lastLines = allLogs.slice(-200).map(log => log.line);
        
        res.json({
          success: true,
          logs: lastLines,
          totalLines: allLogs.length,
          logFiles: logFiles.filter(file => fs.existsSync(path.join(process.cwd(), file)))
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/disk-usage', async (req, res) => {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Führe df -h für das Storage-Verzeichnis aus
        const { stdout } = await execAsync(`df -h ${this.downloadDir}`);
        const lines = stdout.trim().split('\n');
        
        if (lines.length >= 2) {
          const dataLine = lines[1].split(/\s+/);
          const total = dataLine[1];
          const used = dataLine[2];
          const available = dataLine[3];
          const percent = dataLine[4];
          
          res.json({
            success: true,
            total,
            used,
            available,
            percent: percent.replace('%', ''),
            path: this.downloadDir
          });
        } else {
          throw new Error('Ungültiges df-Output');
        }
      } catch (error) {
        res.status(500).json({ 
          success: false,
          error: error.message,
          fallback: 'Speicherplatz nicht verfügbar'
        });
      }
    });

    // API Endpunkte für Metadaten
    this.app.get('/api/metadata', async (req, res) => {
      try {
        const globalMetadata = await this.metadataManager.loadGlobalMetadata();
        
        // Erstelle eine Kopie der Metadaten und ersetze Download-URLs
        const enhancedMetadata = JSON.parse(JSON.stringify(globalMetadata));
        
        for (const [providerName, providerData] of Object.entries(enhancedMetadata.providers)) {
          if (providerData.downloads) {
            for (const [downloadKey, downloadData] of Object.entries(providerData.downloads)) {
              // Ersetze die ursprüngliche URL durch die Fileserver-URL
              downloadData.downloadUrl = `${this.baseUrl}/api/download/${providerName}/${encodeURIComponent(downloadData.fileName)}`;
              // Behalte die ursprüngliche URL als separate Eigenschaft
              downloadData.originalUrl = downloadData.url;
              // Entferne die ursprüngliche URL aus der Hauptstruktur
              delete downloadData.url;
            }
          }
        }
        
        res.json(enhancedMetadata);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/metadata/:provider', async (req, res) => {
      try {
        const provider = req.params.provider;
        const globalMetadata = await this.metadataManager.loadGlobalMetadata();
        
        if (!globalMetadata.providers[provider]) {
          return res.status(404).json({ error: 'Provider nicht gefunden' });
        }
        
        // Erstelle eine Kopie der Provider-Metadaten und ersetze Download-URLs
        const providerData = JSON.parse(JSON.stringify(globalMetadata.providers[provider]));
        
        if (providerData.downloads) {
          for (const [downloadKey, downloadData] of Object.entries(providerData.downloads)) {
            // Ersetze die ursprüngliche URL durch die Fileserver-URL
            downloadData.downloadUrl = `${this.baseUrl}/api/download/${provider}/${encodeURIComponent(downloadData.fileName)}`;
            // Behalte die ursprüngliche URL als separate Eigenschaft
            downloadData.originalUrl = downloadData.url;
            // Entferne die ursprüngliche URL aus der Hauptstruktur
            delete downloadData.url;
          }
        }
        
        res.json({
          provider,
          ...providerData,
          metadataUrl: `${this.baseUrl}/api/metadata/${provider}`,
          lastChecked: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Hauptseite
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return parseFloat(gb.toFixed(2)) + ' GB';
  }

  extractBaseFileName(fileName) {
    if (!fileName) return 'unbekannt';
    
    // Entferne Dateiendung
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    
    // Entferne Versionsangaben (verschiedene Muster)
    // BMW: BMW_ISPI_ISTA-P_BDRCLient_3.74.0.930.exe -> BMW_ISPI_ISTA-P_BDRCLient
    // VW: ODIS-Service_installation_25_1_0_20250820.zip -> ODIS-Service_installation
    let baseName = nameWithoutExt;
    
    // Entferne Versionsmuster wie _3.74.0.930, _25_1_0_20250820, etc.
    baseName = baseName.replace(/_[0-9]+(\.[0-9]+)*(_[0-9]+)*$/, '');
    
    // Entferne weitere Versionsmuster
    baseName = baseName.replace(/_[0-9]{4}-[0-9]{2}-[0-9]{2}$/, ''); // Datum
    baseName = baseName.replace(/_[0-9]{8}$/, ''); // 8-stellige Zahlen
    
    return baseName;
  }

  extractTimestamp(logLine) {
    // Extrahiere Zeitstempel aus Log-Zeilen
    // Format: 2024-01-15T10:30:45.123Z [LEVEL] [SOURCE]: message
    const timestampMatch = logLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
    return timestampMatch ? timestampMatch[1] : null;
  }

  // Rekursive Funktion zum Zählen aller Dateien in einem Verzeichnis (ohne JSON-Dateien)
  async countFilesRecursively(dirPath) {
    let fileCount = 0;
    let totalSize = 0;
    
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          // Rekursiv in Unterordner gehen
          const subResult = await this.countFilesRecursively(itemPath);
          fileCount += subResult.fileCount;
          totalSize += subResult.totalSize;
        } else if (stats.isFile() && !item.endsWith('.json')) {
          // Nur echte Dateien zählen (keine JSON-Metadaten)
          fileCount++;
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Ignoriere Verzeichnisse, die nicht gelesen werden können
      console.warn(`Fehler beim Lesen von ${dirPath}:`, error.message);
    }
    
    return { fileCount, totalSize };
  }

  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IAM-NET GmbH Fileserver</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        
        .header h1 {
            color: #2c3e50;
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .header p {
            color: #7f8c8d;
            font-size: 1.1rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 32px 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            min-height: 140px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3498db, #2ecc71);
            border-radius: 16px 16px 0 0;
        }
        
        .stat-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
        }
        
        .stat-card.providers::before {
            background: linear-gradient(90deg, #e74c3c, #f39c12);
        }
        
        .stat-card.files::before {
            background: linear-gradient(90deg, #9b59b6, #e67e22);
        }
        
        .stat-card.storage::before {
            background: linear-gradient(90deg, #1abc9c, #16a085);
        }
        
        .stat-card h3 {
            color: #2c3e50;
            margin-bottom: 16px;
            font-size: 1.1rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-value {
            font-size: 2.8rem;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 8px;
            line-height: 1;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .stat-label {
            color: #7f8c8d;
            font-size: 0.95rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        
        .stat-icon {
            position: absolute;
            top: 20px;
            right: 20px;
            font-size: 2rem;
            opacity: 0.1;
            color: #2c3e50;
        }
        
        .providers-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .providers-section h2 {
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.8rem;
        }
        
        .provider-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        
        .provider-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 24px;
            border-left: 4px solid #3498db;
            transition: all 0.3s ease;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
        }
        
        .provider-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #3498db, #2ecc71);
            border-radius: 16px 16px 0 0;
        }
        
        .provider-card:hover {
            background: rgba(255, 255, 255, 1);
            transform: translateY(-4px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        }
        
        .provider-card.bmw {
            border-left-color: #e74c3c;
        }
        
        .provider-card.vw {
            border-left-color: #f39c12;
        }
        
        .provider-name {
            font-size: 1.2rem;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .provider-status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .status-aktiv {
            background: #d4edda;
            color: #155724;
        }
        
        .status-inaktiv {
            background: #f8d7da;
            color: #721c24;
        }
        
        .provider-info {
            margin-top: 10px;
            font-size: 0.9rem;
            color: #6c757d;
        }
        
        .files-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .files-section h2 {
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.8rem;
        }
        
        .provider-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .tab-button {
            padding: 10px 20px;
            background: #e9ecef;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .tab-button.active {
            background: #3498db;
            color: white;
        }
        
        .files-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        
        .files-table th,
        .files-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }
        
        .files-table th {
            background: #f8f9fa;
            font-weight: bold;
            color: #495057;
        }
        
        .download-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            font-size: 0.8rem;
            transition: background 0.3s ease;
        }
        
        .download-btn:hover {
            background: #218838;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #6c757d;
        }
        
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        
        .control-panel {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
        }
        
        .control-panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #17a2b8, #28a745);
            border-radius: 16px 16px 0 0;
        }
        
        .control-buttons {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .control-btn {
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
        }
        
        .control-btn.primary {
            background: linear-gradient(135deg, #17a2b8, #20c997);
            box-shadow: 0 4px 12px rgba(23, 162, 184, 0.3);
        }
        
        .control-btn.primary:hover {
            background: linear-gradient(135deg, #138496, #1ea085);
            box-shadow: 0 6px 16px rgba(23, 162, 184, 0.4);
        }
        
        .control-btn:hover {
            background: linear-gradient(135deg, #218838, #1ea085);
            transform: translateY(-3px);
            box-shadow: 0 6px 16px rgba(40, 167, 69, 0.4);
        }
        
        .control-btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        .logs-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            display: none;
        }
        
        .logs-section.show {
            display: block;
        }
        
        .logs-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .logs-content {
            background: #1e1e1e;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            line-height: 1.3;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
        }
        
        .log-line {
            margin-bottom: 2px;
            padding: 2px 0;
        }
        
        .log-error {
            color: #ff6b6b;
            background: rgba(255, 107, 107, 0.1);
            border-left: 3px solid #ff6b6b;
            padding-left: 8px;
        }
        
        .log-warn {
            color: #ffd93d;
            background: rgba(255, 217, 61, 0.1);
            border-left: 3px solid #ffd93d;
            padding-left: 8px;
        }
        
        .log-info {
            color: #6bcf7f;
        }
        
        .log-debug {
            color: #a8a8a8;
            opacity: 0.8;
        }
        
        .disk-usage {
            text-align: center;
        }
        
        .disk-used {
            font-size: 1.2rem;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .disk-available {
            font-size: 0.9rem;
            color: #6c757d;
            margin-bottom: 5px;
        }
        
        .disk-percent {
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .text-success {
            color: #28a745 !important;
        }
        
        .text-warning {
            color: #ffc107 !important;
        }
        
        .text-danger {
            color: #dc3545 !important;
        }
        
        .api-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-top: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .api-section h2 {
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.8rem;
        }
        
        .api-section p {
            color: #6c757d;
            margin-bottom: 25px;
            font-size: 1rem;
        }
        
        .api-endpoints {
            display: flex;
            flex-direction: column;
            gap: 25px;
            margin-bottom: 30px;
        }
        
        .api-endpoint {
            background: rgba(248, 249, 250, 0.8);
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #3498db;
        }
        
        .api-endpoint h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .endpoint-item {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .endpoint-item:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }
        
        .method {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: bold;
            text-transform: uppercase;
            margin-right: 12px;
            min-width: 50px;
            text-align: center;
        }
        
        .method.get {
            background: #d4edda;
            color: #155724;
        }
        
        .method.post {
            background: #fff3cd;
            color: #856404;
        }
        
        .url {
            font-family: 'Courier New', monospace;
            background: #f8f9fa;
            padding: 4px 8px;
            border-radius: 4px;
            color: #495057;
            font-weight: 600;
            margin-right: 12px;
            min-width: 200px;
        }
        
        .description {
            color: #6c757d;
            font-size: 0.9rem;
            flex: 1;
        }
        
        .api-auth {
            background: rgba(248, 249, 250, 0.8);
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #28a745;
        }
        
        .api-auth h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .api-auth h4 {
            color: #495057;
            margin: 20px 0 10px 0;
            font-size: 1rem;
            font-weight: 600;
        }
        
        .auth-example {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
            margin: 10px 0;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
        }
        
        .auth-example code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.85rem;
        }
        
        .curl-examples {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin-top: 15px;
        }
        
        .curl-example {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
        }
        
        .curl-example strong {
            color: #495057;
            display: block;
            margin-bottom: 8px;
        }
        
        .curl-example code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 8px 12px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            display: block;
            overflow-x: auto;
            white-space: nowrap;
        }
        
        @media (max-width: 1024px) {
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
            }
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
                gap: 16px;
            }
            
            .stat-card {
                padding: 24px 20px;
                min-height: 120px;
            }
            
            .stat-value {
                font-size: 2.4rem;
            }
            
            .stat-icon {
                font-size: 1.5rem;
                top: 16px;
                right: 16px;
            }
            
            .provider-grid {
                grid-template-columns: 1fr;
            }
            
            .endpoint-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            
            .method {
                margin-right: 0;
                margin-bottom: 4px;
            }
            
            .url {
                margin-right: 0;
                margin-bottom: 4px;
                min-width: auto;
                width: 100%;
            }
            
            .description {
                width: 100%;
            }
        }
        
        @media (max-width: 480px) {
            .stat-card {
                padding: 20px 16px;
                min-height: 100px;
            }
            
            .stat-value {
                font-size: 2rem;
            }
            
            .stat-label {
                font-size: 0.85rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚗 IAM-NET GmbH Fileserver</h1>
            <p>Überwachung und Verwaltung der Provider-Downloads</p>
        </div>
        
        <div class="control-panel">
            <div class="control-buttons">
                <button class="control-btn primary" onclick="loadData()">🔄 Aktualisieren</button>
                <button class="control-btn" onclick="triggerCheck()">🔍 Alle Provider Checken</button>
                <button class="control-btn" onclick="triggerCheck('bmw')">🚗 BMW Checken</button>
                <button class="control-btn" onclick="triggerCheck('vw')">🚙 VW Checken</button>
            </div>
        </div>
        
        <div class="stats-grid" id="statsGrid">
            <div class="stat-card providers">
                <div class="stat-icon">🚗</div>
                <div class="stat-value" id="totalProviders">-</div>
                <div class="stat-label">Aktive Provider</div>
            </div>
            <div class="stat-card files">
                <div class="stat-icon">📁</div>
                <div class="stat-value" id="totalFiles">-</div>
                <div class="stat-label">Anzahl Dateien</div>
            </div>
            <div class="stat-card storage">
                <div class="stat-icon">💾</div>
                <div class="stat-value" id="diskUsage">-</div>
                <div class="stat-label">Speicherplatzverbrauch</div>
            </div>
        </div>
        
        <div class="providers-section">
            <h2>📊 Provider Status</h2>
            <div class="provider-grid" id="providersGrid">
                <div class="loading">Lade Provider-Status...</div>
            </div>
        </div>
        
        <div class="logs-section show" id="logsSection">
            <div class="logs-header">
                <h2>📋 System Logs</h2>
            </div>
            <div class="logs-content" id="logsContent">
                <div class="loading">Lade Logs...</div>
            </div>
        </div>
        
        <div class="files-section">
            <h2>📁 Downloads</h2>
            <div class="provider-tabs" id="providerTabs">
                <!-- Tabs werden dynamisch generiert -->
            </div>
            <div id="filesContent">
                <div class="loading">Lade Dateien...</div>
            </div>
        </div>
        
        <div class="api-section">
            <h2>🔌 API Endpunkte</h2>
            <p>Diese Endpunkte können von Drittanbieter-Tools mit Basic Authentication verwendet werden:</p>
            
            <div class="api-endpoints">
                <div class="api-endpoint">
                    <h3>📊 Status & Statistiken</h3>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/api/status</span>
                        <span class="description">Gesamtstatus aller Provider mit Dateianzahl und Größen</span>
                    </div>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/api/providers</span>
                        <span class="description">Detaillierte Provider-Informationen mit tatsächlichen Dateien</span>
                    </div>
                </div>
                
                <div class="api-endpoint">
                    <h3>📁 Dateien & Downloads</h3>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/api/files/{provider}</span>
                        <span class="description">Liste aller Dateien eines Providers (z.B. ${this.baseUrl}/api/files/bmw)</span>
                    </div>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/api/download/{provider}/{filename}</span>
                        <span class="description">Direkter Download einer Datei (z.B. ${this.baseUrl}/api/download/bmw/file.exe)</span>
                    </div>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/api/metadata/{provider}</span>
                        <span class="description">Metadaten eines Providers mit Download-URLs</span>
                    </div>
                </div>
                
                <div class="api-endpoint">
                    <h3>⚙️ Steuerung</h3>
                    <div class="endpoint-item">
                        <span class="method post">POST</span>
                        <span class="url">/api/control/check/{provider?}</span>
                        <span class="description">Manueller Check für alle Provider oder spezifischen Provider</span>
                    </div>
                    <div class="endpoint-item">
                        <span class="method post">POST</span>
                        <span class="url">/api/control/start/{provider?}</span>
                        <span class="description">Provider starten (alle oder spezifischen)</span>
                    </div>
                    <div class="endpoint-item">
                        <span class="method post">POST</span>
                        <span class="url">/api/control/stop/{provider?}</span>
                        <span class="description">Provider stoppen (alle oder spezifischen)</span>
                    </div>
                </div>
                
                <div class="api-endpoint">
                    <h3>🔍 System</h3>
                    <div class="endpoint-item">
                        <span class="method get">GET</span>
                        <span class="url">/health</span>
                        <span class="description">Health Check (ohne Authentifizierung)</span>
                    </div>
                </div>
            </div>
            
            <div class="api-auth">
                <h3>🔐 Authentifizierung</h3>
                <p>Alle Endpunkte (außer /health) erfordern Basic Authentication:</p>
                <div class="auth-example">
                    <strong>Benutzername:</strong> admin<br>
                    <strong>Passwort:</strong> admin123<br>
                    <strong>Header:</strong> <code>Authorization: Basic YWRtaW46YWRtaW4xMjM=</code>
                </div>
                
                <h4>Beispiel cURL Befehle:</h4>
                <div class="curl-examples">
                    <div class="curl-example">
                        <strong>Status abrufen:</strong><br>
                        <code>curl -u admin:admin123 ${this.baseUrl}/api/status</code>
                    </div>
                    <div class="curl-example">
                        <strong>Provider-Status abrufen:</strong><br>
                        <code>curl -u admin:admin123 ${this.baseUrl}/api/providers</code>
                    </div>
                    <div class="curl-example">
                        <strong>BMW Dateien auflisten:</strong><br>
                        <code>curl -u admin:admin123 ${this.baseUrl}/api/files/bmw</code>
                    </div>
                    <div class="curl-example">
                        <strong>Datei herunterladen:</strong><br>
                        <code>curl -u admin:admin123 -O ${this.baseUrl}/api/download/bmw/file.exe</code>
                    </div>
                    <div class="curl-example">
                        <strong>Check auslösen:</strong><br>
                        <code>curl -u admin:admin123 -X POST ${this.baseUrl}/api/control/check</code>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentProvider = null;
        let allFiles = {};

        async function loadData() {
            try {
                // Lade Status-Daten
                const statusResponse = await fetch('/api/status');
                const statusData = await statusResponse.json();
                
                updateStats(statusData);
                updateProviders(statusData.providers);
                
                // Lade Speicherplatz-Informationen
                await loadDiskUsage();
                
                // Lade Dateien für alle Provider
                await loadAllFiles();
                
            } catch (error) {
                console.error('Fehler beim Laden der Daten:', error);
                showError('Fehler beim Laden der Daten: ' + error.message);
            }
        }

        function updateStats(data) {
            document.getElementById('totalProviders').textContent = data.totalProviders || 0;
            
            // Debug: Log die empfangenen Daten (kann nach dem Test entfernt werden)
            console.log('updateStats data:', data);
            console.log('totalActualFiles:', data.totalActualFiles);
            console.log('providers:', data.providers);
            
            // Verwende totalActualFiles falls verfügbar, sonst berechne aus Provider-Daten
            let totalFiles = 0;
            if (data.totalActualFiles !== undefined && data.totalActualFiles > 0) {
                totalFiles = data.totalActualFiles;
                console.log('Using totalActualFiles:', totalFiles);
            } else {
                // Fallback: Berechne aus Provider-Daten
                for (const provider of Object.values(data.providers)) {
                    const providerFiles = provider.actualFiles || provider.downloadCount || 0;
                    totalFiles += providerFiles;
                    console.log('Provider ' + (provider.name || 'unknown') + ': ' + providerFiles + ' files');
                }
                console.log('Calculated totalFiles from providers:', totalFiles);
            }
            
            document.getElementById('totalFiles').textContent = totalFiles;
        }

        function updateProviders(providers) {
            const grid = document.getElementById('providersGrid');
            grid.innerHTML = '';
            
            console.log('updateProviders data:', providers);
            
            for (const [providerName, providerData] of Object.entries(providers)) {
                const card = document.createElement('div');
                card.className = 'provider-card ' + providerName;
                
                const statusClass = providerData.status === 'Aktiv' ? 'status-aktiv' : 'status-inaktiv';
                
                // Debug: Log Provider-Daten
                console.log('Provider ' + providerName + ':', providerData);
                
                const fileCount = providerData.actualFiles !== undefined ? providerData.actualFiles : (providerData.downloadCount || 0);
                const totalSize = providerData.actualTotalSizeFormatted || providerData.totalSize || '0 GB';
                
                card.innerHTML = 
                    '<div class="provider-name">' + providerName.toUpperCase() + '</div>' +
                    '<div class="provider-status ' + statusClass + '">' + providerData.status + '</div>' +
                    '<div class="provider-info">' +
                        '<div>Downloads: ' + fileCount + '</div>' +
                        '<div>Größe: ' + totalSize + '</div>' +
                        '<div>Letzte Aktualisierung: ' + (providerData.lastUpdate ? 
                            new Date(providerData.lastUpdate).toLocaleString('de-DE') : 'Nie') + '</div>' +
                    '</div>';
                
                grid.appendChild(card);
            }
        }

        async function loadAllFiles() {
            try {
                const providers = ['bmw', 'vw'];
                allFiles = {};
                
                for (const provider of providers) {
                    try {
                        const response = await fetch('/api/files/' + provider);
                        const data = await response.json();
                        allFiles[provider] = data.files || [];
                    } catch (error) {
                        console.warn('Fehler beim Laden der Dateien für ' + provider + ':', error);
                        allFiles[provider] = [];
                    }
                }
                
                updateProviderTabs();
                if (providers.length > 0) {
                    showProviderFiles(providers[0]);
                }
                
            } catch (error) {
                console.error('Fehler beim Laden der Dateien:', error);
                showError('Fehler beim Laden der Dateien: ' + error.message);
            }
        }

        function updateProviderTabs() {
            const tabsContainer = document.getElementById('providerTabs');
            tabsContainer.innerHTML = '';
            
            for (const provider of Object.keys(allFiles)) {
                const button = document.createElement('button');
                button.className = 'tab-button';
                button.textContent = provider.toUpperCase() + ' (' + allFiles[provider].length + ')';
                button.onclick = () => showProviderFiles(provider);
                tabsContainer.appendChild(button);
            }
        }

        function showProviderFiles(provider) {
            currentProvider = provider;
            
            // Aktualisiere aktive Tab
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
                if (btn.textContent.includes(provider.toUpperCase())) {
                    btn.classList.add('active');
                }
            });
            
            const files = allFiles[provider] || [];
            const content = document.getElementById('filesContent');
            
            if (files.length === 0) {
                content.innerHTML = '<div class="loading">Keine Dateien gefunden</div>';
                return;
            }
            
            let tableHTML = \`
                <table class="files-table">
                    <thead>
                        <tr>
                            <th>Dateiname</th>
                            <th>Größe</th>
                            <th>Geändert</th>
                            <th>Aktion</th>
                        </tr>
                    </thead>
                    <tbody>
            \`;
            
            files.forEach(file => {
                tableHTML += \`
                    <tr>
                        <td>\${file.name}</td>
                        <td>\${file.sizeFormatted}</td>
                        <td>\${new Date(file.modified).toLocaleString('de-DE')}</td>
                        <td>
                            <a href="\${file.downloadUrl}" class="download-btn" download="\${file.name}" target="_blank">
                                ⬇️ Download
                            </a>
                        </td>
                    </tr>
                \`;
            });
            
            tableHTML += '</tbody></table>';
            content.innerHTML = tableHTML;
        }

        function showError(message) {
            const content = document.getElementById('filesContent');
            content.innerHTML = '<div class="error">' + message + '</div>';
        }

        async function triggerCheck(provider = null) {
            try {
                // Zeige sofortiges Feedback
                const providerName = provider ? provider.toUpperCase() : 'alle Provider';
                showNotification('🔄 Starte Check für ' + providerName + '...', 'info');
                
                // Deaktiviere alle Control-Buttons
                const buttons = document.querySelectorAll('.control-btn');
                buttons.forEach(btn => btn.disabled = true);
                
                const url = provider ? '/api/control/check/' + provider : '/api/control/check';
                
                // Starte Check im Hintergrund (nicht await)
                fetch(url, { method: 'POST' })
                    .then(response => response.json())
                    .then(result => {
                        if (result.success) {
                            showNotification('✅ Check für ' + providerName + ' abgeschlossen', 'success');
                            // Lade Daten nach 2 Sekunden neu
                            setTimeout(loadData, 2000);
                        } else {
                            showNotification('❌ Fehler: ' + result.error, 'error');
                        }
                    })
                    .catch(error => {
                        console.error('Fehler beim Auslösen des Checks:', error);
                        showNotification('❌ Fehler: ' + error.message, 'error');
                    })
                    .finally(() => {
                        // Reaktiviere alle Control-Buttons nach 3 Sekunden
                        setTimeout(() => {
                            const buttons = document.querySelectorAll('.control-btn');
                            buttons.forEach(btn => btn.disabled = false);
                        }, 3000);
                    });
                
            } catch (error) {
                console.error('Fehler beim Auslösen des Checks:', error);
                                        showNotification('❌ Fehler: ' + error.message, 'error');
            }
        }

        function showNotification(message, type = 'info') {
            // Erstelle Notification-Element
            const notification = document.createElement('div');
            notification.style.cssText = \`
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 5px;
                color: white;
                font-weight: bold;
                z-index: 1000;
                max-width: 300px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                \${type === 'success' ? 'background: #28a745;' : ''}
                \${type === 'error' ? 'background: #dc3545;' : ''}
                \${type === 'info' ? 'background: #17a2b8;' : ''}
            \`;
            notification.textContent = message;
            
            document.body.appendChild(notification);
            
            // Entferne Notification nach 5 Sekunden
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 5000);
        }


        async function loadLogs() {
            try {
                const response = await fetch('/api/logs');
                const data = await response.json();
                
                if (data.success) {
                    const logsContent = document.getElementById('logsContent');
                    if (data.logs.length > 0) {
                        // Erstelle HTML für bessere Formatierung
                        let logsHTML = '';
                        data.logs.forEach(logLine => {
                            // Bestimme Log-Level für Farbkodierung
                            let logClass = '';
                            if (logLine.includes('[ERROR]')) {
                                logClass = 'log-error';
                            } else if (logLine.includes('[WARN]')) {
                                logClass = 'log-warn';
                            } else if (logLine.includes('[INFO]')) {
                                logClass = 'log-info';
                            } else if (logLine.includes('[DEBUG]')) {
                                logClass = 'log-debug';
                            }
                            
                            logsHTML += '<div class="log-line ' + logClass + '">' + logLine + '</div>';
                        });
                        
                        // Prüfe ob bereits am Ende gescrollt war
                        const wasAtBottom = logsContent.scrollTop + logsContent.clientHeight >= logsContent.scrollHeight - 10;
                        
                        logsContent.innerHTML = logsHTML;
                        
                        // Nur zum Ende scrollen wenn der Benutzer bereits am Ende war
                        if (wasAtBottom) {
                            logsContent.scrollTop = logsContent.scrollHeight;
                        }
                    } else {
                        logsContent.innerHTML = '<div class="log-line log-info">Keine Logs verfügbar</div>';
                    }
                } else {
                    document.getElementById('logsContent').innerHTML = '<div class="log-line log-error">Fehler beim Laden der Logs</div>';
                }
            } catch (error) {
                console.error('Fehler beim Laden der Logs:', error);
                document.getElementById('logsContent').innerHTML = '<div class="log-line log-error">Fehler beim Laden der Logs: ' + error.message + '</div>';
            }
        }

        async function loadDiskUsage() {
            try {
                const response = await fetch('/api/disk-usage');
                const data = await response.json();
                
                if (data.success) {
                    const diskUsageElement = document.getElementById('diskUsage');
                    const usedPercent = parseInt(data.percent);
                    
                    // Erstelle eine farbkodierte Anzeige
                    let colorClass = '';
                    if (usedPercent >= 90) {
                        colorClass = 'text-danger';
                    } else if (usedPercent >= 75) {
                        colorClass = 'text-warning';
                    } else {
                        colorClass = 'text-success';
                    }
                    
                    diskUsageElement.innerHTML = \`
                        <div class="disk-usage">
                            <div class="disk-used \${colorClass}">\${data.used} / \${data.total}</div>
                            <div class="disk-available">\${data.available} frei</div>
                            <div class="disk-percent \${colorClass}">\${data.percent}% belegt</div>
                        </div>
                    \`;
                } else {
                    document.getElementById('diskUsage').textContent = data.fallback || 'Nicht verfügbar';
                }
            } catch (error) {
                console.error('Fehler beim Laden der Speicherplatz-Informationen:', error);
                document.getElementById('diskUsage').textContent = 'Fehler';
            }
        }

        // Lade Daten beim Start
        document.addEventListener('DOMContentLoaded', () => {
            loadData();
            loadLogs(); // Lade Logs automatisch beim Start
        });
        
        // Auto-Refresh alle 30 Sekunden
        setInterval(loadData, 30000);
        
        // Auto-Refresh Logs alle 2 Sekunden für bessere Echtzeit-Anzeige
        setInterval(loadLogs, 2000);
    </script>
</body>
</html>
    `;
  }

  async start() {
    try {
      // Erstelle Download-Verzeichnis falls es nicht existiert
      await fs.mkdir(this.downloadDir, { recursive: true });
      
      this.app.listen(this.port, () => {
        console.log(`🌐 Web Server läuft auf http://localhost:${this.port}`);
        console.log(`📊 Dashboard verfügbar unter: http://localhost:${this.port}`);
        console.log(`🔐 Basic Auth: ${process.env.WEB_USERNAME || 'admin'} / ${process.env.WEB_PASSWORD || 'admin123'}`);
      });
    } catch (error) {
      console.error('❌ Fehler beim Starten des Web Servers:', error);
      process.exit(1);
    }
  }
}

// Starte den Server wenn diese Datei direkt ausgeführt wird
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new WebServer();
  server.start();
}

export { WebServer };
