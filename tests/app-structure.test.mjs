import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const appCss=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
const garden=readFileSync(new URL('../assets/garden.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../assets/writing-security.js',import.meta.url),'utf8');
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
const packageMetadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const appIcon=readFileSync(new URL('../assets/icon.svg',import.meta.url),'utf8');
test('Faith & Focus branding, PWA metadata, and PIN copy stay aligned',()=>{
 assert.match(html,/<title>Faith &amp; Focus \| Your Daily Armor<\/title>|<title>Faith & Focus \| Your Daily Armor<\/title>/);
 assert.match(html,/Faith & Focus: Daily Armor/);
 assert.match(html,/The Forge Room/);
 assert.match(garden,/room: 'The Forge Room'/);
 assert.match(garden,/outdoors: 'The Garden'/);
 assert.match(html,/6–12 digit app PIN/);
 assert.doesNotMatch(html,/4-digit app PIN/);
 assert.equal(manifest.name,'Faith & Focus: Daily Armor');
 assert.equal(manifest.short_name,'Faith & Focus');
 assert.equal(packageMetadata.name,'faith-focus-daily-armor');
 assert.match(readme,/^# Faith & Focus: Daily Armor/m);
 assert.doesNotMatch(readme,/Daily Mindful Pokes/i);
 assert.match(appIcon,/<title id="icon-title">Faith &amp; Focus: Daily Armor<\/title>/);
 assert.match(appIcon,/shield-fill/);
});
test('HTML uses a local app module and no inline handlers or scripts',()=>{
 assert.match(html,/type="module" src="\.\/assets\/app\.js"/);
 assert.doesNotMatch(html,/\son(?:click|change|input|submit)\s*=/i);
 assert.doesNotMatch(html,/<script\s*>/i);
 assert.match(html,/id="app-pin-form"/);
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
 assert.match(dailyReset,/Reset today's checklist/);
 assert.doesNotMatch(dailyReset,/GARDEN_STORAGE_KEY|daily_mindful_pokes_garden_v1/);
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
 assert.doesNotMatch(gardenCss,/overflow-y:\s*auto/);
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
  '../assets/fonts/OFL-Lexend.txt',
  '../assets/icon.svg',
  '../assets/tailwind.generated.css',
  '../assets/tailwind.input.css',
  '../assets/writing-security.js',
  './app-gate.test.mjs',
  './app-structure.test.mjs',
  './garden-model.test.mjs'
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
 const gardenStatus=html.indexOf('<p id="garden-status"',checklistStart);
 const checklistMarkup=html.slice(checklistStart,gardenStatus);
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


test('Google Drive remains optional and manually user-controlled',()=>{
 const drive=readFileSync(new URL('../assets/drive-sync.js',import.meta.url),'utf8');
 assert.match(html,/script-src 'self' https:\/\/accounts\.google\.com/);
 assert.match(html,/connect-src[^"]*https:\/\/www\.googleapis\.com/);
 assert.match(html,/id="drive-sync-panel"/);
 assert.match(html,/id="drive-connect-button"[^>]*>Google Drive Backup/);
 assert.match(drive,/https:\/\/accounts\.google\.com\/gsi\/client/);
 assert.match(drive,/requestAccessToken/);
 assert.match(drive,/https:\/\/www\.googleapis\.com\/auth\/drive\.appdata/);
 assert.match(html,/Back Up This Device/);
 assert.match(html,/Restore From Drive/);
 assert.doesNotMatch(drive,/DRIVE_BACKUP_ENABLED\s*=\s*false/);
});

test('Google Drive backup uses a strict allowlist and excludes the app PIN',()=>{
 const drive=readFileSync(new URL('../assets/drive-sync.js',import.meta.url),'utf8');
 assert.match(drive,/const GOOGLE_CLIENT_ID = '717523562646-lht84sbcpfnn6q330nd5683pjc59dhdh\.apps\.googleusercontent\.com'/);
 assert.match(drive,/parents: \['appDataFolder'\]/);
 assert.match(drive,/spaces: 'appDataFolder'/);
 assert.match(drive,/WRITING_CONFIG_KEY/);
 assert.match(drive,/dmp_diary_cipher_v1_/);
 assert.match(drive,/dmp_notes_cipher_v1_/);
 assert.match(drive,/AES-256-GCM/);
 assert.match(drive,/legacyPrivateContent\.length/);
 assert.match(drive,/PRIVATE_NOTE_IDS/);
 assert.doesNotMatch(drive,/APP_PIN_CONFIG_KEY|LEGACY_APP_PIN_KEY|user_pin/);
 assert.doesNotMatch(drive,/localStorage\.(?:setItem|getItem)\([^\n]*(?:accessToken|tokenExpiresAt|tokenClient)/);
 assert.match(drive,/window\.confirm\('Restore this backup/);
 assert.match(drive,/window\.confirm\('This will/);
 assert.match(drive,/validateBackup\(downloaded\)/);
 assert.match(drive,/const previous = new Map/);
 assert.match(drive,/const allowed = key => key === GARDEN_STORAGE_KEY/);
 assert.match(drive,/PRIVATE_NOTE_IDS\.some\(id => Object\.hasOwn\(data, id\)\)/);
 assert.match(drive,/ENCRYPTED_RECORD_PATTERN/);
 assert.match(drive,/score_awarded_/);
 assert.match(readme,/The device's app PIN verifier is deliberately excluded/);
});

test('public legal pages accurately describe optional manual Google Drive backup',()=>{
 const home=readFileSync(new URL('../home.html',import.meta.url),'utf8');
 const privacy=readFileSync(new URL('../privacy.html',import.meta.url),'utf8');
 const terms=readFileSync(new URL('../terms.html',import.meta.url),'utf8');
 assert.match(home,/Application Privacy Policy/);
 assert.match(home,/Terms of Service/);
 assert.match(home,/Optional Google Drive backup/);
 assert.match(privacy,/Optional Google Drive Backup &amp; Restore/);
 assert.match(privacy,/AES-256-GCM/);
 assert.match(privacy,/not encrypted/);
 assert.match(terms,/not a medical device/);
 assert.match(terms,/Optional Google Drive backup and restore/);
 assert.match(html,/href="\.\/privacy\.html"/);
 assert.match(html,/href="\.\/terms\.html"/);
 assert.match(readme,/Optional Google Drive Backup & Restore/);
});


test('compact checklist and Drive controls reduce visual clutter without removing controls',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 assert.match(appCss,/#view-checklist #btn-prev/);
 assert.match(appCss,/#view-checklist #btn-next/);
 assert.match(appCss,/min-height:32px/);
 assert.match(appCss,/width:5\.7rem/);
 assert.match(appCss,/min-width:3\.1rem/);
 assert.match(appCss,/checklist-reset-button/);
 assert.match(gardenCss,/\.drive-sync-panel \.garden-action-button/);
 assert.match(gardenCss,/padding:\.22rem \.32rem/);
 assert.match(gardenCss,/font-size:\.65rem/);
 assert.match(html,/id="drive-connect-button"/);
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

test('Google Drive panel and buttons use compact phone-only dimensions',()=>{
 const gardenCss=readFileSync(new URL('../assets/garden.css',import.meta.url),'utf8');
 const mobileRules=gardenCss.slice(gardenCss.lastIndexOf('/* Keep Drive controls'));
 assert.match(mobileRules,/@media \(max-width:420px\)/);
 assert.match(mobileRules,/width:min\(calc\(100% - \.8rem\), 720px\)/);
 assert.match(mobileRules,/min-height:22px/);
 assert.match(mobileRules,/font-size:\.55rem/);
 assert.match(html,/id="drive-connect-button"/);
});
