# 🤿 GamingDiver

**Dive deep into your gaming data.** Upload your game data export and get rich visual insights — all processed client-side with zero server costs.

## Features

- **100% Client-Side** — All analysis runs in your browser. No data is ever sent to any server.
- **Career Overview** — Total battles, win rate, K/D, play time, accuracy stats
- **Ship Performance** — Sortable/filterable table comparing all your ships
- **Trends** — Monthly activity, play schedule heatmap, session duration analysis
- **Ship Collection** — Visual grid of your fleet with ownership and battle stats
- **Cached Results** — Your data is cached locally so you don't need to re-upload

## Supported Games

- ⚓ **World of Warships: Legends** — Upload your Wargaming.net data export (.zip)
- 🎮 More games coming soon

## Getting Started

1. Go to [your Wargaming.net account](https://wargaming.net) and request a data export
2. Open GamingDiver and drag your `dump.zip` file onto the upload area
3. Explore your data!

## Running Locally

No build step needed — it's pure HTML/CSS/JS.

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node
npx serve .

# Then open http://localhost:8000
```

## Privacy

All processing happens in JavaScript in your browser. No analytics, no tracking, no server-side processing. See [Privacy Policy](privacy.html).

## Tech Stack

- Vanilla HTML/CSS/JS (no frameworks, no build step)
- [JSZip](https://stuk.github.io/jszip/) — client-side ZIP extraction
- [Papa Parse](https://www.papaparse.com/) — CSV parsing
- [Chart.js](https://www.chartjs.org/) — charts and visualizations
- All libraries loaded from CDN

## License

Copyright © 2026 GamingDiver. All rights reserved.
