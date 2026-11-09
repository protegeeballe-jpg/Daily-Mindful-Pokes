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
 assert.match(appCss,/\.garden-checklist-scene main\s*\{[^}]*width:100%/s);
 assert.match(appCss,/\.checklist-fit-content\s*\{[^}]*width:100%[^}]*transform:none/s);
 assert.doesNotMatch(appCss,/transform-origin:top center/);
 assert.doesNotMatch(appCss,/width:calc\(100%\s*\/\s*var\(--checklist-fit-scale\)\)/);
 assert.doesNotMatch(app,/fitChecklistToViewport|--checklist-fit-scale/);
 assert.doesNotMatch(app,/scrollIntoView\s*\(/);
 assert.match(app,/if \(checklistMain\) checklistMain\.scrollTop = 0/);
 assert.match(appCss,/\.garden-checklist-scene main button\s*\{[^}]*min-height:44px/s);
 assert.match(appCss,/#currentDate\s*\{[^}]*font-size:16px/);
 assert.match(gardenCss,/\.garden-overlay\s*\{[^}]*overflow:hidden/s);
 assert.doesNotMatch(gardenCss,/overflow-y:\s*hidden/);
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
 assert.match(appCss,/\.garden-checklist-scene > header\s*\{[^}]*flex-flow:row wrap/s);
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
 assert.match(app,/Now it is your turn—have water if appropriate for you/);
 assert.match(app,/I've had my water—show my checkbox/);
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
