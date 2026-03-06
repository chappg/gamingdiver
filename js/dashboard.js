// Dashboard rendering — builds all charts and tables from analyzer results

const CHART_COLORS = {
  accent: '#00e5ff', accent2: '#00b0ff', dim: '#0088aa',
  green: '#4caf50', red: '#ef5350', orange: '#ff9800', purple: '#ab47bc',
  teal: '#26a69a', pink: '#ec407a', indigo: '#5c6bc0', lime: '#c0ca33',
};

Chart.defaults.color = '#8899aa';
Chart.defaults.borderColor = '#1e3a5f';

// Default battle mode: Standard (all = solo + division)
const DEFAULT_MODE = 'standard_all';

// Nation display order and labels (shared across all tabs)
// Use navy abbreviations familiar to WoWS players
// Flag icons via flag-icons CSS (works in all browsers, no emoji dependency)
const NATION_FLAGS = {
  'U.S.A.': 'us', 'Japan': 'jp', 'U.K.': 'gb', 'Germany': 'de',
  'France': 'fr', 'U.S.S.R.': null, 'Italy': 'it', 'Europe': 'eu',
  'Pan-Asia': 'cn', 'Commonwealth': 'au', 'Pan-America': 'br',
  'Netherlands': 'nl', 'Spain': 'es', 'Event': null,
};
function flagIcon(nation) {
  if (nation === 'U.S.S.R.') return `<img src="img/flags/ussr.svg" alt="USSR" class="flag-img" title="U.S.S.R.">`;
  if (nation === 'Event') return '🎪';
  const code = NATION_FLAGS[nation];
  if (!code) return '?';
  return `<span class="fi fi-${code}" title="${nation}"></span>`;
}
// Legacy compat — used in templates that expect a string
const NATION_ICONS = new Proxy({}, {
  get: (_, nation) => flagIcon(nation)
});
const NATION_ORDER = ['U.S.A.', 'Japan', 'U.K.', 'Germany', 'France', 'U.S.S.R.', 'Italy', 'Europe', 'Pan-Asia', 'Commonwealth', 'Pan-America', 'Netherlands', 'Spain', 'Event'];

// Premium ship recovery ticket costs (silver credits) by tier — via Wargaming support
const RECOVERY_COST = {
  'I': null, 'II': 1500000, 'III': 5625000, 'IV': 9375000,
  'V': 15000000, 'VI': 18750000, 'VII': 26250000, 'VIII': 37500000,
};

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
function pct(n) { return n.toFixed(1) + '%'; }
function wpct(n, battles) {
  if (battles >= 10000) return n.toFixed(3) + '%';
  if (battles >= 1000) return n.toFixed(2) + '%';
  return n.toFixed(1) + '%';
}
function fmtKd(kd, battles) {
  if (battles >= 1000) return kd.toFixed(3);
  return kd.toFixed(2);
}
function winClass(wr) {
  if (wr >= 55) return 'win-high';
  if (wr >= 50) return 'win-mid';
  return 'win-low';
}

class Dashboard {
  constructor(results, snapshots) {
    this.r = results;
    this.snapshots = snapshots || [];
    this.charts = {};
    this.shipSortCol = 'battles';
    this.shipSortDir = 'desc';
    this.currentOverviewMode = DEFAULT_MODE; // Standard by default
    this.currentShipMode = DEFAULT_MODE;
  }

  render() {
    try { this.renderOverview(); } catch(e) { console.error('renderOverview:', e); }
    try { this.renderShips(); } catch(e) { console.error('renderShips:', e); }
    try { this.renderTrends(); } catch(e) { console.error('renderTrends:', e); }
    try { this.renderCollection(); } catch(e) { console.error('renderCollection:', e); }
    this.setupTabs();
    this.setupFilters();
  }

  setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        Object.values(this.charts).forEach(c => c.resize?.());
        if (typeof trackEvent === 'function') trackEvent('tab-' + tab.dataset.tab);
      });
    });
  }

  // Build battle mode tabs HTML for a given container
  buildModeTabs(containerId, currentMode, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const modeStats = this.r.career.modeStats;
    
    // Build tabs: Standard (All) first, then Solo/Division, then other modes, then "All Modes"
    const modeOrder = ['standard_all', 3, 4, 9, 6, 17, 20, 23, 28, 'all'];
    const tabs = modeOrder.filter(m => modeStats[m] && modeStats[m].battles > 0);
    
    const modeName = (m) => {
      if (m === 'all') return 'All Modes';
      if (typeof m === 'string' && SYNTHETIC_TYPES[m]) return SYNTHETIC_TYPES[m].name;
      return BATTLE_TYPES[m]?.name || `Type ${m}`;
    };

    container.innerHTML = tabs.map(m => {
      const ms = modeStats[m];
      const active = (m == currentMode) ? 'active' : '';
      return `<button class="mode-tab ${active}" data-mode="${m}">${modeName(m)} <span class="mode-count">(${fmt(ms.battles)})</span></button>`;
    }).join('');

    container.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const raw = btn.dataset.mode;
        const mode = (raw === 'all' || isNaN(raw)) ? raw : parseInt(raw);
        onChange(mode);
      });
    });
  }

  // ---- OVERVIEW TAB ----
  renderOverview() {
    const c = this.r.career;
    document.getElementById('playerName').textContent = `${c.gamertag}'s Dashboard`;

    // Build mode tabs for overview
    this.buildModeTabs('overviewModeTabs', this.currentOverviewMode, (mode) => {
      this.currentOverviewMode = mode;
      this.refreshOverviewStats();
    });

    this.refreshOverviewStats();
    this.renderBattleModesChart(c.modeStats);
    this.renderCombatStyleChart();
  }

  refreshOverviewStats() {
    const c = this.r.career;
    const mode = this.currentOverviewMode;
    const ms = c.modeStats[mode];
    
    if (!ms) return;

    const cards = document.getElementById('overviewCards');
    cards.innerHTML = [
      this.statCard(fmt(ms.battles), 'Battles', mode === 'all' ? `${c.totalSessions} sessions` : ''),
      this.statCard(wpct(ms.winRate, ms.battles), 'Win Rate', `${fmt(ms.wins)} wins`, ms.winRate >= 50 ? 'good' : 'bad'),
      this.statCard(fmt(ms.avgDamage), 'Avg Damage', `${fmt(ms.damage)} total`),
      this.statCard(fmtKd(ms.kd, ms.battles), 'K/D Ratio', `${fmt(ms.frags)} kills`),
      this.statCard(pct(ms.survivalRate), 'Survival', ''),
      this.statCard(`${fmt(c.totalPlayTimeHours)}h`, 'Play Time', `~${c.avgSessionMin}m avg`),
      this.statCard(pct(ms.mainAccuracy), 'Main Acc.', ''),
      this.statCard(pct(ms.torpAccuracy), 'Torp Acc.', ''),
    ].join('');

    this.renderTopShips('battles');
    this.setupTopShipsToggle();
    this.renderRecords();
  }

  statCard(value, label, sub, cls = '') {
    return `<div class="stat-card ${cls}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div><div class="stat-sub">${sub}</div></div>`;
  }

  renderBattleModesChart(modeStats) {
    const entries = Object.entries(modeStats)
      .filter(([k]) => k !== 'all' && !SYNTHETIC_TYPES[k] && modeStats[k].battles > 0)
      .sort(([, a], [, b]) => b.battles - a.battles);
    const colors = [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.teal, CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.pink, CHART_COLORS.indigo, CHART_COLORS.lime, CHART_COLORS.red];

    if (this.charts.battleModes) this.charts.battleModes.destroy();
    this.charts.battleModes = new Chart(document.getElementById('chartBattleModes'), {
      type: 'doughnut',
      data: {
        labels: entries.map(([, v]) => v.name),
        datasets: [{ data: entries.map(([, v]) => v.battles), backgroundColor: colors.slice(0, entries.length), borderWidth: 0 }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { padding: 12, usePointStyle: true } },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const v = entries[ctx.dataIndex][1];
                return `Win Rate: ${wpct(v.winRate, v.battles)}`;
              }
            }
          }
        }
      }
    });
  }

  renderCombatStyleChart() {
    const mode = this.currentOverviewMode;
    // Get kill breakdown from ships filtered by mode
    let mainKills = 0, torpKills = 0, atbaKills = 0, ramKills = 0;
    const ships = this.r.ships || [];
    
    if (mode === 'all') {
      for (const s of ships) {
        mainKills += s.fragsByMain || 0;
        torpKills += s.fragsByTorp || 0;
        atbaKills += s.fragsByAtba || 0;
        ramKills += s.fragsByRam || 0;
      }
    } else {
      // Per-mode kill breakdown from byMode — we only have total frags per mode, 
      // not broken down by weapon. Use all-mode data as approximation.
      for (const s of ships) {
        mainKills += s.fragsByMain || 0;
        torpKills += s.fragsByTorp || 0;
        atbaKills += s.fragsByAtba || 0;
        ramKills += s.fragsByRam || 0;
      }
    }

    const data = [
      { label: 'Main Battery', value: mainKills, color: CHART_COLORS.accent },
      { label: 'Torpedoes', value: torpKills, color: CHART_COLORS.teal },
      { label: 'Secondary', value: atbaKills, color: CHART_COLORS.orange },
      { label: 'Ramming', value: ramKills, color: CHART_COLORS.red },
    ].filter(d => d.value > 0);

    if (this.charts.combatStyle) this.charts.combatStyle.destroy();
    this.charts.combatStyle = new Chart(document.getElementById('chartCombatStyle'), {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.label),
        datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderWidth: 0 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right', labels: { padding: 12, usePointStyle: true } } }
      }
    });
  }

  renderRecords() {
    const mode = this.currentOverviewMode;
    const recByMode = this.r.records;
    // For synthetic modes, merge records from source types
    let rec;
    if (typeof mode === 'string' && SYNTHETIC_TYPES[mode]) {
      rec = {};
      for (const srcType of SYNTHETIC_TYPES[mode].sources) {
        const srcRec = recByMode[srcType];
        if (!srcRec) continue;
        for (const field of ['maxDamage', 'maxFrags', 'maxExp', 'maxPlanes']) {
          if (srcRec[field] && (!rec[field] || srcRec[field].value > rec[field].value)) {
            rec[field] = srcRec[field];
          }
        }
      }
    } else {
      rec = recByMode[mode] || recByMode['all'] || {};
    }
    const grid = document.getElementById('recordsGrid');
    const cards = [];
    if (rec.maxDamage) cards.push(this.recordCard(fmt(rec.maxDamage.value), 'Max Damage', rec.maxDamage.ship));
    if (rec.maxFrags) cards.push(this.recordCard(rec.maxFrags.value, 'Max Kills', rec.maxFrags.ship));
    if (rec.maxExp) cards.push(this.recordCard(fmt(rec.maxExp.value), 'Max XP', rec.maxExp.ship));
    if (rec.maxPlanes) cards.push(this.recordCard(rec.maxPlanes.value, 'Max Planes Shot', rec.maxPlanes.ship));
    grid.innerHTML = cards.join('');
  }

  recordCard(value, label, ship) {
    return `<div class="record-card"><div class="record-value">${value}</div><div class="record-label">${label}</div><div class="record-ship">${ship}</div></div>`;
  }

  setupTopShipsToggle() {
    this.currentTopMetric = 'battles';
    this.topFilterNation = '';
    this.topFilterTier = '';
    this.topFilterType = '';
    this.shipFilterNation = '';
    this.shipFilterTier = '';
    this.shipFilterClass = '';
    this.shipFilterType = '';
    this.collFilterNation = '';
    this.collFilterTier = '';
    this.collFilterClass = '';
    this.collFilterType = '';

    // Build nation icons
    const ships = this.r.ships;
    const nationSet = new Set(ships.map(s => s.nation));
    const nations = NATION_ORDER.filter(n => nationSet.has(n));
    const nationContainer = document.getElementById('topNationIcons');
    nationContainer.innerHTML = `<button class="nation-btn active" data-nation="" title="All Nations">ALL</button>` +
      nations.map(n => `<button class="nation-btn" data-nation="${n}" title="${n}">${NATION_ICONS[n] || '?'}</button>`).join('');

    nationContainer.querySelectorAll('.nation-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        nationContainer.querySelectorAll('.nation-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.topFilterNation = btn.dataset.nation;
        this.renderTopShips();
      });
    });

    // Build tier buttons
    const tiers = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', '★'];
    const tierContainer = document.getElementById('topTierButtons');
    tierContainer.innerHTML = `<button class="tier-btn active" data-tier="">All</button>` +
      tiers.map(t => `<button class="tier-btn" data-tier="${t}">${t}</button>`).join('');

    tierContainer.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tierContainer.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.topFilterTier = btn.dataset.tier;
        this.renderTopShips();
      });
    });

    // Type buttons (All / Tech Tree / Premium)
    document.querySelectorAll('#topTypeButtons .tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#topTypeButtons .tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.topFilterType = btn.dataset.type;
        this.renderTopShips();
      });
    });

    // Metric toggle buttons
    document.querySelectorAll('#topShipsToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#topShipsToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTopMetric = btn.dataset.metric;
        this.renderTopShips();
      });
    });
  }

  renderTopShips() {
    const metric = this.currentTopMetric || 'battles';
    const mode = this.currentOverviewMode;
    const modeBattles = this.r.career.modeStats[mode]?.battles || 0;
    const minBattles = modeBattles < 1000 ? 1 : 10;
    const filterNation = this.topFilterNation || '';
    const filterTier = this.topFilterTier || '';
    const filterType = this.topFilterType || '';

    // Get ship stats for current mode (handle synthetic types like 'standard_all')
    const sourceKeys = (typeof mode === 'string' && SYNTHETIC_TYPES[mode])
      ? SYNTHETIC_TYPES[mode].sources
      : (mode !== 'all' ? [typeof mode === 'string' ? parseInt(mode) : mode] : null);

    let eligible;
    if (!sourceKeys) {
      // "all" mode — use top-level ship stats
      eligible = this.r.ships.filter(s => s.battles >= minBattles);
    } else {
      eligible = this.r.ships.filter(s => sourceKeys.some(k => s.byMode[k] && s.byMode[k].battles > 0)).map(s => {
        let battles = 0, wins = 0, damage = 0, frags = 0, survived = 0, maxFrags = 0;
        for (const k of sourceKeys) {
          const d = s.byMode[k];
          if (!d) continue;
          battles += d.battles; wins += d.wins; damage += d.damage; frags += d.frags; survived += d.survived;
          if ((d.maxFrags || 0) > maxFrags) maxFrags = d.maxFrags || 0;
        }
        const deaths = battles - survived;
        return {
          ...s, battles, wins, damage, frags, survived, maxFrags,
          winRate: battles > 0 ? (wins / battles * 100) : 0,
          avgDamage: battles > 0 ? Math.round(damage / battles) : 0,
          kd: deaths > 0 ? (frags / deaths) : frags,
        };
      }).filter(s => s.battles >= minBattles);
    }

    // Apply nation/tier/type filters
    if (filterNation) eligible = eligible.filter(s => s.nation === filterNation);
    if (filterTier) eligible = eligible.filter(s => s.tier === filterTier);
    if (filterType === 'tech') eligible = eligible.filter(s => !s.premium);
    if (filterType === 'premium') eligible = eligible.filter(s => s.premium);

    let sorted, valFn, label;
    switch (metric) {
      case 'winRate':
        sorted = [...eligible].sort((a, b) => b.winRate - a.winRate);
        valFn = s => wpct(s.winRate, s.battles); label = 'Win %'; break;
      case 'lowestWinRate':
        sorted = [...eligible].sort((a, b) => a.winRate - b.winRate);
        valFn = s => wpct(s.winRate, s.battles); label = 'Win %'; break;
      case 'avgDamage':
        sorted = [...eligible].sort((a, b) => b.avgDamage - a.avgDamage);
        valFn = s => fmt(s.avgDamage); label = 'Avg Dmg'; break;
      case 'lowestDamage':
        sorted = [...eligible].sort((a, b) => a.avgDamage - b.avgDamage);
        valFn = s => fmt(s.avgDamage); label = 'Avg Dmg'; break;
      case 'kd':
        sorted = [...eligible].sort((a, b) => b.kd - a.kd);
        valFn = s => fmtKd(s.kd, s.battles); label = 'K/D'; break;
      case 'maxFrags':
        sorted = [...eligible].sort((a, b) => b.maxFrags - a.maxFrags);
        valFn = s => s.maxFrags.toString(); label = 'Max Kills'; break;
      case 'leastBattles':
        sorted = [...eligible].sort((a, b) => a.battles - b.battles);
        valFn = s => s.battles.toLocaleString(); label = 'Battles'; break;
      default:
        sorted = [...eligible].sort((a, b) => b.battles - a.battles);
        valFn = s => s.battles.toLocaleString(); label = 'Battles'; break;
    }

    const isBottom = ['lowestWinRate', 'lowestDamage', 'leastBattles'].includes(metric);
    const top10 = sorted.slice(0, 10);
    const grid = document.getElementById('topShipsGrid');
    grid.innerHTML = top10.map((s, i) => {
      const rankCls = isBottom ? '' : (i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '');
      return `
        <div class="top-ship-card">
          <div class="top-ship-rank ${rankCls}">${i + 1}</div>
          <div class="top-ship-info">
            <div class="top-ship-name"><span class="tier-badge">${s.tier}</span>${s.name}${s.premium ? ' ★' : ''}</div>
            <div class="top-ship-meta">${flagIcon(s.nation)} ${s.nation} • ${s.class} • ${s.battles} battles</div>
          </div>
          <div class="top-ship-stat">
            <div class="ts-val">${valFn(s)}</div>
            <div class="ts-label">${label}</div>
          </div>
        </div>`;
    }).join('') || '<div style="padding:16px;color:var(--text-dim)">No ships match these filters</div>';
  }

  // ---- SHIPS TAB ----
  renderShips() {
    this.populateShipFilters();

    // Mode tabs for ships tab
    this.buildModeTabs('shipModeTabs', this.currentShipMode, (mode) => {
      this.currentShipMode = mode;
      // Auto-adjust min battles based on mode's total games
      const modeBattles = this.r.career.modeStats[mode]?.battles || 0;
      const input = document.getElementById('filterMinBattles');
      if (input) input.value = modeBattles < 1000 ? '1' : '10';
      this.renderShipTable();
    });

    // Set initial min battles based on default mode
    const initModeBattles = this.r.career.modeStats[this.currentShipMode]?.battles || 0;
    const initInput = document.getElementById('filterMinBattles');
    if (initInput) initInput.value = initModeBattles < 1000 ? '1' : '10';

    this.renderShipTable();

    document.querySelectorAll('#shipTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this.shipSortCol === col) {
          this.shipSortDir = this.shipSortDir === 'desc' ? 'asc' : 'desc';
        } else {
          this.shipSortCol = col;
          this.shipSortDir = 'desc';
        }
        this.renderShipTable();
      });
    });
  }

  populateShipFilters() {
    const ships = this.r.ships;

    // Build nation icons
    const nationSet = new Set(ships.map(s => s.nation));
    const nations = NATION_ORDER.filter(n => nationSet.has(n));
    const iconBox = document.getElementById('shipNationIcons');
    iconBox.innerHTML = `<span class="nation-icon active" data-nation="" title="All Nations">ALL</span>` +
      nations.map(n => `<span class="nation-icon" data-nation="${n}" title="${n}">${NATION_ICONS[n] || '?'}</span>`).join('');
    iconBox.querySelectorAll('.nation-icon').forEach(icon => {
      icon.addEventListener('click', () => {
        iconBox.querySelectorAll('.nation-icon').forEach(i => i.classList.remove('active'));
        icon.classList.add('active');
        this.shipFilterNation = icon.dataset.nation;
        this.renderShipTable();
      });
    });

    // Build tier buttons
    const tierSet = new Set();
    ships.forEach(s => { if (s.tier && s.tier !== '?') tierSet.add(s.tier); });
    const tiers = [...tierSet].sort((a, b) => tierNum(a) - tierNum(b));
    const tierBox = document.getElementById('shipTierButtons');
    tierBox.innerHTML = `<button class="tier-btn active" data-tier="">All</button>` +
      tiers.map(t => `<button class="tier-btn" data-tier="${t}">${t}</button>`).join('');
    tierBox.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tierBox.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.shipFilterTier = btn.dataset.tier;
        this.renderShipTable();
      });
    });

    // Build class buttons
    const CLASS_ICONS = { 'Battleship': '⚓', 'Cruiser': '🛡️', 'Destroyer': '💨', 'Carrier': '✈️' };
    const classes = [...new Set(ships.map(s => s.class))].sort();
    const classBox = document.getElementById('shipClassButtons');
    classBox.innerHTML = `<button class="tier-btn active" data-class="">All</button>` +
      classes.map(c => `<button class="tier-btn" data-class="${c}">${CLASS_ICONS[c] || ''} ${c}</button>`).join('');
    classBox.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        classBox.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.shipFilterClass = btn.dataset.class;
        this.renderShipTable();
      });
    });

    // Type buttons
    document.querySelectorAll('#shipTypeButtons .tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#shipTypeButtons .tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.shipFilterType = btn.dataset.type;
        this.renderShipTable();
      });
    });

    // Min battles — lower default for modes with <1000 games
    const minBattlesInput = document.getElementById('filterMinBattles');
    if (minBattlesInput) {
      minBattlesInput.addEventListener('change', () => this.renderShipTable());
    }
  }

  setupFilters() {
    // Collection filters
    document.getElementById('collFilterOwned')?.addEventListener('change', () => this.renderCollectionGrid());
  }

  getFilteredShips() {
    const nation = this.shipFilterNation || '';
    const cls = this.shipFilterClass || '';
    const tier = this.shipFilterTier || '';
    const type = this.shipFilterType || '';
    const minB = parseInt(document.getElementById('filterMinBattles').value) || 1;
    const mode = this.currentShipMode;

    let ships = this.r.ships;
    if (nation) ships = ships.filter(s => s.nation === nation);
    if (cls) ships = ships.filter(s => s.class === cls);
    if (tier) ships = ships.filter(s => s.tier === tier);
    if (type === 'tech') ships = ships.filter(s => !s.premium);
    if (type === 'premium') ships = ships.filter(s => s.premium);

    // Apply mode filter
    if (mode !== 'all') {
      // Determine which raw mode keys to merge for this tab
      const sourceKeys = (typeof mode === 'string' && SYNTHETIC_TYPES[mode])
        ? SYNTHETIC_TYPES[mode].sources
        : [typeof mode === 'string' ? parseInt(mode) : mode];

      ships = ships.filter(s => sourceKeys.some(k => s.byMode[k] && s.byMode[k].battles > 0)).map(s => {
        // Merge stats from all source modes
        let battles = 0, wins = 0, damage = 0, frags = 0, survived = 0;
        let shotsMain = 0, hitsMain = 0, shotsTorp = 0, hitsTorp = 0;
        for (const k of sourceKeys) {
          const d = s.byMode[k];
          if (!d) continue;
          battles += d.battles; wins += d.wins; damage += d.damage; frags += d.frags; survived += d.survived;
          shotsMain += (d.shotsMain || 0); hitsMain += (d.hitsMain || 0);
          shotsTorp += (d.shotsTorp || 0); hitsTorp += (d.hitsTorp || 0);
        }
        const deaths = battles - survived;
        return {
          ...s,
          battles, wins, damage, frags, survived,
          winRate: battles > 0 ? (wins / battles * 100) : 0,
          avgDamage: battles > 0 ? Math.round(damage / battles) : 0,
          kd: deaths > 0 ? (frags / deaths) : frags,
          survivalRate: battles > 0 ? (survived / battles * 100) : 0,
          mainAccuracy: shotsMain > 0 ? (hitsMain / shotsMain * 100) : 0,
          torpAccuracy: shotsTorp > 0 ? (hitsTorp / shotsTorp * 100) : 0,
          shotsTorp,
        };
      });
    }

    ships = ships.filter(s => s.battles >= minB);

    // Sort
    const col = this.shipSortCol;
    const dir = this.shipSortDir === 'desc' ? -1 : 1;
    ships.sort((a, b) => {
      let va = a[col], vb = b[col];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va || 0) - (vb || 0)) * dir;
    });

    return ships;
  }

  renderShipTable() {
    const ships = this.getFilteredShips();
    const tbody = document.getElementById('shipTableBody');

    document.querySelectorAll('#shipTable th').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === this.shipSortCol) {
        th.classList.add(this.shipSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });

    tbody.innerHTML = ships.map(s => `
      <tr>
        <td><span class="tier-badge">${s.tier}</span>${s.name}${s.premium ? ' ★' : ''}</td>
        <td>${flagIcon(s.nation)} ${s.nation}</td>
        <td>${s.class}</td>
        <td class="num">${s.battles.toLocaleString()}</td>
        <td class="num ${winClass(s.winRate)}">${wpct(s.winRate, s.battles)}</td>
        <td class="num">${s.avgDamage.toLocaleString()}</td>
        <td class="num">${fmtKd(s.kd, s.battles)}</td>
        <td class="num">${pct(s.survivalRate)}</td>
        <td class="num">${pct(s.mainAccuracy)}</td>
        <td class="num">${(s.shotsTorp || 0) > 0 ? pct(s.torpAccuracy) : '-'}</td>
      </tr>
    `).join('');

    // Update count
    const countEl = document.getElementById('shipCount');
    if (countEl) countEl.textContent = `${ships.length} ships`;
  }

  // ---- TRENDS TAB ----
  renderTrends() {
    this.renderSnapshotTrends();
    this.renderMonthlyChart();
    this.renderHeatmap();
    this.renderSessionDuration();
  }

  renderSnapshotTrends() {
    const container = document.getElementById('snapshotTrends');
    const snaps = this.snapshots;

    if (snaps.length < 2) {
      const count = snaps.length;
      container.innerHTML = `
        <div class="snapshot-notice">
          <h3>📈 Performance Trends</h3>
          <p>${count === 0 ? 'Upload your data export to create your first snapshot.' :
            'You have 1 snapshot so far. Upload again after playing more battles to start tracking trends!'}</p>
          <p class="hint">Each time you upload a new data export, GamingDiver saves a snapshot. The deltas between snapshots show how your stats are trending over time.</p>
        </div>`;
      return;
    }

    // Compute deltas between consecutive snapshots
    const periods = [];
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i - 1];
      const curr = snaps[i];
      const mode = String(DEFAULT_MODE); // Standard

      const pm = prev.modeStats[mode] || prev.modeStats['all'];
      const cm = curr.modeStats[mode] || curr.modeStats['all'];
      if (!pm || !cm) continue;

      const dBattles = cm.battles - pm.battles;
      if (dBattles <= 0) continue; // no new battles

      const dWins = cm.wins - pm.wins;
      const dFrags = cm.frags - pm.frags;
      const dDeaths = (cm.battles - cm.survived) - (pm.battles - pm.survived);
      const dDamage = cm.damage - pm.damage;

      periods.push({
        from: new Date(prev.timestamp),
        to: new Date(curr.timestamp),
        battles: dBattles,
        winRate: dBattles > 0 ? (dWins / dBattles * 100) : 0,
        kd: dDeaths > 0 ? (dFrags / dDeaths) : dFrags,
        avgDamage: dBattles > 0 ? Math.round(dDamage / dBattles) : 0,
        avgFrags: dBattles > 0 ? (dFrags / dBattles) : 0,
      });
    }

    if (periods.length === 0) {
      container.innerHTML = `
        <div class="snapshot-notice">
          <h3>📈 Performance Trends</h3>
          <p>No new battles detected between snapshots. Play some games and upload a fresh export!</p>
        </div>`;
      return;
    }

    // Format date as "Mar 4"
    const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
    const labels = periods.map((p, i) => i === 0 ? fmtDate(p.from) + ' → ' + fmtDate(p.to) : fmtDate(p.to));

    // Trend arrow
    const trend = (vals) => {
      if (vals.length < 2) return '';
      const last = vals[vals.length - 1], prev = vals[vals.length - 2];
      if (last > prev) return ' <span class="trend-up">▲</span>';
      if (last < prev) return ' <span class="trend-down">▼</span>';
      return ' <span class="trend-flat">▸</span>';
    };

    const wrVals = periods.map(p => p.winRate);
    const kdVals = periods.map(p => p.kd);
    const dmgVals = periods.map(p => p.avgDamage);

    // Latest period summary
    const latest = periods[periods.length - 1];
    const prevP = periods.length >= 2 ? periods[periods.length - 2] : null;

    const delta = (curr, prev, fmt, suffix = '') => {
      if (!prev) return '';
      const d = curr - prev;
      const cls = d > 0 ? 'trend-up' : d < 0 ? 'trend-down' : 'trend-flat';
      const sign = d > 0 ? '+' : '';
      return `<span class="${cls}">${sign}${fmt(d)}${suffix}</span>`;
    };

    container.innerHTML = `
      <div class="snapshot-summary">
        <h3>📈 Performance Trends <span class="snapshot-count">(${snaps.length} snapshots)</span></h3>
        <div class="snapshot-latest">
          <div class="snapshot-period">Latest: ${fmtDate(latest.from)} → ${fmtDate(latest.to)} · ${latest.battles} battles</div>
          <div class="stat-cards">
            ${this.statCard(wpct(latest.winRate, latest.battles), 'Win Rate' + trend(wrVals),
              prevP ? delta(latest.winRate, prevP.winRate, n => n.toFixed(2), '%') : '')}
            ${this.statCard(fmtKd(latest.kd, latest.battles), 'K/D Ratio' + trend(kdVals),
              prevP ? delta(latest.kd, prevP.kd, n => n.toFixed(3)) : '')}
            ${this.statCard(fmt(latest.avgDamage), 'Avg Damage' + trend(dmgVals),
              prevP ? delta(latest.avgDamage, prevP.avgDamage, n => fmt(Math.round(n))) : '')}
            ${this.statCard(latest.avgFrags.toFixed(2), 'Avg Kills', '')}
          </div>
        </div>
      </div>
      <div class="chart-row">
        <div class="chart-box">
          <h3>Win Rate Over Time</h3>
          <canvas id="chartTrendWR"></canvas>
        </div>
        <div class="chart-box">
          <h3>K/D Ratio Over Time</h3>
          <canvas id="chartTrendKD"></canvas>
        </div>
      </div>
      <div class="chart-row">
        <div class="chart-box">
          <h3>Avg Damage Over Time</h3>
          <canvas id="chartTrendDmg"></canvas>
        </div>
        <div class="chart-box">
          <h3>Battles Per Period</h3>
          <canvas id="chartTrendBattles"></canvas>
        </div>
      </div>`;

    // Render charts
    const chartOpts = (label, color, data, yFmt) => ({
      type: 'line',
      data: {
        labels,
        datasets: [{
          label, data,
          borderColor: color, backgroundColor: color + '30',
          fill: true, tension: 0.3, pointRadius: 5, pointHoverRadius: 8,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 45 } },
          y: { ...(yFmt || {}) }
        }
      }
    });

    this.charts.trendWR = new Chart(document.getElementById('chartTrendWR'),
      chartOpts('Win Rate %', CHART_COLORS.green, wrVals, { min: Math.max(0, Math.min(...wrVals) - 5), max: Math.min(100, Math.max(...wrVals) + 5) }));
    this.charts.trendKD = new Chart(document.getElementById('chartTrendKD'),
      chartOpts('K/D', CHART_COLORS.accent, kdVals, { min: Math.max(0, Math.min(...kdVals) - 0.3) }));
    this.charts.trendDmg = new Chart(document.getElementById('chartTrendDmg'),
      chartOpts('Avg Damage', CHART_COLORS.orange, dmgVals, { beginAtZero: false }));
    this.charts.trendBattles = new Chart(document.getElementById('chartTrendBattles'),
      chartOpts('Battles', CHART_COLORS.purple, periods.map(p => p.battles), { beginAtZero: true }));
  }

  renderMonthlyChart() {
    const data = this.r.trends.monthly;
    this.charts.monthly = new Chart(document.getElementById('chartMonthly'), {
      type: 'bar',
      data: {
        labels: data.map(([k]) => k),
        datasets: [{
          label: 'Sessions',
          data: data.map(([, v]) => v),
          backgroundColor: CHART_COLORS.accent + '80',
          borderColor: CHART_COLORS.accent,
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 24 } },
          y: { beginAtZero: true, title: { display: true, text: 'Sessions' } }
        }
      }
    });
  }

  heatmapColor(intensity) {
    if (intensity <= 0) return null;
    const stops = [
      { t: 0, r: 13, g: 42, b: 68 },
      { t: 0.25, r: 0, g: 105, b: 120 },
      { t: 0.5, r: 0, g: 180, b: 200 },
      { t: 0.75, r: 0, g: 229, b: 255 },
      { t: 1, r: 120, g: 255, b: 230 },
    ];
    const t = Math.min(intensity, 1);
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].t && t <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const f = (hi.t - lo.t) > 0 ? (t - lo.t) / (hi.t - lo.t) : 0;
    const r = Math.round(lo.r + (hi.r - lo.r) * f);
    const g = Math.round(lo.g + (hi.g - lo.g) * f);
    const b = Math.round(lo.b + (hi.b - lo.b) * f);
    return `rgb(${r},${g},${b})`;
  }

  renderHeatmap() {
    const hm = this.r.trends.heatmap;
    const container = document.getElementById('heatmapContainer');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (Object.keys(hm).length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">No session data</div>';
      return;
    }

    let maxVal = 0;
    for (const v of Object.values(hm)) maxVal = Math.max(maxVal, v);

    let html = '<div class="heatmap-header"></div>';
    days.forEach(d => html += `<div class="heatmap-header">${d}</div>`);

    for (let h = 0; h < 24; h++) {
      const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      html += `<div class="heatmap-label">${label}</div>`;
      for (let d = 0; d < 7; d++) {
        const val = hm[`${d}_${h}`] || 0;
        const intensity = maxVal > 0 ? val / maxVal : 0;
        const color = this.heatmapColor(intensity);
        const bg = color ? `background:${color}` : '';
        const cls = val === 0 ? ' empty' : '';
        html += `<div class="heatmap-cell${cls}" style="${bg}" title="${days[d]} ${label}: ${val} sessions">${val || ''}</div>`;
      }
    }

    html += '<div class="heatmap-legend"><span class="heatmap-legend-label">Less</span><div class="heatmap-legend-bar">';
    for (let i = 0; i <= 4; i++) {
      const c = this.heatmapColor(i / 4) || 'rgba(255,255,255,0.02)';
      html += `<span style="background:${c}"></span>`;
    }
    html += '</div><span class="heatmap-legend-label">More</span></div>';
    container.innerHTML = html;
  }

  renderSessionDuration() {
    const buckets = this.r.trends.durationBuckets;
    this.charts.duration = new Chart(document.getElementById('chartSessionDuration'), {
      type: 'bar',
      data: {
        labels: Object.keys(buckets),
        datasets: [{
          label: 'Sessions',
          data: Object.values(buckets),
          backgroundColor: [CHART_COLORS.teal, CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.red],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // ---- COLLECTION TAB ----
  computeCompletion(ships) {
    // Merge VEHICLE_MAP ships into the collection if not already present
    if (typeof VEHICLE_MAP !== 'undefined') {
      const known = new Set(ships.map(s => s.internal));
      for (const [internal, info] of Object.entries(VEHICLE_MAP)) {
        if (!known.has(internal) && info.nation !== 'Event') {
          ships.push({
            internal, ...info,
            inGarage: false, battles: 0, lastBattle: null, distance: 0, exp: 0,
          });
        }
      }
    }

    // Exclude Event ships from completion (temporary game mode clones)
    ships = ships.filter(s => s.nation !== 'Event');

    // Mark sold ships: premium, not in garage, has battle record, not a rental
    for (const s of ships) {
      const isRental = /rental/i.test(s.name) || /rental/i.test(s.internal);
      s.sold = s.premium && !s.inGarage && s.battles > 0 && !isRental;
      s.recoveryCost = s.sold ? (RECOVERY_COST[s.tier] || null) : null;
    }

    const owned = ships.filter(s => s.inGarage).length;
    const sold = ships.filter(s => s.sold);
    const totalRecoveryCost = sold.reduce((sum, s) => sum + (s.recoveryCost || 0), 0);
    const techTree = ships.filter(s => !s.premium);
    const premiums = ships.filter(s => s.premium);
    const completion = {
      all: { owned, total: ships.length },
      techTree: { owned: techTree.filter(s => s.inGarage).length, total: techTree.length },
      premium: { owned: premiums.filter(s => s.inGarage).length, total: premiums.length },
      sold: { count: sold.length, totalCost: totalRecoveryCost },
      byNation: {},
    };
    const nations = [...new Set(ships.map(s => s.nation))].sort();
    for (const nation of nations) {
      const nShips = ships.filter(s => s.nation === nation);
      const nTech = nShips.filter(s => !s.premium);
      const nPrem = nShips.filter(s => s.premium);
      completion.byNation[nation] = {
        all: { owned: nShips.filter(s => s.inGarage).length, total: nShips.length },
        techTree: { owned: nTech.filter(s => s.inGarage).length, total: nTech.length },
        premium: { owned: nPrem.filter(s => s.inGarage).length, total: nPrem.length },
      };
    }
    return completion;
  }

  renderCollection() {
    const coll = this.r.collection;
    // Recompute completion from ships array (handles old cached data without completion field)
    const c = this.computeCompletion(coll.ships);
    const pct = (o, t) => t > 0 ? Math.round(o / t * 100) : 0;

    const statsEl = document.getElementById('collectionStats');
    const soldStats = c.sold.count > 0
      ? `<div class="collection-stat sold-stat"><span class="cs-num">${c.sold.count}</span><span class="cs-label">Sold (${fmt(c.sold.totalCost)} 🪙 to recover)</span></div>`
      : '';
    statsEl.innerHTML = [
      `<div class="collection-stat"><span class="cs-num">${pct(c.all.owned, c.all.total)}%</span><span class="cs-label">Complete (${c.all.owned}/${c.all.total})</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${pct(c.techTree.owned, c.techTree.total)}%</span><span class="cs-label">Tech Tree (${c.techTree.owned}/${c.techTree.total})</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${pct(c.premium.owned, c.premium.total)}%</span><span class="cs-label">Premium (${c.premium.owned}/${c.premium.total})</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.played}</span><span class="cs-label">Ships Played</span></div>`,
      soldStats,
    ].join('');

    // Per-nation completion bars
    const nationEl = document.getElementById('collectionNationCompletion');
    if (nationEl) nationEl.remove();
    const nationDiv = document.createElement('div');
    nationDiv.id = 'collectionNationCompletion';
    nationDiv.className = 'nation-completion';
    const nationRows = NATION_ORDER.filter(n => c.byNation[n]).map(n => {
      const nd = c.byNation[n];
      const allPct = pct(nd.all.owned, nd.all.total);
      const techPct = pct(nd.techTree.owned, nd.techTree.total);
      const premPct = pct(nd.premium.owned, nd.premium.total);
      const full = allPct === 100 ? ' full' : '';
      return `<div class="nc-row${full}">
        <span class="nc-flag">${NATION_ICONS[n] || '?'}</span>
        <span class="nc-name">${n}</span>
        <span class="nc-bar-wrap"><span class="nc-bar" style="width:${allPct}%"></span></span>
        <span class="nc-pct">${allPct}%</span>
        <span class="nc-detail">TT ${nd.techTree.owned}/${nd.techTree.total} · P ${nd.premium.owned}/${nd.premium.total}</span>
      </div>`;
    });
    nationDiv.innerHTML = `<h3>Completion by Nation</h3>` + nationRows.join('');
    statsEl.parentNode.insertBefore(nationDiv, statsEl.nextSibling);

    this.populateCollectionFilters();
    this.renderCollectionGrid();
  }

  populateCollectionFilters() {
    const ships = this.r.collection.ships;

    // Nation icons
    const nationSet = new Set(ships.map(s => s.nation));
    const nations = NATION_ORDER.filter(n => nationSet.has(n));
    const iconBox = document.getElementById('collNationIcons');
    iconBox.innerHTML = `<span class="nation-icon active" data-nation="" title="All Nations">ALL</span>` +
      nations.map(n => `<span class="nation-icon" data-nation="${n}" title="${n}">${NATION_ICONS[n] || '?'}</span>`).join('');
    iconBox.querySelectorAll('.nation-icon').forEach(icon => {
      icon.addEventListener('click', () => {
        iconBox.querySelectorAll('.nation-icon').forEach(i => i.classList.remove('active'));
        icon.classList.add('active');
        this.collFilterNation = icon.dataset.nation;
        this.renderCollectionGrid();
      });
    });

    // Tier buttons
    const tierSet = new Set();
    ships.forEach(s => { if (s.tier && s.tier !== '?') tierSet.add(s.tier); });
    const tiers = [...tierSet].sort((a, b) => tierNum(a) - tierNum(b));
    const tierBox = document.getElementById('collTierButtons');
    tierBox.innerHTML = `<button class="tier-btn active" data-tier="">All</button>` +
      tiers.map(t => `<button class="tier-btn" data-tier="${t}">${t}</button>`).join('');
    tierBox.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tierBox.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.collFilterTier = btn.dataset.tier;
        this.renderCollectionGrid();
      });
    });

    // Class buttons
    const CLASS_ICONS = { 'Battleship': '⚓', 'Cruiser': '🛡️', 'Destroyer': '💨', 'Carrier': '✈️' };
    const classes = [...new Set(ships.map(s => s.class))].sort();
    const classBox = document.getElementById('collClassButtons');
    classBox.innerHTML = `<button class="tier-btn active" data-class="">All</button>` +
      classes.map(c => `<button class="tier-btn" data-class="${c}">${CLASS_ICONS[c] || ''} ${c}</button>`).join('');
    classBox.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        classBox.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.collFilterClass = btn.dataset.class;
        this.renderCollectionGrid();
      });
    });

    // Type buttons
    document.querySelectorAll('#collTypeButtons .tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#collTypeButtons .tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.collFilterType = btn.dataset.type;
        this.renderCollectionGrid();
      });
    });

    // Owned checkbox
    document.getElementById('collFilterOwned')?.addEventListener('change', () => this.renderCollectionGrid());
  }

  renderCollectionGrid() {
    const nation = this.collFilterNation || '';
    const cls = this.collFilterClass || '';
    const tier = this.collFilterTier || '';
    const type = this.collFilterType || '';
    const ownedOnly = document.getElementById('collFilterOwned').checked;

    let ships = this.r.collection.ships;
    if (nation) ships = ships.filter(s => s.nation === nation);
    if (cls) ships = ships.filter(s => s.class === cls);
    if (tier) ships = ships.filter(s => s.tier === tier);
    if (type === 'tech') ships = ships.filter(s => !s.premium);
    if (type === 'premium') ships = ships.filter(s => s.premium);
    if (type === 'sold') ships = ships.filter(s => s.sold);
    if (ownedOnly) ships = ships.filter(s => s.inGarage);

    // Show filtered completion summary
    const ownedCount = ships.filter(s => s.inGarage).length;
    const totalCount = ships.length;
    const filtPct = totalCount > 0 ? Math.round(ownedCount / totalCount * 100) : 0;
    let filterSummary = document.getElementById('collFilterSummary');
    if (!filterSummary) {
      filterSummary = document.createElement('div');
      filterSummary.id = 'collFilterSummary';
      filterSummary.className = 'coll-filter-summary';
      document.getElementById('collectionGrid').parentNode.insertBefore(filterSummary, document.getElementById('collectionGrid'));
    }
    const soldCount = ships.filter(s => s.sold).length;
    const soldSuffix = soldCount > 0 && type !== 'sold'
      ? ` · <span style="color:var(--orange)">${soldCount} sold</span>`
      : '';
    const soldTotal = type === 'sold'
      ? ` — 🪙 ${fmt(ships.reduce((sum, s) => sum + (s.recoveryCost || 0), 0))} total recovery cost`
      : '';
    filterSummary.innerHTML = `<strong>${filtPct}% Complete</strong> — ${ownedCount} of ${totalCount} ships owned${soldSuffix}${soldTotal}`;

    const grid = document.getElementById('collectionGrid');
    grid.innerHTML = ships.map(s => {
      const statusClass = s.inGarage ? '' : s.sold ? 'sold' : 'not-owned';
      const statusLabel = s.inGarage
        ? '<span class="sc-stat" style="color:var(--green)">✓ Owned</span>'
        : s.sold
          ? '<span class="sc-stat" style="color:var(--orange)">⚠ Sold</span>'
          : '<span class="sc-stat" style="color:var(--text-dim)">Not owned</span>';
      const recoveryCost = s.sold && s.recoveryCost
        ? `<div class="sc-recovery">🪙 ${fmt(s.recoveryCost)} to recover</div>`
        : '';
      return `
      <div class="ship-card ${statusClass}">
        <div class="sc-name"><span class="tier-badge">${s.tier}</span>${s.name}</div>
        <div class="sc-meta">${flagIcon(s.nation)} ${s.nation} • ${s.class} ${s.premium ? '• Premium' : ''}</div>
        <div class="sc-stats">
          <span class="sc-stat"><span class="sc-stat-val">${s.battles}</span> battles</span>
          ${statusLabel}
        </div>
        ${recoveryCost}
        ${s.lastBattle ? `<div class="sc-meta" style="margin-top:4px">Last: ${s.lastBattle.substring(0, 10)}</div>` : ''}
      </div>`;
    }).join('');
  }
}
