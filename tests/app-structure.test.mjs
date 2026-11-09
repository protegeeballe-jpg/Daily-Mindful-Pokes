import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const garden=readFileSync(new URL('../assets/garden.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../assets/writing-security.js',import.meta.url),'utf8');
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
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

test('Garden hub is a separate local module and does not replace existing features',()=>{
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
test('the health checklist and encrypted diary are scenes inside the garden hub',()=>{
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
 const homeRule=gardenCss.match(/\.garden-overlay\.garden-room-home\\s*\\{([^}]*)\\}/)?.[1]||'';
 const roomCardRule=gardenCss.match(/\\.garden-room-card\\s*\\{([^}]*)\\}/)?.[1]||'';
 const roomSceneRule=gardenCss.match(/\\.garden-room-scene\\s*\\{([^}]*)\\}/)?.[1]||'';
 assert.match(homeRule,/background-image:[\\s\\S]*garden-room-background\\.jpg/);
 assert.match(homeRule,/background-size:\\s*cover/);
 assert.match(garden,/overlay\\.classList\\.toggle\\('garden-room-home', sceneName === 'room'\\)/);
 assert.doesNotMatch(roomCardRule,/background-image/);
 assert.match(roomSceneRule,/width:\\s*100%/);
 assert.doesNotMatch(roomSceneRule,/background-image|background-size/);
 assert.match(gardenCss,/backdrop-filter:blur\\(7px\\)/);
 assert.equal([...gardenCss].filter(char=>char==='{').length,[...gardenCss].filter(char=>char==='}').length);
 assert.ok(existsSync(new URL('../assets/garden-room-background.jpg',import.meta.url)));
});
