// GamingDiver — Main application controller

const DB_NAME = 'gamingdiver-cache';
const DB_VERSION = 2;
const STORE_NAME = 'results';
const SNAPSHOT_STORE = 'snapshots';

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE))
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id', autoIncrement: true });
    };
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

// Snapshot persistence — stores cumulative stats at each upload
async function saveSnapshot(results) {
  const db = await openDB();
  const snapshot = {
    timestamp: new Date().toISOString(),
    totalBattles: results.career.totalBattles,
    // Store per-mode cumulative stats
    modeStats: {},
    // Store per-ship cumulative stats for ship-level trends
    shipStats: {},
  };

  // Career mode stats
  for (const [mode, ms] of Object.entries(results.career.modeStats)) {
    snapshot.modeStats[mode] = {
      battles: ms.battles, wins: ms.wins, losses: ms.losses,
      damage: ms.damage, frags: ms.frags, survived: ms.survived,
    };
  }

  // Per-ship stats (keyed by name|nation|class for deduped identity)
  for (const s of results.ships) {
    const key = s.name + '|' + s.nation + '|' + s.class;
    snapshot.shipStats[key] = {
      name: s.name, nation: s.nation, class: s.class, tier: s.tier, premium: s.premium,
      battles: s.battles, wins: s.wins, damage: s.damage,
      frags: s.frags, survived: s.survived,
    };
  }

  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
  tx.objectStore(SNAPSHOT_STORE).add(snapshot);
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
}

async function getSnapshots() {
  try {
    const db = await openDB();
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const req = tx.objectStore(SNAPSHOT_STORE).getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

async function clearCache() {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, SNAPSHOT_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(SNAPSHOT_STORE).clear();
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

    // Example data link
    document.getElementById('loadExample')?.addEventListener('click', async (e) => {
      e.preventDefault();
      this.showProgress('Loading example data...');
      try {
        const resp = await fetch('example-data.zip');
        if (!resp.ok) throw new Error('Could not load example file');
        const blob = await resp.blob();
        const file = new File([blob], 'example-data.zip', { type: 'application/zip' });
        await this.processFile(file);
      } catch (err) {
        alert('Error loading example: ' + err.message);
        this.hideProgress();
      }
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
    await this.processFile(files[0]);
  }

  async processFile(file) {
    try {
      if (file.name.endsWith('.zip')) {
        this.updateProgress(20, 'Extracting ZIP...');
        const isWoWS = await this.analyzer.parseZip(file);
        if (!isWoWS) {
          alert('This doesn\'t look like a WoWS Legends data export. Please upload the correct ZIP file.');
          this.hideProgress();
          return;
        }
      } else {
        const text = await file.text();
        this.analyzer.parseCSVFiles([{ name: file.name, content: text }]);
      }

      this.updateProgress(50, 'Analyzing data...');
      const results = this.analyzer.analyze();

      this.updateProgress(70, 'Saving snapshot...');
      await saveSnapshot(results);
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

  async showDashboard(results) {
    document.getElementById('landing').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    this.hideProgress();

    // Clean up old charts
    if (this.dashboard) {
      Object.values(this.dashboard.charts).forEach(c => c.destroy?.());
    }

    const snapshots = await getSnapshots();
    this.dashboard = new Dashboard(results, snapshots);
    this.dashboard.render();
  }

  showLanding() {
    document.getElementById('landing').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    if (this.dashboard) {
      Object.values(this.dashboard.charts).forEach(c => c.destroy?.());
      this.dashboard = null;
    }
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => new App());
