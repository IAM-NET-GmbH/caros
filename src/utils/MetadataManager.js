import fs from 'fs/promises';
import path from 'path';

export class MetadataManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.globalMetadataPath = path.join(baseDir, 'global_metadata.json');
  }

  async loadGlobalMetadata() {
    try {
      const data = await fs.readFile(this.globalMetadataPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return {
        providers: {},
        lastGlobalUpdate: null,
        version: '1.0.0'
      };
    }
  }

  async saveGlobalMetadata(metadata) {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.globalMetadataPath, JSON.stringify(metadata, null, 2));
  }

  async updateProviderMetadata(providerName, providerData) {
    const globalMetadata = await this.loadGlobalMetadata();
    
    globalMetadata.providers[providerName] = {
      ...providerData,
      lastUpdate: new Date().toISOString(),
      version: globalMetadata.version
    };
    
    globalMetadata.lastGlobalUpdate = new Date().toISOString();
    
    await this.saveGlobalMetadata(globalMetadata);
  }

  async getProviderStatus(providerName) {
    const globalMetadata = await this.loadGlobalMetadata();
    return globalMetadata.providers[providerName] || null;
  }

  async getAllProvidersStatus() {
    const globalMetadata = await this.loadGlobalMetadata();
    return globalMetadata.providers;
  }

  async generateStatusReport() {
    const globalMetadata = await this.loadGlobalMetadata();
    const report = {
      generatedAt: new Date().toISOString(),
      totalProviders: Object.keys(globalMetadata.providers).length,
      lastGlobalUpdate: globalMetadata.lastGlobalUpdate,
      providers: {}
    };

    for (const [providerName, providerData] of Object.entries(globalMetadata.providers)) {
      report.providers[providerName] = {
        lastUpdate: providerData.lastUpdate,
        downloadCount: Object.keys(providerData.downloads || {}).length,
        status: providerData.lastUpdate ? 'Aktiv' : 'Inaktiv',
        categories: Object.keys(providerData.downloads || {}),
        totalSize: this.calculateTotalSize(providerData.downloads || {})
      };
    }

    return report;
  }

  calculateTotalSize(downloads) {
    let totalBytes = 0;
    for (const download of Object.values(downloads)) {
      if (download.fileSize) {
        totalBytes += download.fileSize;
      }
    }
    return this.formatFileSize(totalBytes);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return parseFloat(gb.toFixed(2)) + ' GB';
  }

  async cleanupOldMetadata(daysToKeep = 30) {
    const globalMetadata = await this.loadGlobalMetadata();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let cleanedCount = 0;
    
    for (const [providerName, providerData] of Object.entries(globalMetadata.providers)) {
      if (providerData.downloads) {
        const originalCount = Object.keys(providerData.downloads).length;
        
        // Remove old downloads
        for (const [category, download] of Object.entries(providerData.downloads)) {
          if (download.downloadedAt) {
            const downloadDate = new Date(download.downloadedAt);
            if (downloadDate < cutoffDate) {
              delete providerData.downloads[category];
              cleanedCount++;
            }
          }
        }
        
        // Update provider data
        globalMetadata.providers[providerName] = providerData;
      }
    }
    
    if (cleanedCount > 0) {
      await this.saveGlobalMetadata(globalMetadata);
      return cleanedCount;
    }
    
    return 0;
  }
}
