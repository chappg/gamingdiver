// GamingDiver — Main application controller

const DB_NAME = 'gamingdiver-cache';
const DB_VERSION = 1;
const STORE_NAME = 'results';

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheResults(data) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(data, 'latest');
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
}

async function getCachedResults() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('latest');
    return new Promise((resolve) => { req.onsuccess = () => resolve(req.result || null); req.onerror = () => resolve(null); });
  } catch { return null; }
}

async function clearCache() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    return new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch {}
}

// App
class App {
  constructor() {
    this.analyzer = new WoWSAnalyzer();
    this.dashboard = null;
    this.setupUI();
    this.checkCache();
  }

  setupUI() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    // Click to browse
    uploadZone.addEventListener('click', () => fileInput.click());

    // File selected
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleFiles(e.target.files);
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) this.handleFiles(e.dataTransfer.files);
    });

    // Dashboard buttons
    document.getElementById('btnNewUpload')?.addEventListener('click', () => this.showLanding());
    document.getElementById('btnClearData')?.addEventListener('click', async () => {
      if (confirm('Clear all cached data?')) {
        await clearCache();
        this.showLanding();
      }
    });
  }

  async checkCache() {
    const cached = await getCachedResults();
    if (cached) {
      this.showDashboard(cached);
    }
  }

  async handleFiles(files) {
    this.showProgress('Reading files...');

    try {
      const file = files[0];
      if (file.name.endsWith('.zip')) {
        this.updateProgress(20, 'Extracting ZIP...');
        const isWoWS = await this.analyzer.parseZip(file);
        if (!isWoWS) {
          alert('This doesn\'t look like a WoWS Legends data export. Please upload the correct ZIP file.');
          this.hideProgress();
          return;
        }
      } else {
        // Handle individual CSV files
        const csvFiles = [];
        for (const f of files) {
          const text = await f.text();
          csvFiles.push({ name: f.name, content: text });
        }
        this.analyzer.parseCSVFiles(csvFiles);
      }

      this.updateProgress(50, 'Analyzing data...');
      const results = this.analyzer.analyze();

      this.updateProgress(80, 'Caching results...');
      await cacheResults(results);

      this.updateProgress(100, 'Done!');
      setTimeout(() => this.showDashboard(results), 300);

    } catch (err) {
      console.error('Error processing file:', err);
      alert('Error processing file: ' + err.message);
      this.hideProgress();
    }
  }

  showProgress(text) {
    document.getElementById('uploadProgress').hidden = false;
    document.getElementById('progressText').textContent = text;
    document.getElementById('progressFill').style.width = '10%';
  }

  updateProgress(pct, text) {
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = text;
  }

  hideProgress() {
    document.getElementById('uploadProgress').hidden = true;
    document.getElementById('progressFill').style.width = '0%';
  }

  showDashboard(results) {
    document.getElementById('landing').hidden = true;
    document.getElementById('dashboard').hidden = false;
    this.hideProgress();

    // Clean up old charts
    if (this.dashboard) {
      Object.values(this.dashboard.charts).forEach(c => c.destroy?.());
    }

    this.dashboard = new Dashboard(results);
    this.dashboard.render();
  }

  showLanding() {
    document.getElementById('landing').hidden = false;
    document.getElementById('dashboard').hidden = true;
    if (this.dashboard) {
      Object.values(this.dashboard.charts).forEach(c => c.destroy?.());
      this.dashboard = null;
    }
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => new App());
