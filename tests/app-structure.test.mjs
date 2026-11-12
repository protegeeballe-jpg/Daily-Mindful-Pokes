import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const appCss=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
const garden=readFileSync(new URL('../assets/garden.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../assets/writing-security.js',import.meta.url),'utf8');
const voiceNoteStore=readFileSync(new URL('../assets/voice-note-store.js',import.meta.url),'utf8');
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const packageMetadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const appIcon=readFileSync(new URL('../assets/icon.png',import.meta.url));
const serviceWorker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const accountSecurity=readFileSync(new URL('../assets/account-security.js',import.meta.url),'utf8');
test('Faith & Focus branding, PWA metadata, and unified account copy stay aligned',()=>{
 assert.match(html,/<title>Faith &amp; Focus \| Your Daily Armor<\/title>|<title>Faith & Focus \| Your Daily Armor<\/title>/);
 assert.match(html,/Faith & Focus: Daily Armor/);
 assert.match(html,/The Forge Room/);
 assert.match(garden,/room: 'The Forge Room'/);
 assert.match(garden,/outdoors: 'The Garden'/);
 assert.match(html,/id="vault-login-form"/);
 assert.match(html,/id="vault-username"/);
 assert.match(html,/id="vault-passphrase"/);
 assert.match(html,/at least 12 characters/i);
 assert.doesNotMatch(html,/6–12 digit app PIN|Create your app PIN/);
 assert.equal(manifest.name,'Faith & Focus: Daily Armor');
 assert.equal(manifest.short_name,'Faith & Focus');
 assert.equal(packageMetadata.name,'faith-focus-daily-armor');
 assert.match(readme,/^# Faith & Focus: Daily Armor/m);
 assert.doesNotMatch(readme,/Daily Mindful Pokes/i);
 assert.deepEqual([...appIcon.subarray(0,8)],[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
 assert.equal(appIcon.readUInt32BE(16),1024);
 assert.equal(appIcon.readUInt32BE(20),1024);
 assert.equal(manifest.icons[0].src,'./assets/icon.png');
 assert.equal(manifest.icons[0].type,'image/png');
});
test('HTML uses a local app module and no inline handlers or scripts',()=>{
 assert.match(html,/type="module" src="\.\/assets\/app\.js"/);
 assert.doesNotMatch(html,/\son(?:click|change|input|submit)\s*=/i);
 assert.doesNotMatch(html,/<script\s*>/i);
 assert.match(html,/id="vault-login-form"/);
 assert.doesNotMatch(html,/id="app-pin-form"/);
 assert.doesNotMatch(html,/id="gist-sync-key"|id="gist-backup-passphrase"/);
 assert.doesNotMatch(app,/defaultPin\s*=\s*["']1234["']/);
});
test('CSP limits script execution to same-origin files and blocks objects',()=>{
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/object-src 'none'/);
 assert.match(html,/base-uri 'self'/);
 assert.doesNotMatch(html,/cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com/);
 assert.match(html,/assets\/tailwind\.generated\.css/);
 assert.match(readme,/Content Security Policy/i);
});
test('private-writing encryption remains separate and preserved',()=>{
 assert.match(writing,/AES-GCM/);
 assert.match(writing,/PBKDF2/);
 assert.match(writing,/WRITING_KDF_ITERATIONS=600000/);
 assert.match(writing,/tagLength:128/);
 assert.match(writing,/PRIVATE_NOTE_IDS/);
 assert.match(app,/handleDiaryKeyAction/);
});
test('ordinary progress storage is documented as not encrypted',()=>{
 assert.match(app,/mindful_pokes_data_/);
 assert.match(readme,/Checklist checkboxes/i);
 assert.match(readme,/not encrypted/i);
});
test('all existing checklist, cloud and ecosystem features remain',()=>{
 assert.equal((html.match(/class="[^"]*app-chk/g)||[]).length,23);
 assert.equal((html.match(/data-cloud="(?:cumulus|stratus|stratocumulus)"/g)||[]).length,3);
 for(const feature of ['finishChecklist','guide-launch','ecosystem-canvas'])assert.ok(html.includes(feature)||app.includes(feature),feature);
});

test('Forge Room is a separate local module and does not replace existing features',()=>{
 assert.match(html,/id="little-garden"/);
 assert.match(html,/data-garden-action="open-garden"/);
 assert.match(html,/assets\/garden\.css/);
 assert.match(html,/type="module" src="\.\/assets\/garden\.js"/);
 assert.match(html,/aria-modal="true"/);
 assert.match(readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8'),/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(html,/<script\\s*>/i);
 assert.match(readFileSync(new URL('../assets/garden.js',import.meta.url),'utf8'),/GARDEN_STORAGE_KEY/);
});

test('garden startup selector matches the actual overlay and enables scene navigation',()=>{
 assert.match(html,/id="little-garden"/);
 assert.match(garden,/document\.getElementById\('little-garden'\)/);
 assert.doesNotMatch(garden,/document\.getElementById\('-garden'\)/);
 assert.match(garden,/document\.addEventListener\('garden:open'/);
 assert.match(garden,/document\.addEventListener\('garden:show-scene'/);
});

test('the product interface does not expose the private inspiration name',()=>{
 assert.doesNotMatch(html,/Onnea/i);
 assert.doesNotMatch(readme,/Onnea/i);
});
test('the health checklist and encrypted diary are scenes inside the Forge Room hub',()=>{
 assert.match(html,/id="view-checklist" data-garden-scene="checklist"/);
 assert.match(html,/id="view-diary" data-garden-scene="diary"/);
 assert.match(html,/data-page="checklist"/);
 assert.match(html,/data-page="diary"/);
 const gardenStart=html.indexOf('<section id="little-garden"');
 const diaryStart=html.indexOf('id="view-diary"');
 const checklistStart=html.indexOf('id="view-checklist"');
 const gardenEnd=html.indexOf('<!-- 🌟 ANIMATION MODAL POPUP -->');
 assert.ok(gardenStart < diaryStart && diaryStart < gardenEnd);
 assert.ok(gardenStart < checklistStart && checklistStart < gardenEnd);
 assert.match(app,/garden:show-scene/);
 assert.match(app,/showPage\('garden'\)/);
});

test('seed selection is a one-time setup and becomes visibly completed after saving',()=>{
 assert.match(html,/id="garden-first-planting"[^>]*data-setup-state="pending"/);
 assert.match(html,/id="garden-planting-fields" class="garden-choice-grid"/);
 assert.match(html,/id="garden-planting-complete" class="garden-setup-complete hidden" role="status"/);
 assert.doesNotMatch(html,/id="garden-planted-summary"/);
 assert.match(garden,/fields\.disabled = isComplete/);
 assert.match(garden,/plantButton\.disabled = isComplete/);
 assert.match(garden,/plantButton\.textContent = isComplete \? 'Setup Completed ✓'/);
 assert.match(garden,/setup\.dataset\.setupState = isComplete \? 'complete' : 'pending'/);
 assert.match(garden,/treeChoice\.value = garden\.treeType/);
 assert.match(garden,/flowerChoice\.value = garden\.flowerType/);
 assert.match(garden,/if \(!saveGarden\(\)\) \{/);
 assert.match(garden,/garden = null;/);
 assert.match(garden,/setup\.classList\.toggle\('is-complete', isComplete\)/);
 const resetStart=app.indexOf('async function resetDayData()');
 const resetEnd=app.indexOf('async function toggleVoiceRecording()',resetStart);
 const dailyReset=app.slice(resetStart,resetEnd);
 assert.match(dailyReset,/Start the Health Checklist over/);
 assert.match(dailyReset,/localStorage\.removeItem\(getStorageKey\(dateStr\)\)/);
 assert.match(dailyReset,/localStorage\.removeItem\(getSecureWritingStorageKey\('notes',dateStr\)\)/);
 assert.match(dailyReset,/localStorage\.removeItem\(GARDEN_STORAGE_KEY\)/);
 assert.match(dailyReset,/garden:reset-for-checklist/);
 assert.doesNotMatch(dailyReset,/getLocationCheckinStorageKey|LOCATION_CHECKIN_OPTIONS|WRITING_DIARY_PREFIX|removeLocationCheckin/);
 assert.match(dailyReset,/Personal Diary entries and all location logs will be kept/);
 assert.match(app,/function resetChecklistWizard\(\)/);
 assert.match(app,/currentStep = 1/);
 assert.match(garden,/garden:reset-for-checklist/);

});
test('the supplied artwork fills the Room home background and the Diary remains single',()=>{
 const gardenStart=html.indexOf('<section id="little-garden"');
 const gardenEnd=html.indexOf('<!-- 🌟 ANIMATION MODAL POPUP -->',gardenStart);
 const gardenMarkup=html.slice(gardenStart,gardenEnd);
 const roomStart=gardenMarkup.indexOf('<section data-garden-scene="room"');
 const outdoorStart=gardenMarkup.indexOf('<section data-garden-scene="outdoors"');
 const roomMarkup=gardenMarkup.slice(roomStart,outdoorStart);
 assert.equal((roomMarkup.match(/data-page="diary"/g)||[]).length,1);
 assert.equal((html.match(/<div id="view-diary"/g)||[]).length,1);
 assert.doesNotMatch(gardenMarkup,/Garden notes|garden-note|garden-journal|open-journal|data-garden-scene="journal"/i);
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 const homeStart=gardenCss.indexOf('.garden-overlay.garden-room-home {');
 const homeRule=gardenCss.slice(homeStart,gardenCss.indexOf('}',homeStart));
 const cardStart=gardenCss.indexOf('.garden-room-card {');
 const cardRule=gardenCss.slice(cardStart,gardenCss.indexOf('}',cardStart));
 const sceneStart=gardenCss.indexOf('.garden-room-scene {');
 const sceneRule=gardenCss.slice(sceneStart,gardenCss.indexOf('}',sceneStart));
 assert.notEqual(homeStart,-1);
 assert.ok(homeRule.includes('url("./garden-room-background.jpg")'));
 assert.ok(homeRule.includes('background-size:cover'));
 assert.ok(garden.includes("overlay.classList.toggle('garden-room-home', sceneName === 'room')"));
 assert.ok(!cardRule.includes('background-image'));
 assert.ok(sceneRule.includes('width:100%'));
 assert.ok(!sceneRule.includes('background-image'));
 assert.ok(gardenCss.includes('backdrop-filter:blur(7px)'));
 assert.equal([...gardenCss].filter(char=>char==='{').length,[...gardenCss].filter(char=>char==='}').length);
 assert.ok(existsSync(new URL('../assets/garden-room-background.jpg',import.meta.url)));
});

test('the fixed viewport uses full-width responsive checklist content without transform scaling',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 assert.match(html,/name="viewport" content="width=device-width, initial-scale=1\.0"/);
 assert.match(appCss,/html,body\s*\{[^}]*overflow:hidden/s);
 assert.match(appCss,/body\s*\{[^}]*position:fixed/s);
 assert.match(appCss,/\.garden-checklist-scene main\s*\{[^}]*overflow-y:auto/s);
 // The Diary editor has its own internal scroll area; the fixed shell and checklist remain viewport-fitted.
 assert.match(appCss,/\.garden-checklist-scene main\s*\{[^}]*width:100%/s);
 assert.match(appCss,/\.checklist-fit-content\s*\{[^}]*width:100%[^}]*transform:none/s);
 assert.doesNotMatch(appCss,/transform-origin:top center/);
 assert.doesNotMatch(appCss,/width:calc\(100%\s*\/\s*var\(--checklist-fit-scale\)\)/);
 assert.doesNotMatch(app,/fitChecklistToViewport|--checklist-fit-scale/);
 assert.doesNotMatch(app,/scrollIntoView\s*\(/);
 assert.match(app,/if \(checklistMain\) checklistMain\.scrollTop = 0/);
 assert.match(appCss,/\.garden-checklist-scene main button\s*\{[^}]*min-height:44px/s);
 assert.match(appCss,/\.checklist-date-input\s*\{[^}]*font-size:16px/);
 assert.match(gardenCss,/\.garden-overlay\s*\{[^}]*overflow:hidden/s);
 assert.doesNotMatch(gardenCss,/overflow-y:\s*hidden/);
});
test('Health Checklist header is compact and preserves navigation, date selection, and reset actions',()=>{
 const headerStart=html.indexOf('<header id="checklist-header"');
 const headerEnd=html.indexOf('</header>',headerStart)+9;
 const header=html.slice(headerStart,headerEnd);
 assert.ok(header.includes('My Health Checklist'));
 assert.ok(header.includes('data-page="garden"'));
 assert.ok(header.includes('>Room</button>'));
 assert.ok(header.includes('id="currentDate"'));
 assert.ok(header.includes('data-change-action="handleDateChange"'));
 assert.ok(header.includes('id="device-clock"'));
 assert.ok(header.includes('data-action="resetDayData"'));
 assert.ok(header.includes('>Reset</button>'));
 assert.doesNotMatch(header,/1 Corinthians 16:14|Faith & Focus: Daily Armor/);
 assert.ok(app.includes('function updateDeviceClock()'));
 assert.ok(app.includes('new Intl.DateTimeFormat(undefined,'));
 assert.ok(app.includes('window.setInterval(updateDeviceClock,15000)'));
 assert.ok(app.includes("document.getElementById('currentDate').value=today"));
 const clockFunction=app.slice(app.indexOf('function updateDeviceClock()'),app.indexOf('function showPage(',app.indexOf('function updateDeviceClock()')));
 assert.ok(clockFunction.includes('new Date()'));
 assert.ok(clockFunction.includes('clock.dateTime = now.toISOString()'));
 assert.doesNotMatch(clockFunction,/timeZone:/);
 assert.ok(appCss.includes('#view-checklist > header'));
 assert.ok(appCss.includes('padding:.28rem .7rem'));
 assert.ok(appCss.includes('.checklist-header-title'));
 assert.ok(appCss.includes('.checklist-device-clock'));
 assert.ok(appCss.includes('@media (max-width:620px)'));
});
test('guide and finale overlays keep their controls reachable on short screens',()=>{
 assert.match(appCss,/#anim-modal\s*\{[^}]*overflow-y:auto/s);
 assert.match(appCss,/#modal-content-box\s*\{[^}]*max-height:calc\(100dvh - 2rem\)[^}]*overflow-y:auto/s);
 assert.match(appCss,/#modal-complete-btn\s*\{min-height:48px/);
 assert.match(appCss,/#grand-finale-overlay\s*\{[^}]*overflow-y:auto/s);
 assert.doesNotMatch(appCss,/\.ecosystem-canvas,\.ecosystem-svg\s*\{display:none/);
});
test('checklist layout preserves browser zoom and adapts at phone widths',()=>{
 assert.doesNotMatch(html,/user-scalable=no|maximum-scale\s*=\s*1/i);
 assert.match(appCss,/@media \(max-width:620px\)/);
 assert.match(appCss,/@media \(max-width:380px\)/);
 assert.match(appCss,/#view-checklist > header\s*\{[^}]*flex-flow:row wrap/s);
 assert.match(appCss,/\.garden-checklist-scene main\s*\{[^}]*overflow-y:auto/s);
});
test('breathing guide uses a single explicit modal action and completes five 4-2-6 cycles',()=>{
 assert.match(app,/function handleModalPrimaryAction\(\)/);
 assert.match(app,/activeModalAction\s*=\s*'start-breathing'/);
 assert.match(app,/activeModalAction\s*=\s*'complete'/);
 assert.match(app,/function startBreathingExercise\(\)/);
 assert.match(app,/breathingCycle > 5/);
 assert.doesNotMatch(app,/button\.onclick\s*=/);
 assert.match(appCss,/@keyframes guide-breath-in/);
 assert.match(appCss,/@keyframes guide-breath-out/);
});
test('water animation runs for five seconds before asking the user to take their turn',()=>{
 assert.match(app,/drinkGuideTimeout\s*=\s*setTimeout\([\s\S]*?\},\s*5000\)/);
 assert.match(app,/Now it is your turn. Have water if appropriate for you/);
 assert.match(app,/I've had my water. Show my checkbox/);
 assert.match(app,/activeModalAction\s*=\s*'waiting-for-drink'/);
});
test('animal stickers are removed from checklist launchers while Show me animations remain',()=>{
 assert.match(app,/guideButton\.innerHTML = '<span class="guide-play-icon"/);
 assert.doesNotMatch(app,/guide-buddy/);
 const guideBlock=app.slice(app.indexOf('const guideContent'),app.indexOf('function stopBreathingTimer'));
 assert.doesNotMatch(guideBlock,/🐻|🐰|🐱|🐼|🐨|🦊|🐣|🐥|🦉/);
 assert.match(app,/guide-person /);
 assert.match(app,/function buildStretchingCartoon/);
});

test('the active checklist scene keeps hidden checklist cards hidden',()=>{
 assert.match(appCss,/\.garden-checklist-scene:not\(\.hidden\)\s*\{\s*display:flex/);
 assert.match(html,/id=\"card-step-1\"[^>]*class=\"[^\"]*step-card/);
 assert.match(html,/id=\"card-step-2\"[^>]*class=\"[^\"]*step-card[^\"]*hidden/);
 assert.match(html,/id=\"card-step-6\"[^>]*class=\"[^\"]*step-card[^\"]*hidden/);
});


test('repository text files avoid em dash punctuation',()=>{
 const textFiles=[
  '../.github/workflows/build-tailwind.yml',
  '../.github/workflows/tests.yml',
  '../LICENSE.txt',
  '../README.md',
  '../index.html',
  '../manifest.json',
  '../package.json',
  '../tailwind.config.cjs',
  '../assets/app-gate.js',
  '../assets/app.css',
  '../assets/app.js',
  '../assets/garden-model.js',
  '../assets/garden.css',
  '../assets/garden.js',
  '../assets/location-checkin.js',
  '../assets/voice-note-store.js',
  '../assets/fonts/OFL-Lexend.txt',
  '../assets/tailwind.generated.css',
  '../assets/tailwind.input.css',
  '../assets/writing-security.js',
  './app-gate.test.mjs',
  './app-structure.test.mjs',
  './garden-model.test.mjs',
  './location-checkin.test.mjs',
  './voice-note-store.test.mjs'
 ];
 const emDash=String.fromCodePoint(0x2014);
 for(const path of textFiles){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.equal(source.includes(emDash),false,path);
 }
});

test('Health Checklist hides the shared shell headers and keeps one compact toolbar',()=>{
 assert.match(garden,/overlay\.classList\.toggle\('garden-checklist-active', sceneName === 'checklist'\)/);
 assert.match(garden,/sceneName === 'checklist' \? byId\('checklist-page-title'\) : heading/);
 assert.match(html,/id="checklist-page-title" tabindex="-1"/);
 assert.match(html,/<header id="checklist-header"/);
 assert.match(appCss,/#little-garden\.garden-checklist-active \.garden-topbar/);
 assert.match(appCss,/#little-garden\.garden-checklist-active \.garden-screen-title/);
 assert.match(appCss,/#little-garden\.garden-checklist-active \.garden-intro/);
 assert.match(appCss,/#little-garden\.garden-checklist-active \.garden-status/);
});
test('Interactive Ecosystem and trophy rewards appear only in the Grand Finale, not among checklist cards',()=>{
 const checklistStart=html.indexOf('<div id="view-checklist"');
 const checklistEnd=html.indexOf('<!-- 🌟 ANIMATION MODAL POPUP -->',checklistStart);
 assert.ok(checklistStart>=0 && checklistEnd>checklistStart,'Checklist must end before its animation modal');
 const checklistMarkup=html.slice(checklistStart,checklistEnd);
 const finaleStart=html.indexOf('<div id="grand-finale-overlay"');
 const scriptsStart=html.indexOf('<!-- Scripts Engine -->',finaleStart);
 const finaleMarkup=html.slice(finaleStart,scriptsStart);
 assert.doesNotMatch(checklistMarkup,/id="ecosystem-panel"|id="trophy-banner"/);
 assert.match(finaleMarkup,/id="trophy-banner"/);
 assert.match(finaleMarkup,/id="ecosystem-panel"/);
 assert.ok(finaleMarkup.indexOf('id="trophy-banner"') < finaleMarkup.indexOf('id="ecosystem-panel"'));
 assert.equal((html.match(/id="ecosystem-panel"/g)||[]).length,1);
 assert.equal((html.match(/id="trophy-banner"/g)||[]).length,1);
 assert.match(finaleMarkup,/All 6 Cards Completed!/);
 assert.match(finaleMarkup,/\+100 Daily Confidence Points/);
 assert.match(finaleMarkup,/Claim Victory/);
 assert.match(appCss,/\.finale-ecosystem-card/);
});
test('The ecosystem canvas is measured after the Grand Finale opens and completion points remain idempotent',()=>{
 const start=app.indexOf('function checkSectionCompletion()');
 const end=app.indexOf('function closeGrandFinale()',start);
 const completion=app.slice(start,end);
 assert.match(completion,/grandFinale\.classList\.remove\('hidden'\)/);
 assert.match(completion,/requestAnimationFrame\(\(\) => \{\s*resizeEcosystemCanvas\(\);\s*updateEcosystemTree\(\);\s*\}\)/);
 assert.match(completion,/localStorage\.getItem\(scoreAwardedKey\)/);
 assert.match(completion,/localStorage\.setItem\(scoreAwardedKey, 'true'\)/);
 assert.match(completion,/grandFinale\.classList\.add\('hidden'\)/);
 assert.match(app,/function updateEcosystemTree\(animate = \{\}\)/);
});


test('Lexend is self-hosted and applied consistently across every app scene',()=>{
 const fontCss=readFileSync(new URL('../assets/lexend.css',import.meta.url),'utf8');
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 const license=readFileSync(new URL('../assets/fonts/OFL-Lexend.txt',import.meta.url),'utf8');
 assert.ok(html.includes('href="./assets/lexend.css"'));
 assert.ok(html.includes("font-src 'self' data:"));
 assert.equal(html.includes('fonts.googleapis.com')||html.includes('fonts.gstatic.com'),false);
 assert.ok(html.indexOf('href="./assets/lexend.css"')<html.indexOf('tailwind.generated.css'));
 assert.ok(fontCss.includes('font-family: "Lexend"'));
 assert.ok(fontCss.includes('font-weight: 100 900'));
 assert.ok(fontCss.includes('font-display: swap'));
 const payload=fontCss.split('data:font/woff2;base64,')[1]?.split('")')[0]||'';
 assert.ok(payload.length>40000);
 assert.equal(payload.length%4,0);
 assert.equal(/[^A-Za-z0-9+/=]/.test(payload),false);
 assert.equal(payload.startsWith('d09GMg'),true);
 assert.ok(appCss.includes('--app-font-family: "Lexend"'));
 assert.ok(appCss.includes('html, body, body * {'));
 assert.ok(appCss.includes('code, kbd, pre, samp { font-family: var(--app-font-family); }'));
 assert.ok(appCss.includes('.heading-font, .handwriting { font-family: var(--app-font-family); }'));
 assert.ok(gardenCss.includes('.garden-brand { font-family: var(--app-font-family);'));
 assert.equal(/font-family: (Georgia|cursive)/i.test(appCss+gardenCss),false);
 assert.ok(license.includes('SIL OPEN FONT LICENSE Version 1.1'));
 assert.ok(existsSync(new URL('../assets/lexend.css',import.meta.url)));
});


test('unified vault login derives separate credentials and synchronizes encrypted daily packets',()=>{
 const cryptoModule=readFileSync(new URL('../assets/vault-crypto.js',import.meta.url),'utf8');
 const sync=readFileSync(new URL('../assets/vault-sync.js',import.meta.url),'utf8');
 const session=readFileSync(new URL('../assets/vault-session.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../worker.js',import.meta.url),'utf8');
 const wrangler=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(cryptoModule,/VAULT_KDF_ITERATIONS = 600000/);
 assert.match(cryptoModule,/MIN_PASSPHRASE_LENGTH = 12/);
 assert.match(cryptoModule,/MAX_PASSPHRASE_LENGTH = 128/);
 assert.match(cryptoModule,/deriveBits/);
 assert.match(cryptoModule,/AES-GCM/);
 assert.match(cryptoModule,/VAULT_ID_DOMAIN/);
 assert.match(cryptoModule,/writeToken/);
 assert.match(session,/SESSION_INACTIVITY_MS = 15 \* 60 \* 1000/);
 assert.match(session,/deriveVaultLoginMaterial/);
 assert.match(session,/finishVaultLogin/);
 assert.match(session,/recoverVaultMasterKey/);
 assert.match(session,/wipeWriteToken/);
 assert.doesNotMatch(session,/sessionStorage/);
 assert.match(sync,/setTimeout\([\s\S]*?5000\)/);
 assert.match(sync,/X-App-Client/);
 assert.match(sync,/X-Write-Token/);
 assert.match(sync,/encryptDailyBundle/);
 assert.match(sync,/decryptDailyBundle/);
 assert.match(sync,/putLocalDailyPacket/);
 assert.match(sync,/faith_focus_location_checkins_v1_/);
 assert.match(worker,/MAX_REQUEST_BYTES = 1024 \* 1024/);
 assert.match(worker,/APP_ORIGIN = "https:\/\/protegeeballe-jpg\.github\.io"/);
 assert.match(worker,/X-App-Client/);
 assert.match(worker,/write-token-sha256/);
 assert.match(worker,/constantTimeEqual/);
 assert.match(worker,/VaultCoordinator/);
 assert.match(worker,/409/);
 assert.match(wrangler,/binding = "VAULT_PACKETS"/);
 assert.match(wrangler,/class_name = "VaultCoordinator"/);
 assert.match(wrangler,/new_sqlite_classes = \["VaultCoordinator"\]/);
});

test('Google Drive APIs and Gist credentials are removed from the active app; JSON export is local-only',()=>{
 const backup=readFileSync(new URL('../assets/local-backup.js',import.meta.url),'utf8');
 assert.match(html,/id="vault-export-button"/);
 assert.match(html,/id="vault-import-button"/);
 assert.match(html,/id="vault-import-file"/);
 assert.match(backup,/application\/json/);
 assert.match(backup,/createObjectURL/);
 assert.match(backup,/exportEncryptedVaultPackets/);
 assert.match(backup,/importEncryptedVaultPackets/);
 assert.doesNotMatch(html,/drive-sync\.js|gist-sync\.js|drive-sync-button|gist-sync-key/);
 assert.doesNotMatch(html,/https:\/\/accounts\.google\.com|https:\/\/www\.googleapis\.com/);
});

test('the exact restrictive CSP preserves watercolor image, CSS, and blob audio sources',()=>{
 const exact="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://faith-focus-proxy.nine-westhigh.workers.dev; font-src 'self' data:; object-src 'none'; base-uri 'self';";
 const home=readFileSync(new URL('../home.html',import.meta.url),'utf8');
 const match=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
 const homeMatch=home.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
 assert.equal(match?.[1],exact);
 assert.equal(homeMatch?.[1],exact);
 assert.match(readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8'),/url\("\.\/garden-room-background\.jpg"\)/);
 assert.match(html,/id="record-btn"/);
 assert.match(html,/voice notes/i);
});

test('Diary voice notes are saved persistently, encrypted, and preserved by checklist reset',()=>{
  assert.match(html,/id="diary-voice-notes"/);
  assert.match(html,/id="diary-voice-note-list"/);
  assert.match(html,/Voice notes are encrypted with your account key/);
  assert.doesNotMatch(html,/audio-container|diary-audio|temporary playback in this session/);
  assert.match(app,/savePrivateVoiceNoteForDate\(dateString, blob\)/);
  assert.match(app,/loadPrivateVoiceNotesForDate\(dateString\)/);
  assert.match(app,/mediaRecorder\?\.mimeType/);
  assert.doesNotMatch(app,/audio\/mp3/);
  assert.match(app,/registerVoiceNoteStopHandler\(stopActiveVoiceRecording\)/);
  assert.match(writing,/function savePrivateVoiceNoteForDate\(dateStr,blob\)/);
  assert.match(writing,/await stopRegisteredVoiceNoteRecording\(\)/);
  assert.match(writing,/document\.dispatchEvent\(new CustomEvent\('private-writing:locked'\)\)/);
  assert.match(voiceNoteStore,/indexedDB\.open/);
  assert.match(voiceNoteStore,/crypto\.subtle\.encrypt/);
  assert.match(voiceNoteStore,/crypto\.subtle\.decrypt/);
  assert.match(voiceNoteStore,/export async function exportEncryptedVoiceNotes/);
  assert.match(voiceNoteStore,/export async function restoreEncryptedVoiceNotes/);
  const resetStart=app.indexOf('async function resetDayData()');
  const resetEnd=app.indexOf('async function toggleVoiceRecording()',resetStart);
  const dailyReset=app.slice(resetStart,resetEnd);
  assert.doesNotMatch(dailyReset,/removeItem\([^)]*(?:voice|diary|location)/i);
  assert.doesNotMatch(dailyReset,/restoreEncryptedVoiceNotes|clearDiaryVoiceNotePlayback/);
  const vaultSync=readFileSync(new URL('../assets/vault-sync.js',import.meta.url),'utf8');
  assert.match(vaultSync,/exportEncryptedVoiceNotesForDate/);
  assert.match(vaultSync,/restoreEncryptedVoiceNotesForDate/);
  assert.match(vaultSync,/voiceNotes/);
});

test('Diary editor scrolls within its fixed viewport so the Record Voice Note button remains reachable',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 assert.ok(gardenCss.includes('#view-diary:not(.hidden) > .card-lavender {'));
 assert.ok(gardenCss.includes('#diary-editor-panel:not(.hidden) {'));
 assert.ok(gardenCss.includes('overflow-y:auto;'));
 assert.ok(gardenCss.includes('-webkit-overflow-scrolling:touch;'));
 assert.ok(gardenCss.includes('#diary-editor-panel #record-btn {'));
 assert.ok(gardenCss.includes('min-height:2.5rem;'));
 assert.ok(html.includes('id="record-btn" data-action="toggleVoiceRecording"'));
 assert.ok(app.includes('toggleVoiceRecording:()=>toggleVoiceRecording()'));
});

test('Personal Diary notebook organizes written entries, locations, and voice notes by local date',()=>{
  assert.match(html,/id="diary-archive-button"/);
  assert.match(html,/data-action="openDiaryArchive"/);
  assert.match(html,/aria-label="Open your Diary notebook"/);
  assert.match(html,/id="diary-archive-panel"/);
  assert.match(html,/role="dialog" aria-modal="true" aria-labelledby="diary-archive-heading"/);
  assert.match(html,/id="diary-archive-date-list"/);
  assert.match(html,/id="diary-archive-entry-written"/);
  assert.match(html,/id="diary-archive-entry-locations"/);
  assert.match(html,/id="diary-archive-entry-voice-notes"/);
  assert.match(html,/data-action="closeDiaryArchive"/);
  assert.match(html,/data-action="backDiaryArchiveList"/);
  assert.match(app,/async function collectDiaryArchiveDates\(\)/);
  assert.match(app,/WRITING_DIARY_PREFIX/);
  assert.match(app,/LOCATION_CHECKIN_STORAGE_PREFIX/);
  assert.match(app,/exportPrivateVoiceNotes\(\)/);
  assert.match(app,/right\.dateString\.localeCompare\(left\.dateString\)/);
  assert.match(html,/id="diary-return-today"/);
  assert.match(html,/data-action="returnToCurrentDiary"/);
  assert.match(app,/editor\.readOnly = true/);
  assert.match(app,/recordButton\.disabled = true/);
  assert.match(app,/document\.getElementById\('diary-return-today'\)\?\.classList\.remove\('hidden'\)/);
  assert.match(app,/function restoreCurrentDiaryDate\(\)/);
  assert.match(app,/openDiaryArchive:\(\)=>openDiaryArchive\(\)/);
  assert.match(app,/writingCryptoKey && diaryViewingHistoricalDate/);
  assert.match(app,/writingCryptoKey && !diaryViewingHistoricalDate/);
  assert.match(appCss,/\.diary-return-today\s*\{/);
  assert.match(app,/async function openDiaryArchiveDate\(dateString\)/);
  assert.match(app,/await loadPrivateWritingForDate\(dateString\)/);
  assert.match(app,/writingLoadedDate !== dateString/);
  assert.match(app,/await savePrivateWritingForDate\(previousDate\)/);
  assert.match(app,/loadLocationCheckinEntries\(localStorage, dateString\)/);
  assert.match(app,/loadPrivateVoiceNotesForDate\(dateString\)/);
  assert.match(app,/function formatDiaryArchiveDate\(dateString\)/);
  assert.match(app,/openDiaryArchiveDate:el=>openDiaryArchiveDate\(el\.dataset\.date\)/);
  assert.match(writing,/export async function readPrivateDiaryEntryForDate\(dateStr\)/);
  assert.match(writing,/decryptPrivatePayload\('diary',dateStr,record,writingCryptoKey\)/);
  assert.match(app,/function getDeviceLocalDateString\(/);
  assert.match(app,/dateInput\?\.value === lastObservedDeviceDate/);
  assert.match(appCss,/\.diary-archive-panel\s*\{/);
  assert.match(appCss,/\.diary-archive-panel:not\(\.hidden\)\s*\{\s*display:flex/);
  assert.match(appCss,/\.diary-archive-panel\.hidden\s*\{\s*display:none/);
  assert.match(html,/id="diary-archive-panel" class="diary-archive-panel hidden"/);
  assert.match(appCss,/\.diary-notebook-button\s*\{/);
});

test('public legal pages accurately describe the encrypted vault and local JSON fallback',()=>{
 const home=readFileSync(new URL('../home.html',import.meta.url),'utf8');
 const privacy=readFileSync(new URL('../privacy.html',import.meta.url),'utf8');
 const terms=readFileSync(new URL('../terms.html',import.meta.url),'utf8');
 assert.match(home,/Application Privacy Policy/);
 assert.match(home,/Terms of Service/);
 assert.match(home,/Automatic encrypted vault sync/);
 assert.match(privacy,/Cloudflare KV/);
 assert.match(privacy,/AES-256-GCM/);
 assert.match(privacy,/12 characters/);
 assert.match(terms,/not a medical device/);
 assert.match(terms,/username and passphrase/i);
 assert.match(terms,/local JSON/i);
 assert.match(html,/href="\.\/privacy\.html"/);
 assert.match(html,/href="\.\/terms\.html"/);
 assert.match(readme,/Encrypted JSON export and import/);
});

test('checklist controls remain compact and backup controls are comfortably sized inside Settings',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 assert.match(appCss,/#view-checklist #btn-prev/);
 assert.match(appCss,/#view-checklist #btn-next/);
 assert.match(appCss,/min-height:32px/);
 assert.match(appCss,/width:5\.7rem/);
 assert.match(appCss,/min-width:3\.1rem/);
 assert.match(appCss,/checklist-reset-button/);
 assert.match(gardenCss,/\.settings-modal \.drive-sync-panel \.garden-action-button/);
 assert.match(gardenCss,/min-height:\s*38px/);
 assert.match(html,/id="vault-export-button"/);
 assert.match(html,/id="vault-lock-button"/);
 assert.match(html,/id="btn-prev"/);
 assert.match(html,/id="btn-next"/);
});


test('phone checklist toolbar stays compact and next-card navigation remains visible',()=>{
 const mobileRules=appCss.slice(appCss.lastIndexOf('/* Phone layout:'));
 assert.match(mobileRules,/@media \(max-width:620px\)/);
 assert.match(mobileRules,/width:fit-content/);
 assert.match(mobileRules,/flex-flow:row nowrap/);
 assert.match(mobileRules,/checklist-date-input/);
 assert.match(mobileRules,/display:none !important/);
 assert.match(mobileRules,/position:fixed !important/);
 assert.match(mobileRules,/checklist-step-navigation/);
 assert.match(mobileRules,/safe-area-inset-bottom/);
 assert.match(html,/class="checklist-step-navigation flex justify-between items-center mt-6"/);
});

test('Settings modal and backup disclosures adapt to narrow phone screens',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 const settingsRules=gardenCss.slice(gardenCss.indexOf('/* Shared Settings control'));
 assert.match(settingsRules,/@media \(max-width: 520px\)/);
 assert.match(settingsRules,/width:\s*calc\(100% - \.8rem\)/);
 assert.match(settingsRules,/max-height:\s*min\(92dvh,\s*48rem\)/);
 assert.match(settingsRules,/settings-disclosure > \.drive-sync-panel/);
 assert.match(html,/id="vault-export-button"/);
});


test('app-wide buttons share one Lexend label size while icon-only controls remain distinct',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 const legalCss=readFileSync(new URL('../assets/legal.css',import.meta.url),'utf8');
 assert.match(gardenCss,/:root\s*\{[^}]*--ui-button-font-size:\s*\.78rem/s);
 assert.match(gardenCss,/body \*::after/);
 assert.ok(gardenCss.includes('font-size:var(--ui-button-font-size) !important;'));
 assert.ok(appCss.includes('font-size:var(--ui-button-font-size) !important;'));
 assert.match(legalCss,/font-family: "Lexend".*!important/);
 assert.ok(legalCss.includes('font-size: .78rem !important;'));
 assert.match(gardenCss,/max-width: min\(100%, 24rem\)/);
 assert.match(gardenCss,/max-height: min\(86dvh, 42rem\)/);
 assert.match(gardenCss,/padding: \.8rem !important/);
});
 
test('phone checklist date, clock, and Reset text use matching compact sizes',()=>{
 const dateRules=appCss.slice(appCss.lastIndexOf('/* Match the phone date text'));
 assert.match(dateRules,/@media \(max-width:620px\)/);
 assert.match(dateRules,/checklist-date-input\s*\{[^}]*font-size:\.58rem !important/s);
 assert.match(dateRules,/checklist-reset-button\s*\{[^}]*font-size:var\(--ui-button-font-size\) !important/s);
 assert.match(appCss,/checklist-device-clock\s*\{[^}]*font-size:\.58rem !important/s);
});

test('the four Card 1 checkboxes capture one-time local coordinates without changing the card design',()=>{
 const firstCardStart=html.indexOf('<!-- CARD 1 -->');
 const firstCardEnd=html.indexOf('<!-- CARD 2 -->',firstCardStart);
 const firstCard=html.slice(firstCardStart,firstCardEnd);
 const locationIds=['loc-home','loc-office','loc-house','loc-out'];
 for(const id of locationIds){
  assert.match(firstCard,new RegExp('type="checkbox"[^>]*class="app-chk sec-1"[^>]*data-id="'+id+'"'));
 }
 assert.equal((firstCard.match(/class="app-chk sec-1"/g)||[]).length,4);
 assert.match(app,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(app,/enableHighAccuracy: true, maximumAge: 0, timeout: 15000/);
 assert.match(app,/saveLocationCheckin\(localStorage, dateString, locationId, position\)/);
 assert.doesNotMatch(app,/navigator\.geolocation\.watchPosition/);
 assert.match(html,/Only you can view these details in the App/);
 const locationModule=readFileSync(new URL('../assets/location-checkin.js',import.meta.url),'utf8');
 const vaultSync=readFileSync(new URL('../assets/vault-sync.js',import.meta.url),'utf8');
 assert.match(locationModule,/faith_focus_location_checkins_v1_/);
 assert.match(vaultSync,/faith_focus_location_checkins_v1_/);
 const locationChangeStart=app.indexOf("if (!checkbox?.matches?.('#card-step-1 .app-chk.sec-1')) return;");
 const locationChangeEnd=app.indexOf("window.addEventListener('faith-focus:app-unlocked'",locationChangeStart);
 assert.ok(locationChangeStart>=0 && locationChangeEnd>locationChangeStart);
 const locationChangeHandler=app.slice(locationChangeStart,locationChangeEnd);
 assert.match(locationChangeHandler,/if \(checkbox.checked\) requestLocationCheckin\(checkbox\);/);
 assert.doesNotMatch(locationChangeHandler,/removeLocationCheckin|locationCaptureVersions|else/);
 assert.doesNotMatch(app,/removeLocationCheckin|locationCaptureVersions/);
 assert.match(app,/loadLocationCheckinEntries/);
 assert.match(locationModule,/entries\.push\(entry\)/);
 assert.match(locationModule,/function normalizeEntries\(parsed\)/);
 assert.match(garden,/garden = null;[\s\S]*setScene\('room'\)/);
 assert.doesNotMatch(app,/localStorage\.removeItem\(getLocationCheckinStorageKey/);
 assert.match(app,/function renderDiaryLocationLogs\(/);
 assert.match(app,/loadLocationCheckinEntries\(localStorage, dateString\)/);
 assert.match(html,/id="diary-location-history"/);
 assert.match(html,/id="diary-location-log"/);
 assert.match(html,/cannot be edited or removed through the App/);
 assert.match(app,/function formatLocationCheckinEntry\(/);
 assert.match(app,/function createLocationCoordinateControls\(record\)/);
 assert.match(app,/google\.com\/maps\/search/);
 assert.match(app,/copyButton\.dataset\.action = 'copyLocationCoordinates'/);
 assert.match(app,/navigator\.clipboard\?\.writeText/);
 assert.match(app,/navigator\.clipboard\.writeText\(coordinates\)/);
 assert.match(app,/document\.execCommand\('copy'\)/);
 assert.match(app,/copyLocationCoordinates:button=>copyLocationCoordinates\(button\)/);
 assert.match(app,/createLocationCoordinateControls\(record\)/);
 assert.match(app,/Coordinates copied/);
 const privacy=readFileSync(new URL('../privacy.html',import.meta.url),'utf8');
 const terms=readFileSync(new URL('../terms.html',import.meta.url),'utf8');
 assert.match(privacy,/Location check-ins/);
 assert.match(terms,/one-time current location/);
});

test('encrypted vault sync and JSON backup live in collapsible Settings sections',()=>{
 const settingsStart=html.indexOf('<dialog id="settings-modal"');
 const settingsEnd=html.indexOf('</dialog>',settingsStart);
 assert.ok(settingsStart>=0 && settingsEnd>settingsStart,'Settings must be a native modal dialog');
 assert.match(html,/id="settings-open-button"[^>]*aria-controls="settings-modal"/);
 assert.match(html,/id="settings-close-button"/);
 assert.match(html,/src="\.\/assets\/settings-modal\.js"/);
 const settings=html.slice(settingsStart,settingsEnd);
 assert.match(settings,/<details id="vault-sync-settings"/);
 assert.match(settings,/<details id="local-backup-settings"/);
 assert.match(settings,/id="vault-sync-status"/);
 assert.match(settings,/id="vault-lock-button"/);
 assert.match(settings,/id="vault-export-button"/);
 assert.match(settings,/id="vault-import-button"/);
 assert.match(settings,/id="vault-import-file"/);
 assert.doesNotMatch(settings,/gist-sync|drive-connect|Google Drive|GitHub Gist|Sync Key/);
 const roomStart=html.indexOf('<section data-garden-scene="room"');
 const outdoorStart=html.indexOf('<section data-garden-scene="outdoors"',roomStart);
 const roomMarkup=html.slice(roomStart,outdoorStart);
 assert.doesNotMatch(roomMarkup,/vault-sync-settings|local-backup-settings/);
});



test('Sign Up, Recovery and Legacy Upgrade use the same original 20-question security bank',()=>{
 const questionTexts=[...accountSecurity.matchAll(/text: '([^']+)'|text: "([^"]+)"/g)].map(match=>match[1]||match[2]);
 assert.equal(questionTexts.length,20);
 for(const prefix of ['signup','recovery','legacy']){
  for(let number=1;number<=3;number++){
   const selectorStart=html.indexOf(`<select id="${prefix}-question-${number}"`);
   assert.notEqual(selectorStart,-1,`Missing ${prefix} question selector ${number}`);
   const contentStart=html.indexOf('>',selectorStart)+1;
   const closeIndex=html.indexOf('</select>',contentStart);
   assert.ok(closeIndex>contentStart,`Unclosed ${prefix} question selector ${number}`);
   const selectMarkup=html.slice(contentStart,closeIndex);
   const options=[...selectMarkup.matchAll(/<option value="([0-9]+)">([^<]+)</g)];
   assert.equal(options.length,20,`${prefix} selector ${number} must expose 20 questions`);
   assert.deepEqual(options.map(option=>Number(option[1])),Array.from({length:20},(_,i)=>i+1));
   assert.deepEqual(options.map(option=>option[2].replaceAll('&amp;','&')),questionTexts.map((question,i)=>`${i+1}. ${question}`));
  }
 }
 assert.match(serviceWorker,/faith-focus-shell-v3-account-recovery-questions/);
});
