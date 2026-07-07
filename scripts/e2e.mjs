/* End-to-end smoke test: demo roster -> game setup -> auto-generated lineup.
   Runs in America/Denver to verify the date fix in a US timezone. */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('OK: ' + msg);

const ARTIFACTS = process.env.SCRATCH || '.e2e-artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

// Local containers pre-install chromium at /opt/pw-browsers; CI installs
// via `npx playwright install chromium` into the default registry, which
// playwright-core resolves when no executablePath is given.
const executablePath = process.env.CHROMIUM_PATH
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  timezoneId: 'America/Denver',
  viewport: { width: 900, height: 700 }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:4173');
await page.waitForSelector('.nav-title');
ok('app loaded: ' + await page.textContent('.nav-title'));

// 1. Load demo roster
await page.click('text=Load Demo Roster');
await page.waitForSelector('.player-item');
const playerCount = await page.locator('.player-item').count();
playerCount === 12 ? ok('demo roster loaded with 12 players') : fail(`expected 12 players, got ${playerCount}`);

// 2. Go to Game tab
await page.click('.nav-tab:has-text("Game")');
await page.waitForSelector('input[type="date"]');

// Date should default to *local* today (America/Denver)
const dateValue = await page.inputValue('input[type="date"]');
const localToday = await page.evaluate(() => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
});
dateValue === localToday ? ok(`game date defaults to local today (${dateValue})`) : fail(`date ${dateValue} != local today ${localToday}`);

// Set a fixed date to verify display later
await page.fill('input[type="date"]', '2026-07-06');
await page.fill('input[placeholder="Team name (optional)"]', 'Test Tigers');

// 3. Continue to lineup
await page.click('text=Continue to Lineup');
await page.waitForSelector('text=Start Lineup');
await page.click('text=Auto-Generate');
await page.waitForSelector('.lineup-grid');

// 4. Verify the grid is fully filled: 12 players x 6 innings = 72 cells with positions
const cellTexts = await page.locator('.lineup-grid .lineup-cell:not(.header):not(.player-col) .pos-text').allTextContents();
cellTexts.length === 72 ? ok('lineup grid fully populated (72 assignments)') : fail(`expected 72 filled cells, got ${cellTexts.length}`);

// Each inning column must contain all 9 positions exactly once
const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
for (let inning = 0; inning < 6; inning++) {
  const col = [];
  for (let row = 0; row < 12; row++) col.push(cellTexts[row * 6 + inning]);
  const fielded = col.filter(p => p !== 'SIT').sort().join(',');
  if (fielded !== [...positions].sort().join(',')) fail(`inning ${inning + 1} invalid: ${col.join(' ')}`);
}
ok('every inning fields all 9 positions exactly once');

// SIT balance: each player sits at most 2, spread <= 1
const sitCounts = [];
for (let row = 0; row < 12; row++) {
  sitCounts.push(cellTexts.slice(row * 6, row * 6 + 6).filter(p => p === 'SIT').length);
}
const maxSit = Math.max(...sitCounts), minSit = Math.min(...sitCounts);
(maxSit <= 2 && maxSit - minSit <= 1) ? ok(`sits balanced (max ${maxSit}, spread ${maxSit - minSit})`) : fail(`sit balance off: ${sitCounts.join(',')}`);

// 5. THE DATE BUG: print header must say July 6, not July 5
const printDate = await page.textContent('.print-header p');
printDate.includes('July 6, 2026') ? ok(`print header date correct: "${printDate}"`) : fail(`print header shows "${printDate}" (off-by-one?)`);

// 6. Re-solve fills reliably: clear & re-solve, grid must still be full
await page.click('text=Clear & Re-solve');
await page.waitForTimeout(300);
const refilled = await page.locator('.lineup-grid .lineup-cell:not(.header):not(.player-col) .pos-text').count();
refilled === 72 ? ok('Clear & Re-solve refilled the full grid') : fail(`after re-solve only ${refilled}/72 cells filled`);

// 7. Fill / Re-solve button (the flaky one)
await page.click('text=Fill / Re-solve');
await page.waitForTimeout(300);
const refilled2 = await page.locator('.lineup-grid .lineup-cell:not(.header):not(.player-col) .pos-text').count();
refilled2 === 72 ? ok('Fill / Re-solve works') : fail(`Fill/Re-solve left ${refilled2}/72 cells`);

// 8. Pitcher assignment flow (previously dead UI)
await page.click('.card:has(.card-title:text("Pitchers")) button:has-text("+ Assign")');
await page.waitForSelector('text=Primary Pitchers');
await page.click('.pitcher-option:not(.disabled)');
await page.waitForTimeout(300);
const inn1Pitcher = await page.textContent('.card:has(.card-title:text("Pitchers")) button.btn-primary');
inn1Pitcher.includes('Inn 1') ? ok(`pitcher assigned for inning 1 (${inn1Pitcher.trim().replace(/\s+/g, ' ')})`) : fail('pitcher assignment did not stick');

// 9. Save game, check history date display
await page.click('text=Save Game');
await page.waitForSelector('.toast:has-text("Game saved")');
ok('save shows a toast (no native alert)');
await page.click('.nav-tab:has-text("History")');
await page.waitForSelector('text=Test Tigers');
const historyText = await page.textContent('.player-item');
historyText.includes('7/6/2026') ? ok('history shows correct date 7/6/2026') : fail(`history row: "${historyText}"`);

// ============================================
// Phase 4: pitch counter + season stats
// ============================================
await page.click('.nav-tab:has-text("Game")');
await page.waitForSelector('text=Continue Current Game');
await page.click('text=Continue Current Game');
await page.waitForSelector('.lineup-grid');

// Open the inning-1 pitcher's cell and count 5 pitches
await page.locator('.lineup-grid .pos-text.P').first().click();
await page.waitForSelector('text=Pitch Counter');
await page.click('text=Pitch Counter');
await page.waitForSelector('.pitch-counter');
for (let i = 0; i < 5; i++) await page.click('.pitch-btn-plus');
const counted = (await page.textContent('.pitch-counter-display')).trim();
counted === '5' ? ok('pitch counter counts to 5') : fail(`pitch counter shows ${counted}`);
await page.click('text=End Inning');

// Stats tab
await page.click('.nav-tab:has-text("Stats")');
await page.waitForSelector('text=Playing Time by Position');

const kpiPitches = (await page.locator('.stat-card:has(.stat-label:text-is("Pitches")) .stat-value').textContent()).trim();
kpiPitches === '5' ? ok('KPI shows 5 pitches logged') : fail(`Pitches KPI: ${kpiPitches}`);

const segCount = await page.locator('.hbar-seg').count();
segCount >= 12 ? ok(`position distribution renders (${segCount} segments)`) : fail(`only ${segCount} segments`);

const legendCount = await page.locator('.legend-item').count();
legendCount === 5 ? ok('legend lists all 5 position groups') : fail(`${legendCount} legend items`);

await page.locator('text=Bench Time').waitFor();
ok('bench time chart present');

const workloadCols = await page.locator('.workload-col').count();
workloadCols >= 1 ? ok('pitcher workload columns render') : fail('no workload columns');

// Tooltip on hover
await page.locator('.hbar-seg').first().hover();
await page.waitForSelector('.chart-tooltip');
ok('chart tooltip appears on hover');

// Table-view twin
await page.locator('.card:has-text("Playing Time")').locator('button:has-text("Table")').click();
await page.waitForSelector('.stats-table');
const tableRows = await page.locator('.card:has-text("Playing Time") .stats-table tbody tr').count();
tableRows === 12 ? ok('table view lists all 12 players') : fail(`table rows: ${tableRows}`);
await page.locator('.card:has-text("Playing Time")').locator('button:has-text("Chart")').click();

// Range filter scopes the cards
await page.click('button:has-text("Last 7 Days")');
await page.waitForTimeout(200);
const kpiGames7 = (await page.locator('.stat-card:has(.stat-label:text-is("Games")) .stat-value').textContent()).trim();
kpiGames7 === '1' ? ok('7-day filter keeps today\'s game in scope') : fail(`Games KPI at 7d: ${kpiGames7}`);
await page.click('button:has-text("Full Season")');

await page.screenshot({ path: (process.env.SCRATCH || '.e2e-artifacts') + '/stats-light.png', fullPage: true });

// Dark theme render
await page.click('.nav-tab:has-text("Settings")');
await page.waitForSelector('text=Dark Mode');
await page.locator('.card:has-text("Display") .toggle-track').click();
await page.click('.nav-tab:has-text("Stats")');
await page.waitForSelector('text=Playing Time by Position');
await page.screenshot({ path: (process.env.SCRATCH || '.e2e-artifacts') + '/stats-dark.png', fullPage: true });
await page.click('.nav-tab:has-text("Settings")');
await page.locator('.card:has-text("Display") .toggle-track').click(); // back to light
ok('stats view renders in dark mode');

// ============================================
// Phase 5: data safety - backup, restore, history detail
// ============================================
await page.waitForSelector('text=Backup & Restore');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('text=Download Backup')
]);
const backupName = download.suggestedFilename();
backupName.startsWith('diamond-lineup-backup-') && backupName.endsWith('.json')
  ? ok(`backup downloads as ${backupName}`)
  : fail(`backup filename: ${backupName}`);
const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
(backup.roster?.length === 12 && backup.games?.length === 1)
  ? ok('backup contains the roster and saved game')
  : fail(`backup shape: roster=${backup.roster?.length} games=${backup.games?.length}`);

// Restore round-trip: modify the backup, import it, verify it went live
backup.roster[0] = { ...backup.roster[0], name: 'Imported Kid' };
const modPath = join(ARTIFACTS, 'modified-backup.json');
writeFileSync(modPath, JSON.stringify(backup));
await page.setInputFiles('input[type="file"]', modPath);
await page.waitForSelector('.modal:has-text("Replace the data")');
await Promise.all([
  page.waitForEvent('load'), // the app reloads itself after import
  page.click('.modal button:has-text("Restore")')
]);
await page.waitForSelector('.nav-title');
await page.click('.nav-tab:has-text("Roster")');
await page.waitForSelector('text=Imported Kid');
ok('restore round-trip: imported data is live');

// History: expandable game detail with read-only lineup
await page.click('.nav-tab:has-text("History")');
await page.locator('.player-item').first().click();
await page.waitForSelector('button:has-text("Delete Game")');
const snapshotCells = await page.locator('.lineup-grid .pos-text').count();
snapshotCells >= 60
  ? ok(`game detail shows the saved lineup (${snapshotCells} cells)`)
  : fail(`snapshot cells: ${snapshotCells}`);

// Delete asks for confirmation and can be cancelled
await page.click('button:has-text("Delete Game")');
await page.waitForSelector('.modal:has-text("Season stats will no longer include it")');
await page.click('.modal button:has-text("Cancel")');
await page.waitForSelector('button:has-text("Delete Game")');
ok('game delete confirms and cancels cleanly');

// 10. Persistence across reload
await page.reload();
await page.waitForSelector('.nav-title');
await page.click('.nav-tab:has-text("Roster")');
const persisted = await page.locator('.player-item').count();
persisted === 12 ? ok('roster persisted across reload') : fail(`after reload roster has ${persisted} players`);

// ============================================
// Phase 1: softball 10-fielder flow
// ============================================
await page.click('.nav-tab:has-text("Settings")');
await page.waitForSelector('text=Sport & Field');

const sportCard = page.locator('.card', { hasText: 'Sport & Field' });
await sportCard.locator('select').first().selectOption('softball');
await page.waitForTimeout(200);

// Nav emoji flips to softball
const navTitle = await page.textContent('.nav-title');
navTitle.includes('🥎') ? ok('nav switches to softball emoji') : fail(`nav title: ${navTitle}`);

// Softball presets appear; default fallback applied
const presetCard = page.locator('.card', { hasText: 'Pitching Rules' });
const presetValue = await presetCard.locator('select').first().inputValue();
presetValue.startsWith('softball') ? ok(`softball preset applied (${presetValue})`) : fail(`preset is ${presetValue}`);

// 10 fielders
await sportCard.locator('select').nth(1).selectOption('10');
await page.waitForTimeout(200);

// Fairness rules on
const fairnessCard = page.locator('.card', { hasText: 'Game & Fairness Rules' });
await fairnessCard.locator('select').nth(2).selectOption('1'); // max consecutive sits = 1
await fairnessCard.locator('.toggle-track').click(); // everyone plays infield
ok('fairness rules enabled (consecutive sits 1, everyone infield)');

// Start a new softball game (discarding the current one requires confirmation)
await page.click('.nav-tab:has-text("Game")');
await page.waitForSelector('text=Start New Game');
await page.click('text=Start New Game');
await page.waitForSelector('.modal:has-text("Discard the current game")');
ok('starting a new game asks before discarding the current one');
await page.click('button:has-text("Discard & Start New")');
await page.waitForSelector('text=Set Batting Order');
await page.click('text=Start Blank');
await page.waitForSelector('input[type="date"]');
await page.click('text=Continue to Lineup');
await page.waitForSelector('text=Start Lineup');
await page.click('text=Auto-Generate');
await page.waitForSelector('.lineup-grid');

// 12 players x 6 innings, 10 fielders per inning incl SC
const sbCells = await page.locator('.lineup-grid .lineup-cell:not(.header):not(.player-col) .pos-text').allTextContents();
sbCells.length === 72 ? ok('softball grid fully populated') : fail(`softball grid has ${sbCells.length}/72 cells`);

const positions10 = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SC'];
let sbValid = true;
for (let inning = 0; inning < 6; inning++) {
  const col = [];
  for (let row = 0; row < 12; row++) col.push(sbCells[row * 6 + inning]);
  const fielded = col.filter(p => p !== 'SIT').sort().join(',');
  if (fielded !== [...positions10].sort().join(',')) {
    sbValid = false;
    fail(`softball inning ${inning + 1}: ${col.join(' ')}`);
  }
}
if (sbValid) ok('every softball inning fields all 10 positions (incl. SC) exactly once');

// Fairness: nobody sits twice in a row
let consecutiveOk = true;
for (let row = 0; row < 12; row++) {
  for (let inning = 0; inning < 5; inning++) {
    if (sbCells[row * 6 + inning] === 'SIT' && sbCells[row * 6 + inning + 1] === 'SIT') consecutiveOk = false;
  }
}
consecutiveOk ? ok('no player sits back-to-back (fairness rule)') : fail('a player sits consecutive innings');

// Fairness: everyone gets an infield inning (non-OF, non-SIT)
const OF = new Set(['LF', 'CF', 'RF', 'SC']);
let infieldOk = true;
for (let row = 0; row < 12; row++) {
  const rowPositions = sbCells.slice(row * 6, row * 6 + 6);
  if (!rowPositions.some(p => p !== 'SIT' && !OF.has(p))) infieldOk = false;
}
infieldOk ? ok('every player gets at least one infield inning') : fail('a player never plays infield');

await page.screenshot({ path: (process.env.SCRATCH || '.e2e-artifacts') + '/softball-lineup.png', fullPage: true });

// ============================================
// Phase 3: print emulation
// ============================================
await page.emulateMedia({ media: 'print' });
const scoreVis = await page.locator('.score-value').first().evaluate(el => getComputedStyle(el).visibility);
scoreVis === 'hidden' ? ok('score values print as blank boxes') : fail(`score-value visibility in print: ${scoreVis}`);
const printHeaderVisible = await page.locator('.print-header').evaluate(el => getComputedStyle(el).display);
printHeaderVisible === 'block' ? ok('print header shows in print media') : fail(`print header display: ${printHeaderVisible}`);
const navPrint = await page.locator('.nav').evaluate(el => getComputedStyle(el).display);
navPrint === 'none' ? ok('nav hidden in print') : fail(`nav display in print: ${navPrint}`);
const colBg = await page.locator('.lineup-cell.current-col').first().evaluate(el => getComputedStyle(el).backgroundColor);
colBg === 'rgb(255, 255, 255)' ? ok('current-inning highlight removed on paper') : fail(`current-col print bg: ${colBg}`);
await page.screenshot({ path: (process.env.SCRATCH || '.e2e-artifacts') + '/print-preview.png', fullPage: true });
await page.emulateMedia({ media: 'screen' });

// ============================================
// Phase 3: mobile viewport (iPhone-sized, touch)
// ============================================
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'America/Denver'
});
const mpage = await mobile.newPage();
mpage.on('pageerror', e => errors.push('mobile: ' + e.message));

await mpage.goto('http://localhost:4173');
await mpage.waitForSelector('.nav-title');

// PWA: manifest and service worker are served
const manifestResp = await mpage.request.get('http://localhost:4173/manifest.webmanifest');
manifestResp.ok() ? ok('PWA manifest served') : fail(`manifest status ${manifestResp.status()}`);
const swResp = await mpage.request.get('http://localhost:4173/sw.js');
swResp.ok() ? ok('service worker served') : fail(`sw.js status ${swResp.status()}`);

// Bottom tab bar sits at the bottom of the viewport
const tabsBox = await mpage.locator('.nav-tabs').boundingBox();
(tabsBox && Math.abs(tabsBox.y + tabsBox.height - 844) < 2)
  ? ok('nav is a bottom tab bar on mobile')
  : fail(`nav tabs box: ${JSON.stringify(tabsBox)}`);

// Load demo roster (fresh storage in this context)
await mpage.click('text=Load Demo Roster');
await mpage.waitForSelector('.player-item');

// Go to Game tab (tap, bottom bar)
await mpage.click('.nav-tab:has-text("Game")');
await mpage.waitForSelector('input[type="date"]');

// Reorder batting order by dragging row 1's handle below row 3 (pointer events)
const names = () => mpage.locator('.player-item .player-name').allTextContents();
const before = await names();
const handle = mpage.locator('.player-item .drag-handle').first();
const hbox = await handle.boundingBox();
const row3 = await mpage.locator('.player-item').nth(2).boundingBox();
await mpage.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
await mpage.mouse.down();
for (let i = 1; i <= 8; i++) {
  await mpage.mouse.move(
    hbox.x + hbox.width / 2,
    hbox.y + ((row3.y + row3.height / 2 - hbox.y) * i) / 8
  );
}
await mpage.mouse.up();
const after = await names();
(after[0] === before[1] && after.indexOf(before[0]) > 0)
  ? ok(`drag reorder works via pointer events (${before[0]} moved to spot ${after.indexOf(before[0]) + 1})`)
  : fail(`order unchanged or wrong: before=${before.slice(0, 3)} after=${after.slice(0, 3)}`);

// Continue to lineup and check mobile grid behavior
await mpage.click('text=Continue to Lineup');
await mpage.waitForSelector('text=Start Lineup');
await mpage.click('text=Auto-Generate');
await mpage.waitForSelector('.lineup-grid');

const stickyPos = await mpage.locator('.lineup-cell.player-col').first().evaluate(el => getComputedStyle(el).position);
stickyPos === 'sticky' ? ok('player column is sticky on mobile') : fail(`player-col position: ${stickyPos}`);

const currentHeader = await mpage.locator('.lineup-cell.header.current').count();
currentHeader === 1 ? ok('current inning column is highlighted') : fail(`current header cells: ${currentHeader}`);

// Cell tap opens a bottom-sheet modal
await mpage.locator('.lineup-grid .lineup-cell:not(.header):not(.player-col)').first().tap();
await mpage.waitForSelector('.modal');
await mpage.waitForTimeout(400); // let the slide-up animation settle
const modalRect = await mpage.locator('.modal').evaluate(el => {
  const r = el.getBoundingClientRect();
  return { bottom: r.bottom, width: r.width, vh: window.innerHeight };
});
(Math.abs(modalRect.bottom - modalRect.vh) < 3 && modalRect.width >= 388)
  ? ok('modals open as bottom sheets on mobile')
  : fail(`modal rect: ${JSON.stringify(modalRect)}`);
await mpage.keyboard.press('Escape');

await mpage.screenshot({ path: (process.env.SCRATCH || '.e2e-artifacts') + '/mobile-lineup.png', fullPage: false });
await mobile.close();

if (errors.length) fail('console errors: ' + errors.join(' | '));
else ok('no console errors');

await browser.close();
console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASSED');
