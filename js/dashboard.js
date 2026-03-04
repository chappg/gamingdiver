// Dashboard rendering — builds all charts and tables from analyzer results

const CHART_COLORS = {
  accent: '#00e5ff', accent2: '#00b0ff', dim: '#0088aa',
  green: '#4caf50', red: '#ef5350', orange: '#ff9800', purple: '#ab47bc',
  teal: '#26a69a', pink: '#ec407a', indigo: '#5c6bc0', lime: '#c0ca33',
};

const chartDefaults = {
  color: '#8899aa',
  borderColor: '#1e3a5f',
  backgroundColor: 'rgba(0,229,255,0.1)',
};

Chart.defaults.color = '#8899aa';
Chart.defaults.borderColor = '#1e3a5f';

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
        // Resize charts when tab shown
        Object.values(this.charts).forEach(c => c.resize?.());
      });
    });
  }

  // ---- OVERVIEW TAB ----
  renderOverview() {
    const c = this.r.career;
    document.getElementById('playerName').textContent = `${c.gamertag}'s Dashboard`;

    const cards = document.getElementById('overviewCards');
    cards.innerHTML = [
      this.statCard(fmt(c.totalBattles), 'Battles', `${c.totalSessions} sessions`),
      this.statCard(pct(c.winRate), 'Win Rate', `${fmt(c.totalWins)} wins`, c.winRate >= 50 ? 'good' : 'bad'),
      this.statCard(fmt(c.avgDamage), 'Avg Damage', `${fmt(c.totalDamage)} total`),
      this.statCard(c.kd.toFixed(2), 'K/D Ratio', `${fmt(c.totalFrags)} kills`),
      this.statCard(pct(c.survivalRate), 'Survival', ''),
      this.statCard(`${fmt(c.totalPlayTimeHours)}h`, 'Play Time', `~${c.avgSessionMin}m avg session`),
      this.statCard(pct(c.mainAccuracy), 'Main Acc.', ''),
      this.statCard(pct(c.torpAccuracy), 'Torp Acc.', ''),
    ].join('');

    this.renderTopShips('battles');
    this.setupTopShipsToggle();
    this.renderBattleModesChart(c.modeStats);
    this.renderCombatStyleChart(c);
    this.renderRecords();
  }

  statCard(value, label, sub, cls = '') {
    return `<div class="stat-card ${cls}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div><div class="stat-sub">${sub}</div></div>`;
  }

  renderBattleModesChart(modeStats) {
    const entries = Object.entries(modeStats).sort(([, a], [, b]) => b.battles - a.battles);
    const colors = [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.teal, CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.pink, CHART_COLORS.indigo, CHART_COLORS.lime, CHART_COLORS.red];

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
                return `Win Rate: ${(v.wins / v.battles * 100).toFixed(1)}%`;
              }
            }
          }
        }
      }
    });
  }

  renderCombatStyleChart(c) {
    // Kill breakdown from aggregate battle type stats
    const bt = Object.values(c.modeStats);
    let mainKills = 0, torpKills = 0, atbaKills = 0, ramKills = 0, planeKills = 0;
    // We'll use ship data for better kill breakdown
    const ships = this.r.ships || [];
    for (const s of ships) {
      mainKills += s.fragsByMain || 0;
      torpKills += s.fragsByTorp || 0;
      atbaKills += s.fragsByAtba || 0;
      ramKills += s.fragsByRam || 0;
    }

    const data = [
      { label: 'Main Battery', value: mainKills, color: CHART_COLORS.accent },
      { label: 'Torpedoes', value: torpKills, color: CHART_COLORS.teal },
      { label: 'Secondary', value: atbaKills, color: CHART_COLORS.orange },
      { label: 'Ramming', value: ramKills, color: CHART_COLORS.red },
    ].filter(d => d.value > 0);

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
    const rec = this.r.records;
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
    const eligible = this.r.ships.filter(s => s.battles >= minBattles);
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
    this.renderShipTable();

    // Sort headers
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

    const mSel = document.getElementById('filterMode');
    DISPLAY_BATTLE_TYPES.forEach(t => {
      if (BATTLE_TYPES[t]) mSel.add(new Option(BATTLE_TYPES[t].name, t));
    });
  }

  setupFilters() {
    ['filterNation', 'filterClass', 'filterTier', 'filterMinBattles', 'filterMode'].forEach(id => {
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
    const mode = document.getElementById('filterMode').value;

    let ships = this.r.ships;
    if (nation) ships = ships.filter(s => s.nation === nation);
    if (cls) ships = ships.filter(s => s.class === cls);
    if (tier) ships = ships.filter(s => s.tier === tier);
    ships = ships.filter(s => s.battles >= minB);

    // If mode filter, recompute stats from byMode
    if (mode) {
      const m = parseInt(mode);
      ships = ships.filter(s => s.byMode[m]).map(s => {
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
          shotsTorp: d.shotsTorp,
        };
      }).filter(s => s.battles >= minB);
    }

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

    // Update sort indicators
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
        <td class="num">${s.tier}</td>
        <td class="num">${s.battles.toLocaleString()}</td>
        <td class="num ${winClass(s.winRate)}">${pct(s.winRate)}</td>
        <td class="num">${s.avgDamage.toLocaleString()}</td>
        <td class="num">${s.kd.toFixed(2)}</td>
        <td class="num">${pct(s.survivalRate)}</td>
        <td class="num">${pct(s.mainAccuracy)}</td>
        <td class="num">${s.shotsTorp > 0 ? pct(s.torpAccuracy) : '-'}</td>
      </tr>
    `).join('');
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
    // Multi-stop gradient: dark base -> deep teal -> bright cyan -> warm yellow-white
    if (intensity <= 0) return null;
    const stops = [
      { t: 0,    r: 13,  g: 42,  b: 68  },  // deep blue
      { t: 0.25, r: 0,   g: 105, b: 120 },  // dark teal
      { t: 0.5,  r: 0,   g: 180, b: 200 },  // teal
      { t: 0.75, r: 0,   g: 229, b: 255 },  // bright cyan
      { t: 1,    r: 120, g: 255, b: 230 },  // hot glow
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
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-dim);">No session data available</div>';
      return;
    }

    // Find max for color scaling
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

    // Color legend
    html += '<div class="heatmap-legend">';
    html += '<span class="heatmap-legend-label">Less</span>';
    html += '<div class="heatmap-legend-bar">';
    for (let i = 0; i <= 4; i++) {
      const c = this.heatmapColor(i / 4) || 'rgba(255,255,255,0.02)';
      html += `<span style="background:${c}"></span>`;
    }
    html += '</div>';
    html += '<span class="heatmap-legend-label">More</span>';
    html += '</div>';

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

    // Stats
    const statsEl = document.getElementById('collectionStats');
    statsEl.innerHTML = [
      `<div class="collection-stat"><span class="cs-num">${coll.owned}</span><span class="cs-label">Ships Owned</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.played}</span><span class="cs-label">Ships Played</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.total}</span><span class="cs-label">Total Ships</span></div>`,
      `<div class="collection-stat"><span class="cs-num">${coll.nations.length}</span><span class="cs-label">Nations</span></div>`,
    ].join('');

    // Filters
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
