// Dashboard rendering — builds all charts and tables from analyzer results

const CHART_COLORS = {
  accent: '#00e5ff', accent2: '#00b0ff', dim: '#0088aa',
  green: '#4caf50', red: '#ef5350', orange: '#ff9800', purple: '#ab47bc',
  teal: '#26a69a', pink: '#ec407a', indigo: '#5c6bc0', lime: '#c0ca33',
};

Chart.defaults.color = '#8899aa';
Chart.defaults.borderColor = '#1e3a5f';

// Default battle mode: Standard (3)
const DEFAULT_MODE = 3;

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
function pct(n) { return n.toFixed(1) + '%'; }
function winClass(wr) {
  if (wr >= 55) return 'win-high';
  if (wr >= 50) return 'win-mid';
  return 'win-low';
}

class Dashboard {
  constructor(results) {
    this.r = results;
    this.charts = {};
    this.shipSortCol = 'battles';
    this.shipSortDir = 'desc';
    this.currentOverviewMode = DEFAULT_MODE; // Standard by default
    this.currentShipMode = DEFAULT_MODE;
  }

  render() {
    this.renderOverview();
    this.renderShips();
    this.renderTrends();
    this.renderCollection();
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
      });
    });
  }

  // Build battle mode tabs HTML for a given container
  buildModeTabs(containerId, currentMode, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const modeStats = this.r.career.modeStats;
    
    // Build tabs: Standard first, then other non-aggregate modes that have data, then "All Modes"
    const modeOrder = [3, 9, 6, 17, 20, 4, 23, 28, 'all'];
    const tabs = modeOrder.filter(m => modeStats[m] && modeStats[m].battles > 0);
    
    container.innerHTML = tabs.map(m => {
      const ms = modeStats[m];
      const name = m === 'all' ? 'All Modes' : (BATTLE_TYPES[m]?.name || `Type ${m}`);
      const active = (m == currentMode) ? 'active' : '';
      return `<button class="mode-tab ${active}" data-mode="${m}">${name} <span class="mode-count">(${fmt(ms.battles)})</span></button>`;
    }).join('');

    container.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode === 'all' ? 'all' : parseInt(btn.dataset.mode);
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
      this.statCard(pct(ms.winRate), 'Win Rate', `${fmt(ms.wins)} wins`, ms.winRate >= 50 ? 'good' : 'bad'),
      this.statCard(fmt(ms.avgDamage), 'Avg Damage', `${fmt(ms.damage)} total`),
      this.statCard(ms.kd.toFixed(2), 'K/D Ratio', `${fmt(ms.frags)} kills`),
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
      .filter(([k]) => k !== 'all' && modeStats[k].battles > 0)
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
                return `Win Rate: ${pct(v.winRate)}`;
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
    const rec = recByMode[mode] || recByMode['all'] || {};
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
    document.querySelectorAll('#topShipsToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#topShipsToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderTopShips(btn.dataset.metric);
      });
    });
  }

  renderTopShips(metric) {
    const minBattles = 10;
    const mode = this.currentOverviewMode;

    // Get ship stats for current mode
    let eligible = this.r.ships.filter(s => {
      if (mode === 'all') return s.battles >= minBattles;
      return s.byMode[mode] && s.byMode[mode].battles >= minBattles;
    });

    // Map to mode-specific stats
    if (mode !== 'all') {
      eligible = eligible.map(s => {
        const d = s.byMode[mode];
        const deaths = d.battles - d.survived;
        return {
          ...s,
          battles: d.battles, wins: d.wins, damage: d.damage, frags: d.frags,
          winRate: d.battles > 0 ? (d.wins / d.battles * 100) : 0,
          avgDamage: d.battles > 0 ? Math.round(d.damage / d.battles) : 0,
          kd: deaths > 0 ? (d.frags / deaths) : d.frags,
        };
      });
    }

    let sorted, valFn, label;
    switch (metric) {
      case 'winRate':
        sorted = [...eligible].sort((a, b) => b.winRate - a.winRate);
        valFn = s => pct(s.winRate);
        label = 'Win %';
        break;
      case 'avgDamage':
        sorted = [...eligible].sort((a, b) => b.avgDamage - a.avgDamage);
        valFn = s => fmt(s.avgDamage);
        label = 'Avg Dmg';
        break;
      default:
        sorted = [...eligible].sort((a, b) => b.battles - a.battles);
        valFn = s => s.battles.toLocaleString();
        label = 'Battles';
    }

    const top10 = sorted.slice(0, 10);
    const grid = document.getElementById('topShipsGrid');
    grid.innerHTML = top10.map((s, i) => {
      const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      return `
        <div class="top-ship-card">
          <div class="top-ship-rank ${rankCls}">${i + 1}</div>
          <div class="top-ship-info">
            <div class="top-ship-name"><span class="tier-badge">${s.tier}</span>${s.name}${s.premium ? ' ★' : ''}</div>
            <div class="top-ship-meta">${s.nation} • ${s.class}</div>
          </div>
          <div class="top-ship-stat">
            <div class="ts-val">${valFn(s)}</div>
            <div class="ts-label">${label}</div>
          </div>
        </div>`;
    }).join('');
  }

  // ---- SHIPS TAB ----
  renderShips() {
    this.populateShipFilters();

    // Mode tabs for ships tab
    this.buildModeTabs('shipModeTabs', this.currentShipMode, (mode) => {
      this.currentShipMode = mode;
      this.renderShipTable();
    });

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
    const nations = [...new Set(ships.map(s => s.nation))].sort();
    const classes = [...new Set(ships.map(s => s.class))].sort();
    const tiers = [...new Set(ships.map(s => s.tier))].sort((a, b) => tierNum(a) - tierNum(b));

    const nSel = document.getElementById('filterNation');
    nations.forEach(n => nSel.add(new Option(n, n)));
    const cSel = document.getElementById('filterClass');
    classes.forEach(c => cSel.add(new Option(c, c)));
    const tSel = document.getElementById('filterTier');
    tiers.forEach(t => { if (t !== '?') tSel.add(new Option(`Tier ${t}`, t)); });
  }

  setupFilters() {
    ['filterNation', 'filterClass', 'filterTier', 'filterMinBattles'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.renderShipTable());
    });
    ['collFilterNation', 'collFilterClass', 'collFilterTier', 'collFilterOwned'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.renderCollectionGrid());
    });
  }

  getFilteredShips() {
    const nation = document.getElementById('filterNation').value;
    const cls = document.getElementById('filterClass').value;
    const tier = document.getElementById('filterTier').value;
    const minB = parseInt(document.getElementById('filterMinBattles').value) || 1;
    const mode = this.currentShipMode;

    let ships = this.r.ships;
    if (nation) ships = ships.filter(s => s.nation === nation);
    if (cls) ships = ships.filter(s => s.class === cls);
    if (tier) ships = ships.filter(s => s.tier === tier);

    // Apply mode filter
    if (mode !== 'all') {
      const m = typeof mode === 'string' ? parseInt(mode) : mode;
      ships = ships.filter(s => s.byMode[m] && s.byMode[m].battles > 0).map(s => {
        const d = s.byMode[m];
        const deaths = d.battles - d.survived;
        return {
          ...s,
          battles: d.battles, wins: d.wins, damage: d.damage, frags: d.frags, survived: d.survived,
          winRate: d.battles > 0 ? (d.wins / d.battles * 100) : 0,
          avgDamage: d.battles > 0 ? Math.round(d.damage / d.battles) : 0,
          kd: deaths > 0 ? (d.frags / deaths) : d.frags,
          survivalRate: d.battles > 0 ? (d.survived / d.battles * 100) : 0,
          mainAccuracy: d.shotsMain > 0 ? (d.hitsMain / d.shotsMain * 100) : 0,
          torpAccuracy: d.shotsTorp > 0 ? (d.hitsTorp / d.shotsTorp * 100) : 0,
          shotsTorp: d.shotsTorp || 0,
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
        <td>${s.nation}</td>
        <td>${s.class}</td>
        <td class="num">${s.battles.toLocaleString()}</td>
        <td class="num ${winClass(s.winRate)}">${pct(s.winRate)}</td>
        <td class="num">${s.avgDamage.toLocaleString()}</td>
        <td class="num">${s.kd.toFixed(2)}</td>
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
    this.renderMonthlyChart();
    this.renderHeatmap();
    this.renderSessionDuration();
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
  renderCollection() {
    const coll = this.r.collection;

    const statsEl = document.getElementById('collectionStats');
    statsEl.innerHTML = [
      `<div class="collection-stat"><span class="cs-num">${coll.owned}</span><span class="cs-label">Ships Owned</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.played}</span><span class="cs-label">Ships Played</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.total}</span><span class="cs-label">Total Ships</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.nations.length}</span><span class="cs-label">Nations</span></div>`,
    ].join('');

    const nSel = document.getElementById('collFilterNation');
    coll.nations.forEach(n => nSel.add(new Option(n, n)));
    const cSel = document.getElementById('collFilterClass');
    coll.classes.forEach(c => cSel.add(new Option(c, c)));
    const tiers = [...new Set(coll.ships.map(s => s.tier))].sort((a, b) => tierNum(a) - tierNum(b));
    const tSel = document.getElementById('collFilterTier');
    tiers.forEach(t => { if (t !== '?') tSel.add(new Option(`Tier ${t}`, t)); });

    this.renderCollectionGrid();
  }

  renderCollectionGrid() {
    const nation = document.getElementById('collFilterNation').value;
    const cls = document.getElementById('collFilterClass').value;
    const tier = document.getElementById('collFilterTier').value;
    const ownedOnly = document.getElementById('collFilterOwned').checked;

    let ships = this.r.collection.ships;
    if (nation) ships = ships.filter(s => s.nation === nation);
    if (cls) ships = ships.filter(s => s.class === cls);
    if (tier) ships = ships.filter(s => s.tier === tier);
    if (ownedOnly) ships = ships.filter(s => s.inGarage);

    const grid = document.getElementById('collectionGrid');
    grid.innerHTML = ships.map(s => `
      <div class="ship-card ${s.inGarage ? '' : 'not-owned'}">
        <div class="sc-name"><span class="tier-badge">${s.tier}</span>${s.name}</div>
        <div class="sc-meta">${s.nation} • ${s.class} ${s.premium ? '• Premium' : ''}</div>
        <div class="sc-stats">
          <span class="sc-stat"><span class="sc-stat-val">${s.battles}</span> battles</span>
          ${s.inGarage ? '<span class="sc-stat" style="color:var(--green)">✓ Owned</span>' : '<span class="sc-stat" style="color:var(--text-dim)">Not owned</span>'}
        </div>
        ${s.lastBattle ? `<div class="sc-meta" style="margin-top:4px">Last: ${s.lastBattle.substring(0, 10)}</div>` : ''}
      </div>
    `).join('');
  }
}
