// WoWS Legends Data Analyzer — parses export zip and computes insights

const BATTLE_TYPES = {
  1: { name: 'PvP (All)', group: 'pvp', aggregate: true },
  2: { name: 'Co-op (All)', group: 'coop', aggregate: true },
  3: { name: 'Standard (Solo)', group: 'pvp' },
  4: { name: 'Standard (Division)', group: 'pvp' },
  6: { name: 'Versus AI', group: 'coop' },
  9: { name: 'Ranked', group: 'competitive' },
  10: { name: 'Unknown (10)', group: 'other' },
  11: { name: 'Unknown (11)', group: 'other' },
  17: { name: 'Arena', group: 'competitive' },
  20: { name: 'Brawl', group: 'competitive' },
  23: { name: 'Arcade', group: 'other' },
  24: { name: 'Arcade', group: 'other' },
  28: { name: 'War Tales', group: 'other' },
};

// Synthetic aggregate: Standard = type 3 (solo) + type 4 (division)
const SYNTHETIC_TYPES = {
  'standard_all': { name: 'Standard', sources: [3, 4], group: 'pvp' },
};

const DISPLAY_BATTLE_TYPES = ['standard_all', 3, 4, 6, 9, 17, 20, 23, 28, 10, 11, 24];

const TIER_ORDER = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, '★': 9, '?': 0 };
function tierNum(t) { return TIER_ORDER[t] || 0; }

function resolveVehicle(internalName) {
  if (typeof VEHICLE_MAP !== 'undefined' && VEHICLE_MAP[internalName]) return VEHICLE_MAP[internalName];
  const m = internalName.match(/^([A-Z]{2})([A-Z]{2})\d+_(.+)$/);
  if (!m) return { name: internalName, nation: 'Unknown', class: 'Unknown', tier: '?', premium: false };
  const nm = { PA: 'U.S.A.', PJ: 'Japan', PG: 'Germany', PB: 'U.K.', PF: 'France', PI: 'Italy', PR: 'U.S.S.R.', PE: 'Europe', PZ: 'Pan-Asia', PX: 'Event', PU: 'Commonwealth', PT: 'Spain' };
  const cm = { SB: 'Battleship', SC: 'Cruiser', SD: 'Destroyer', SA: 'Carrier' };
  return { name: m[3].replace(/_/g, ' ').replace(/\s+\d{4}$/, ''), nation: nm[m[1]] || 'Unknown', class: cm[m[2]] || 'Unknown', tier: '?', premium: false };
}

class WoWSAnalyzer {
  constructor() {
    this.data = {};
    this.results = null;
  }

  async parseZip(file) {
    const zip = await JSZip.loadAsync(file);
    const csvFiles = {};

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.endsWith('.csv')) continue;
      const text = await entry.async('text');
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const key = path.split('/').pop().replace('.csv', '');
      csvFiles[key] = parsed.data;
    }

    this.data = csvFiles;
    return this.isWoWSExport();
  }

  parseCSVFiles(files) {
    for (const file of files) {
      const key = file.name.replace('.csv', '');
      const parsed = Papa.parse(file.content, { header: true, skipEmptyLines: true });
      this.data[key] = parsed.data;
    }
    return this.isWoWSExport();
  }

  isWoWSExport() {
    return !!(this.data['WOWSL_Ship_Statistics'] || this.data['WOWSL_Game_Sessions']);
  }

  analyze() {
    const r = {};
    r.career = this.analyzeCareer();
    r.ships = this.analyzeShips();
    r.trends = this.analyzeTrends();
    r.collection = this.analyzeCollection();
    r.records = this.analyzeRecords();
    this.results = r;
    return r;
  }

  analyzeCareer() {
    const bt = this.data['WOWSL_Battle_Types_Statistics'] || [];
    const acct = (this.data['WOWSL_Account_Statistics'] || [])[0] || {};
    const sessions = this.data['WOWSL_Game_Sessions'] || [];
    const info = (this.data['Account_Info'] || [])[0] || {};

    // Build per-mode stats
    const modeStats = {};

    for (const row of bt) {
      const type = parseInt(row.TYPE);
      if (BATTLE_TYPES[type]?.aggregate) continue;
      const battles = parseInt(row.BATTLES_COUNT) || 0;
      if (battles === 0) continue;
      const wins = parseInt(row.WINS) || 0;
      const frags = parseInt(row.FRAGS) || 0;
      const damage = parseInt(row.DAMAGE_DEALT) || 0;
      const survived = parseInt(row.SURVIVED) || 0;
      const shotsMain = parseInt(row.SHOTS_BY_MAIN) || 0;
      const hitsMain = parseInt(row.HITS_BY_MAIN) || 0;
      const shotsTorp = parseInt(row.SHOTS_BY_TPD) || 0;
      const hitsTorp = parseInt(row.HITS_BY_TPD) || 0;
      const deaths = battles - survived;

      modeStats[type] = {
        name: BATTLE_TYPES[type]?.name || `Type ${type}`,
        battles, wins, losses: parseInt(row.LOSSES) || 0, survived, frags, damage,
        planesKilled: parseInt(row.PLANES_KILLED) || 0,
        shotsMain, hitsMain, shotsTorp, hitsTorp,
        // Derived
        winRate: battles > 0 ? (wins / battles * 100) : 0,
        avgDamage: battles > 0 ? Math.round(damage / battles) : 0,
        kd: deaths > 0 ? (frags / deaths) : frags,
        survivalRate: battles > 0 ? (survived / battles * 100) : 0,
        mainAccuracy: shotsMain > 0 ? (hitsMain / shotsMain * 100) : 0,
        torpAccuracy: shotsTorp > 0 ? (hitsTorp / shotsTorp * 100) : 0,
      };
    }

    // Build synthetic aggregates (e.g., Standard = Solo + Division)
    for (const [key, def] of Object.entries(SYNTHETIC_TYPES)) {
      let battles = 0, wins = 0, losses = 0, frags = 0, damage = 0, survived = 0;
      let planesKilled = 0, shotsMain = 0, hitsMain = 0, shotsTorp = 0, hitsTorp = 0;
      for (const srcType of def.sources) {
        const s = modeStats[srcType];
        if (!s) continue;
        battles += s.battles; wins += s.wins; losses += (s.losses || 0); frags += s.frags;
        damage += s.damage; survived += s.survived; planesKilled += (s.planesKilled || 0);
        shotsMain += s.shotsMain; hitsMain += s.hitsMain; shotsTorp += s.shotsTorp; hitsTorp += s.hitsTorp;
      }
      if (battles > 0) {
        const deaths = battles - survived;
        modeStats[key] = {
          name: def.name, battles, wins, losses, survived, frags, damage, planesKilled,
          shotsMain, hitsMain, shotsTorp, hitsTorp,
          winRate: (wins / battles * 100),
          avgDamage: Math.round(damage / battles),
          kd: deaths > 0 ? (frags / deaths) : frags,
          survivalRate: (survived / battles * 100),
          mainAccuracy: shotsMain > 0 ? (hitsMain / shotsMain * 100) : 0,
          torpAccuracy: shotsTorp > 0 ? (hitsTorp / shotsTorp * 100) : 0,
        };
      }
    }

    // Compute "all modes" totals (exclude synthetic aggregates to avoid double-counting)
    let totalBattles = 0, totalWins = 0, totalFrags = 0, totalDamage = 0, totalSurvived = 0;
    let totalShotsMain = 0, totalHitsMain = 0, totalShotsTorp = 0, totalHitsTorp = 0;
    for (const [key, ms] of Object.entries(modeStats)) {
      if (SYNTHETIC_TYPES[key]) continue; // skip synthetic aggregates
      totalBattles += ms.battles; totalWins += ms.wins; totalFrags += ms.frags;
      totalDamage += ms.damage; totalSurvived += ms.survived;
      totalShotsMain += ms.shotsMain; totalHitsMain += ms.hitsMain;
      totalShotsTorp += ms.shotsTorp; totalHitsTorp += ms.hitsTorp;
    }
    const allDeaths = totalBattles - totalSurvived;

    // Store "all" as a synthetic mode entry
    modeStats['all'] = {
      name: 'All Modes', battles: totalBattles, wins: totalWins, frags: totalFrags,
      damage: totalDamage, survived: totalSurvived,
      shotsMain: totalShotsMain, hitsMain: totalHitsMain, shotsTorp: totalShotsTorp, hitsTorp: totalHitsTorp,
      winRate: totalBattles > 0 ? (totalWins / totalBattles * 100) : 0,
      avgDamage: totalBattles > 0 ? Math.round(totalDamage / totalBattles) : 0,
      kd: allDeaths > 0 ? (totalFrags / allDeaths) : totalFrags,
      survivalRate: totalBattles > 0 ? (totalSurvived / totalBattles * 100) : 0,
      mainAccuracy: totalShotsMain > 0 ? (totalHitsMain / totalShotsMain * 100) : 0,
      torpAccuracy: totalShotsTorp > 0 ? (totalHitsTorp / totalShotsTorp * 100) : 0,
    };

    // Session stats
    let totalPlayTimeMin = 0;
    let firstSession = null, lastSession = null;
    for (const s of sessions) {
      const start = new Date(s.STARTED_AT);
      const end = new Date(s.FINISHED_AT);
      if (!firstSession || start < firstSession) firstSession = start;
      if (!lastSession || end > lastSession) lastSession = end;
      totalPlayTimeMin += (end - start) / 60000;
    }

    return {
      gamertag: info.GAMERTAG || acct.NAME || 'Commander',
      totalPlayTimeHours: Math.round(totalPlayTimeMin / 60),
      totalSessions: sessions.length,
      avgSessionMin: sessions.length > 0 ? Math.round(totalPlayTimeMin / sessions.length) : 0,
      firstSession, lastSession,
      modeStats,
    };
  }

  analyzeShips() {
    const shipStats = this.data['WOWSL_Ship_Statistics'] || [];
    const shipByType = this.data['WOWSL_Ship_Statistics_By_Type'] || [];

    // Build per-ship aggregated stats (use non-aggregate types)
    const shipMap = {};

    for (const row of shipByType) {
      const type = parseInt(row.TYPE);
      if (BATTLE_TYPES[type]?.aggregate) continue;
      const vname = row.VEHICLE_NAME;
      const battles = parseInt(row.BATTLES_COUNT) || 0;
      if (battles === 0) continue;

      if (!shipMap[vname]) {
        const info = resolveVehicle(vname);
        shipMap[vname] = {
          internal: vname, ...info,
          battles: 0, wins: 0, losses: 0, survived: 0,
          frags: 0, damage: 0, planesKilled: 0,
          shotsMain: 0, hitsMain: 0, shotsTorp: 0, hitsTorp: 0,
          shotsAtba: 0, hitsAtba: 0,
          fragsByMain: 0, fragsByTorp: 0, fragsByAtba: 0, fragsByRam: 0,
          maxDamage: 0, maxFrags: 0, maxExp: 0,
          byMode: {},
        };
      }

      const s = shipMap[vname];
      s.battles += battles;
      s.wins += parseInt(row.WINS) || 0;
      s.losses += parseInt(row.LOSSES) || 0;
      s.survived += parseInt(row.SURVIVED) || 0;
      s.frags += parseInt(row.FRAGS) || 0;
      s.damage += parseInt(row.DAMAGE_DEALT) || 0;
      s.planesKilled += parseInt(row.PLANES_KILLED) || 0;
      s.shotsMain += parseInt(row.SHOTS_BY_MAIN) || 0;
      s.hitsMain += parseInt(row.HITS_BY_MAIN) || 0;
      s.shotsTorp += parseInt(row.SHOTS_BY_TPD) || 0;
      s.hitsTorp += parseInt(row.HITS_BY_TPD) || 0;
      s.shotsAtba += parseInt(row.SHOTS_BY_ATBA) || 0;
      s.hitsAtba += parseInt(row.HITS_BY_ATBA) || 0;
      s.fragsByMain += parseInt(row.FRAGS_BY_MAIN) || 0;
      s.fragsByTorp += parseInt(row.FRAGS_BY_TPD) || 0;
      s.fragsByAtba += parseInt(row.FRAGS_BY_ATBA) || 0;
      s.fragsByRam += parseInt(row.FRAGS_BY_RAM) || 0;
      s.maxDamage = Math.max(s.maxDamage, parseInt(row.MAX_DAMAGE_DEALT) || 0);
      s.maxFrags = Math.max(s.maxFrags, parseInt(row.MAX_FRAGS) || 0);
      s.maxExp = Math.max(s.maxExp, parseInt(row.MAX_EXP) || 0);

      // Per-mode breakdown
      if (!s.byMode[type]) {
        s.byMode[type] = { battles: 0, wins: 0, damage: 0, frags: 0, survived: 0, shotsMain: 0, hitsMain: 0, shotsTorp: 0, hitsTorp: 0, maxFrags: 0, maxDamage: 0, maxExp: 0 };
      }
      const m = s.byMode[type];
      m.battles += battles;
      m.wins += parseInt(row.WINS) || 0;
      m.damage += parseInt(row.DAMAGE_DEALT) || 0;
      m.frags += parseInt(row.FRAGS) || 0;
      m.survived += parseInt(row.SURVIVED) || 0;
      m.shotsMain += parseInt(row.SHOTS_BY_MAIN) || 0;
      m.hitsMain += parseInt(row.HITS_BY_MAIN) || 0;
      m.shotsTorp += parseInt(row.SHOTS_BY_TPD) || 0;
      m.hitsTorp += parseInt(row.HITS_BY_TPD) || 0;
      m.maxFrags = Math.max(m.maxFrags, parseInt(row.MAX_FRAGS) || 0);
      m.maxDamage = Math.max(m.maxDamage, parseInt(row.MAX_DAMAGE_DEALT) || 0);
      m.maxExp = Math.max(m.maxExp, parseInt(row.MAX_EXP) || 0);
    }

    // Merge in garage status from ship stats
    for (const row of shipStats) {
      const vname = row.VEHICLE_NAME;
      if (shipMap[vname]) {
        shipMap[vname].inGarage = row.IN_GARAGE === '1';
        shipMap[vname].lastBattle = row.LAST_BATTLE_TIME;
      }
    }

    // Compute derived stats
    const ships = Object.values(shipMap).map(s => {
      const deaths = s.battles - s.survived;
      return {
        ...s,
        winRate: s.battles > 0 ? (s.wins / s.battles * 100) : 0,
        avgDamage: s.battles > 0 ? Math.round(s.damage / s.battles) : 0,
        kd: deaths > 0 ? (s.frags / deaths) : s.frags,
        survivalRate: s.battles > 0 ? (s.survived / s.battles * 100) : 0,
        mainAccuracy: s.shotsMain > 0 ? (s.hitsMain / s.shotsMain * 100) : 0,
        torpAccuracy: s.shotsTorp > 0 ? (s.hitsTorp / s.shotsTorp * 100) : 0,
      };
    });

    ships.sort((a, b) => b.battles - a.battles);
    return ships;
  }

  analyzeTrends() {
    const sessions = this.data['WOWSL_Game_Sessions'] || [];

    // Monthly activity
    const monthly = {};
    const heatmap = {}; // day_hour -> count
    const durations = [];

    for (const s of sessions) {
      const start = new Date(s.STARTED_AT);
      const end = new Date(s.FINISHED_AT);
      const durMin = (end - start) / 60000;
      durations.push({ date: start, duration: durMin });

      const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      monthly[monthKey] = (monthly[monthKey] || 0) + 1;

      // Heatmap: day of week (0=Sun) x hour
      const day = start.getDay();
      const hour = start.getHours();
      const hk = `${day}_${hour}`;
      heatmap[hk] = (heatmap[hk] || 0) + 1;
    }

    // Sort monthly
    const monthlyArr = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));

    // Duration buckets
    const durationBuckets = { '< 30m': 0, '30m-1h': 0, '1-2h': 0, '2-3h': 0, '3-4h': 0, '4h+': 0 };
    for (const d of durations) {
      if (d.duration < 30) durationBuckets['< 30m']++;
      else if (d.duration < 60) durationBuckets['30m-1h']++;
      else if (d.duration < 120) durationBuckets['1-2h']++;
      else if (d.duration < 180) durationBuckets['2-3h']++;
      else if (d.duration < 240) durationBuckets['3-4h']++;
      else durationBuckets['4h+']++;
    }

    return { monthly: monthlyArr, heatmap, durationBuckets, durations };
  }

  analyzeCollection() {
    const shipStats = this.data['WOWSL_Ship_Statistics'] || [];
    const ships = [];

    for (const row of shipStats) {
      const info = resolveVehicle(row.VEHICLE_NAME);
      ships.push({
        internal: row.VEHICLE_NAME,
        ...info,
        inGarage: row.IN_GARAGE === '1',
        battles: parseInt(row.BATTLES_COUNT) || 0,
        lastBattle: row.LAST_BATTLE_TIME,
        distance: parseInt(row.DISTANCE) || 0,
        exp: parseInt(row.CURRENT_EXP) || 0,
      });
    }

    ships.sort((a, b) => tierNum(b.tier) - tierNum(a.tier) || a.name.localeCompare(b.name));

    const owned = ships.filter(s => s.inGarage).length;
    const played = ships.filter(s => s.battles > 0).length;
    const nations = new Set(ships.map(s => s.nation));
    const classes = new Set(ships.map(s => s.class));

    return { ships, owned, played, total: ships.length, nations: [...nations].sort(), classes: [...classes].sort() };
  }

  analyzeRecords() {
    const shipByType = this.data['WOWSL_Ship_Statistics_By_Type'] || [];
    // Records per battle type + 'all'
    const byMode = {};

    for (const row of shipByType) {
      const type = parseInt(row.TYPE);
      if (BATTLE_TYPES[type]?.aggregate) continue;
      const vname = row.VEHICLE_NAME;
      const info = resolveVehicle(vname);
      const shipName = info.name;

      const maxDmg = parseInt(row.MAX_DAMAGE_DEALT) || 0;
      const maxFrags = parseInt(row.MAX_FRAGS) || 0;
      const maxExp = parseInt(row.MAX_EXP) || 0;
      const maxPlanes = parseInt(row.MAX_PLANES_KILLED) || 0;

      // Update both per-type and 'all'
      for (const key of [type, 'all']) {
        if (!byMode[key]) byMode[key] = {};
        const rec = byMode[key];
        if (maxDmg > 0 && (!rec.maxDamage || maxDmg > rec.maxDamage.value)) {
          rec.maxDamage = { value: maxDmg, ship: shipName };
        }
        if (maxFrags > 0 && (!rec.maxFrags || maxFrags > rec.maxFrags.value)) {
          rec.maxFrags = { value: maxFrags, ship: shipName };
        }
        if (maxExp > 0 && (!rec.maxExp || maxExp > rec.maxExp.value)) {
          rec.maxExp = { value: maxExp, ship: shipName };
        }
        if (maxPlanes > 0 && (!rec.maxPlanes || maxPlanes > rec.maxPlanes.value)) {
          rec.maxPlanes = { value: maxPlanes, ship: shipName };
        }
      }
    }

    return byMode;
  }
}
