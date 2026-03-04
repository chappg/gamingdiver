# GamingDiver - Game Data Export Analyzer

## Overview
A static website where users upload their game data exports and get rich visual insights — all processed client-side with zero server costs. First supported game: **WoWS Legends** (World of Warships: Legends).

## Architecture
- **100% client-side** — no backend, no API calls, no server processing
- **Static hosting** — designed for GitHub Pages
- **Data privacy** — uploaded data never leaves the browser. Cached in IndexedDB/localStorage for return visits
- **Modular** — game-specific analyzers are plugins. WoWS Legends is the first, but the framework supports adding more games later

## Tech Stack
- Vanilla HTML/CSS/JS (no build step, no frameworks)
- [JSZip](https://stuk.github.io/jszip/) — client-side zip extraction
- [Papa Parse](https://www.papaparse.com/) — CSV parsing
- [Chart.js](https://www.chartjs.org/) — charts and visualizations
- All libraries loaded from CDN

## Branding
- **Name:** GamingDiver
- **Theme:** Deep-sea diving / ocean exploration meets gaming data
- **Color palette:** Deep ocean blues, teal accents, white text, subtle bioluminescent glow effects
- **Logo:** A diver's helmet or diving mask with game controller / data elements
- Generate a simple SVG logo

## Pages

### 1. Landing Page (`index.html`)
- Hero section with tagline: "Dive deep into your gaming data"
- Upload area (drag & drop + file picker)
- Accepts .zip files (and individual CSVs for flexibility)
- Auto-detects game type from file contents
- Shows supported games list (currently just WoWS Legends)
- Link to privacy page

### 2. Dashboard (`dashboard.html` or SPA section)
After upload, show a tabbed/sectioned dashboard:

#### P0 Features (must-have for v1):

**Career Overview**
- Total battles, win rate %, K/D ratio
- Total hours played (from game sessions)
- Account age (first to last session)
- Battles by mode (PvP, Co-op, Ranked, Brawl, Arena)
- Visual cards with big numbers + sparklines

**Ship Performance Comparison**
- Sortable table of all ships played
- Columns: Ship name, Nation, Class, Tier, Battles, Win Rate, Avg Damage, K/D, Survival Rate, Accuracy
- Filter by: nation, class, tier, min battles
- Click a ship for detailed breakdown
- Highlight best/worst performers
- Cross-reference with wowsbuilds ship data (tier, nation, class, type) using the vehicle mapping

**Trends Over Time**
- Monthly battle count over career
- Session frequency heatmap (day of week × time of day)
- Session duration trends
- Active periods vs breaks

**Ship Collection Viewer**
- Visual grid of all ships (owned + played)
- Filter by nation/class/tier
- Show: owned in garage, battles played, last played date
- Highlight "neglected" ships (owned but rarely played)

**Commander Collection Viewer**  
- Note: The data export has an Account Storage CSV with item codes
- Items starting with certain prefixes represent commanders
- Show what commanders the player has collected
- Cross-reference with our commanders.json data if possible

### 3. Privacy Page (`privacy.html`)
- Clear explanation that ALL analysis happens in JavaScript in the browser
- No data is uploaded to any server
- No cookies track users (localStorage is local only)
- The .zip file and its contents never leave the device
- Optional: user can clear cached data with a button
- No analytics, no tracking pixels

## Data Structure (WoWS Legends Export)

The .zip contains these CSVs:

### `Activity_History/WOWSL_Game_Sessions.csv`
- STARTED_AT, FINISHED_AT, IP
- ~3000+ rows, date range from 2021 to present
- Use for: play time, session patterns, trends

### `Player_Statistics/WOWSL_Ship_Statistics.csv`
- VEHICLE_NAME, IN_GARAGE, DISTANCE, CREATED_AT, UPDATED_AT, LAST_BATTLE_TIME, BATTLE_LIFE_TIME, BATTLES_COUNT, CURRENT_EXP
- ~430 rows (one per ship)
- VEHICLE_NAME uses internal format like "PJSD012_Shimakaze_1943"

### `Player_Statistics/WOWSL_Ship_Statistics_By_Type.csv`
- Per-ship stats broken down by battle type
- ~50 columns including: WINS, LOSSES, SURVIVED, FRAGS, DAMAGE_DEALT, all hit/shot counts, MAX records
- TYPE column values: 1, 2, 3, 4, 6, 9, 10, 11, 17, 20, 23, 24, 28
- Known mappings: 3=PvP Standard, 6=Co-op, 4=Ranked, 20=Ranked Season
- Type 1 appears to be aggregate PvP, Type 2 aggregate Co-op

### `Player_Statistics/WOWSL_Battle_Types_Statistics.csv`
- Aggregate stats per battle type (same columns as above)

### `Player_Statistics/WOWSL_Account_Statistics.csv`
- Single row with account-level stats

### `Player_Statistics/WOWSL_Account_Storage.csv`
- ITEM_DESC, AMOUNT — inventory items (ships, flags, commanders, upgrades)

### `Clans/Clans.csv` and `Clans/Sent_Invites_To_Clans.csv`
- Clan membership history

### `User_Info/Account_Info.csv`
- Account details (gamertag, etc.)

## Vehicle Name Mapping

Internal names follow pattern: `XXYY###_ShipName_Variant`
- XX = nation (PA=USA, PJ=Japan, PG=Germany, PB=UK, PF=France, PW=Netherlands, PI=Italy, PR=USSR, PE=Europe, PZ=Pan-Asia, PX=Event, PU=Commonwealth, PT=Spain, PH=Commonwealth)
- YY = class (SB=Battleship, SC=Cruiser, SD=Destroyer, SA=Carrier)
- ### = number (500+ usually premium)

A `wows-vehicle-mapping.json` file is included with pre-built mappings from internal names to display names, nations, classes, and wowsbuilds cross-references for ~343/429 ships. For unmatched ships, fall back to parsing the internal name.

## Caching Strategy
- After first upload and parse, store the processed results in IndexedDB
- Key by a hash of the file contents
- On return visit, offer to re-analyze or use cached results
- "Clear data" button on privacy page and in settings

## File: `test-data.zip`
A real WoWS Legends data export is included for testing. Do NOT commit this to git (add to .gitignore).

## Deliverables
1. Working static site with all P0 features
2. Clean, responsive design with GamingDiver ocean theme
3. SVG logo
4. Privacy page
5. README.md with setup instructions
6. .gitignore (exclude test data)
7. All code committed to git
