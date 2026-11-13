let celebrationCanvas=null,celebrationContext=null,celebrationParticles=[],celebrationFrame=null;
        function confetti(options={}){
            if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
            celebrationCanvas=document.getElementById('celebration-canvas');
            if(!celebrationCanvas)return;
            if(!celebrationContext){
                try{celebrationContext=celebrationCanvas.getContext('2d');}catch(error){celebrationContext=null;}
            }
            if(!celebrationContext)return;
            const width=window.innerWidth,height=window.innerHeight,dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
            celebrationCanvas.width=Math.max(1,Math.round(width*dpr));
            celebrationCanvas.height=Math.max(1,Math.round(height*dpr));
            celebrationContext.setTransform(dpr,0,0,dpr,0,0);
            const origin=options.origin||{x:.5,y:.6};
            const cx=Math.max(0,Math.min(1,Number(origin.x??.5)))*width;
            const cy=Math.max(0,Math.min(1,Number(origin.y??.6)))*height;
            const count=Math.max(0,Math.min(140,Number(options.particleCount)||30));
            const colors=['#81c784','#ff80ab','#ffd54f','#64b5f6'];
            for(let i=0;i<count&&celebrationParticles.length<180;i++){
                const angle=-Math.PI/2+(Math.random()-.5)*(Math.PI*Math.min(1.8,(Number(options.spread)||50)/50));
                const speed=2+Math.random()*3.2;
                celebrationParticles.push({x:cx,y:cy,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-1,
                    color:colors[i%4],size:3+Math.random()*3,rotation:Math.random()*Math.PI,spin:(Math.random()-.5)*.16,life:1});
            }
            if(celebrationFrame===null)celebrationFrame=requestAnimationFrame(renderConfetti);
        }
        function renderConfetti(){
            celebrationFrame=null;
            if(!celebrationCanvas||!celebrationContext)return;
            const ctx=celebrationContext,w=window.innerWidth,h=window.innerHeight;
            ctx.clearRect(0,0,w,h);
            celebrationParticles=celebrationParticles.filter(p=>p.life>.04&&p.y<h+24);
            for(const p of celebrationParticles){
                p.x+=p.vx;p.y+=p.vy;p.vy+=.075;p.vx*=.993;p.rotation+=p.spin;p.life-=.018;
                ctx.save();ctx.globalAlpha=Math.max(0,p.life);ctx.translate(p.x,p.y);ctx.rotate(p.rotation);
                ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.65);ctx.restore();
            }
            if(celebrationParticles.length)celebrationFrame=requestAnimationFrame(renderConfetti);
            else ctx.clearRect(0,0,w,h);
        }

import {
    LOCATION_CHECKIN_OPTIONS, LOCATION_CHECKIN_STORAGE_PREFIX,
    loadLocationCheckinEntries, saveLocationCheckin
} from './location-checkin.js';
import { GARDEN_STORAGE_KEY } from './garden-model.js';
import { MAX_VOICE_NOTE_BYTES, isAllowedVoiceNoteMimeType } from './voice-note-store.js';
import { installDeviceClockRefresh } from './device-clock.js';
import { getMissedChecklistCards } from './missed-card-notifications.js';
import {
    WRITING_DIARY_PREFIX, writingCryptoKey,writingLoadedDate,getSecureWritingStorageKey,getCurrentWritingDate,
    setWritingSecurityStatus,renderDiarySecurityUI,updatePrivateWritingAccess,
    handleDiaryKeyAction,lockPrivateWriting,savePrivateWritingForDate,
    loadPrivateWritingForDate,readPrivateDiaryEntryForDate,schedulePrivateWritingSave,flushPrivateWritingQueue,flushAndSaveCurrentPrivateWriting,
    registerVoiceNoteStopHandler,stopRegisteredVoiceNoteRecording,
    savePrivateVoiceNoteForDate,loadPrivateVoiceNotesForDate,exportPrivateVoiceNotes
} from './writing-security.js';


        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let currentStep = 1;
        let lastObservedDeviceDate = null;
        let activeModalType = null;
        let activeTargetCheckboxId = null;
        let mediaRecorder, audioChunks = [];
        let activeVoiceNoteDate = null;
        let activeVoiceNoteBytes = 0;
        let activeVoiceNoteExceededLimit = false;
        let voiceRecorderStarting = null;
        let voiceNoteStopPromise = null;
        let voiceNoteStopResolve = null;
        let voiceNoteObjectUrls = [];
        let voiceNotesRenderVersion = 0;
        let diaryArchiveVoiceUrls = [];
        let diaryArchiveDateSummaries = [];
        let diaryViewingHistoricalDate = null;
        const MISSED_CARD_VICTORY_DELAY_MS = 7000;
        let missedCardReviewContext = null;
        let missedCardVictoryTimer = null;

        // Request Persistent Storage to prevent automatic browser data clearing
        async function requestPersistentStorage() {
            if (navigator.storage && navigator.storage.persist) {
                try {
                    const isPersisted = await navigator.storage.persist();
                    if (isPersisted) {
                        console.log("Storage persistence granted: Data will not be automatically cleared.");
                    } else {
                        console.warn("Storage persistence denied by browser.");
                    }
                } catch (err) {
                    console.warn("Persistent storage request failed:", err);
                }
            }
        }

        function getDeviceLocalDateString(now = new Date()) {
            return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        }

        function updateDeviceClock() {
            const now = new Date();
            const clock = document.getElementById('device-clock');
            if (clock) {
                clock.textContent = new Intl.DateTimeFormat(undefined, {
                    hour: 'numeric',
                    minute: '2-digit'
                }).format(now);
                clock.dateTime = now.toISOString();
            }

            const today = getDeviceLocalDateString(now);
            const dateInput = document.getElementById('currentDate');
            if (lastObservedDeviceDate && lastObservedDeviceDate !== today
                && !diaryViewingHistoricalDate && dateInput?.value === lastObservedDeviceDate) {
                dateInput.value = today;
                handleDateChange().catch(error =>
                    setWritingSecurityStatus('The new device date could not be loaded. Your previous Diary entries remain saved. '
                        + (error?.message || ''), 'error')
                );
            }
            lastObservedDeviceDate = today;
        }

        installDeviceClockRefresh({ windowRef: window, documentRef: document, refresh: updateDeviceClock });

        function showPage(pageId) {
            // The Forge Room is the app's home. Checklist and diary remain
            // separate feature views presented inside the shared environment.
            if (pageId === 'launcher') pageId = 'garden';
            if (pageId !== 'diary') {
                stopRegisteredVoiceNoteRecording().catch(error =>
                    setWritingSecurityStatus('Voice note recording could not be stopped cleanly. ' + (error?.message || ''), 'error')
                );
            }

            ['view-launcher', 'view-diary', 'view-checklist'].forEach(id => {
                document.getElementById(id)?.classList.add('hidden');
            });

            if (['garden', 'checklist', 'diary'].includes(pageId)) {
                const garden = document.getElementById('little-garden');
                if (!garden) return;
                if (pageId === 'garden') {
                    document.dispatchEvent(new CustomEvent('garden:open'));
                } else {
                    document.dispatchEvent(new CustomEvent('garden:show-scene', { detail: { scene: pageId } }));
                }
            } else {
                document.getElementById('view-' + pageId)?.classList.remove('hidden');
            }

            if (pageId === 'checklist') {
                renderMissedCardNotifications();
                const checklistMain = document.querySelector('#view-checklist main');
                if (checklistMain) checklistMain.scrollTop = 0;
                resizeEcosystemCanvas();
                updateEcosystemTree();
                replayEcosystemWelcome();
            }
            if (pageId === 'garden') updateScoreDisplay();
            if (pageId === 'diary') {
                renderDiarySecurityUI();
                const dateString = getCurrentWritingDate();
                if (writingCryptoKey && diaryViewingHistoricalDate) {
                    openDiaryArchiveDate(diaryViewingHistoricalDate);
                } else {
                    updateDiaryDateLabel(dateString);
                }
                if (!diaryViewingHistoricalDate && writingCryptoKey && writingLoadedDate !== dateString) {
                    loadPrivateWritingForDate(dateString)
                        .then(async () => {
                            renderDiaryLocationLogs(dateString);
                            await renderDiaryVoiceNotes(dateString);
                        })
                        .catch(error => setWritingSecurityStatus('Could not decrypt this date’s private writing. ' + (error?.message || ''),'error'));
                } else if (writingCryptoKey && !diaryViewingHistoricalDate) {
                    renderDiaryLocationLogs(dateString);
                    renderDiaryVoiceNotes(dateString).catch(error =>
                        setWritingSecurityStatus('Could not load saved voice notes. ' + (error?.message || ''), 'error')
                    );
                }
            }
        }

        function changeStep(direction) {
            const nextStep = currentStep + direction;
            if (nextStep >= 1 && nextStep <= 6) {
                document.getElementById('card-step-' + currentStep).classList.add('hidden');
                currentStep = nextStep;
                document.getElementById('location-checkin-footer')?.classList.toggle('hidden', currentStep !== 1);
                document.getElementById('card-step-' + currentStep).classList.remove('hidden');

                document.getElementById('current-step-num').innerText = currentStep;
                
                for (let i = 1; i <= 6; i++) {
                    const dot = document.getElementById('dot-' + i);
                    if (i <= currentStep) dot.classList.remove('opacity-30');
                    else dot.classList.add('opacity-30');
                }

                document.getElementById('btn-prev').disabled = (currentStep === 1);
                document.getElementById('btn-prev').classList.toggle('opacity-50', currentStep === 1);
                document.getElementById('btn-prev').classList.toggle('cursor-not-allowed', currentStep === 1);

                document.getElementById('btn-next').innerText = (currentStep === 6) ? "Finish Checklist 🏆" : "Next Card ➔";
                document.getElementById('finish-status')?.classList.add('hidden');
                const checklistMain = document.querySelector('#view-checklist main');
                if (checklistMain) checklistMain.scrollTop = 0;
            }
        }

        function handleNextStep() {
            if (currentStep === 6) {
                finishChecklist();
                return;
            }
            changeStep(1);
        }

        function isSectionComplete(sectionNumber) {
            const checks = Array.from(document.querySelectorAll('.sec-' + sectionNumber));
            if (!checks.length) return false;
            // Card 1 is a location choice: one selected place completes that card.
            return sectionNumber === 1
                ? checks.some(check => check.checked)
                : checks.every(check => check.checked);
        }

        function finishChecklist() {
            const firstIncomplete = Array.from({length:6},(_,index)=>index+1).find(section => !isSectionComplete(section));
            const status = document.getElementById('finish-status');

            if (firstIncomplete) {
                if (currentStep !== firstIncomplete) {
                    changeStep(firstIncomplete - currentStep);
                }
                status.textContent = firstIncomplete === 6
                    ? "Almost there! Release all three cloud types, then tick the completion checkbox."
                    : "Almost there! Please complete the remaining activity or activities on Card " + firstIncomplete + ".";
                status.classList.remove('hidden');
                return;
            }

            status.classList.add('hidden');
            // Completion checks own the one-time celebration. Do not reopen the
            // Grand Finale merely because the user presses Finish again.
            checkSectionCompletion();
        }


        let breathingTimer = null;
        let drinkGuideTimeout = null;
        let activeModalAction = "complete";
        let breathingCycle = 0;
        let breathingPhaseIndex = 0;
        let breathingSecondsLeft = 0;
        const breathingPhases = [
            {name:"Breathe in",seconds:4,tip:"Gently breathe in through your nose."},
            {name:"Hold softly",seconds:2,tip:"Pause softly. No straining."},
            {name:"Breathe out",seconds:6,tip:"Slowly breathe out. Let your shoulders soften."}
        ];

        const guideContent = {
            "loc-home":{title:"Find your place",line:"Pause and look around. Are you at home? Choose the place that describes where you are.",person:"🧒",prop:"🏡",action:"Take a moment to notice your surroundings."},
            "loc-office":{title:"Check in at work",line:"Take one calm look around. Are you at work right now? Choose your location when you're ready.",person:"🧑‍💻",prop:"💼",action:"Notice where you are."},
            "loc-house":{title:"A guest today",line:"Are you visiting someone else's home? Look around and choose the place that fits.",person:"👧",prop:"🏠",action:"Notice your surroundings."},
            "loc-out":{title:"Out and about",line:"You're out somewhere. Take a breath, notice your surroundings, and choose this option if it fits.",person:"🧍",prop:"🌳",action:"Pause and orient yourself."},
            "start-1":{title:"Three grateful things",line:"Let's find three small things to appreciate. They can be as simple as a safe moment, a kind word, or a warm drink.",person:"🧑",prop:"🌼",action:"Think of three things. You can jot them down mentally or in your own words."},
            "start-2":{title:"Prayer and intention",line:"Let's pause together. Set a kind intention for yourself and the people you care about. Take the moment in your own way.",person:"🧑",prop:"🙏",action:"Take a quiet moment for prayer or a positive intention."},
            "start-3":{title:"Gentle movement",line:"Let's loosen up. Roll your shoulders gently, stretch your arms, and move only within a comfortable range.",person:"🧑",prop:"🙆",action:"Try a few gentle stretches. Stop if anything hurts."},
            "start-4":{title:"A little hydration",line:"I brought my glass! Watch me take a refreshing sip. Now it's your turn. Enjoy some water at a comfortable pace.",person:"👧",prop:"🥛",action:"Drink your water. No need to rush.",drink:true},
            "mid-1":{title:"Posture and stretch",line:"Let's reset our posture. Unclench your jaw, relax your shoulders, sit or stand comfortably, then stretch gently.",person:"🧑",prop:"🧘",action:"Take a comfortable posture and stretch gently."},
            "mid-2":{title:"Breathe with me",line:"We'll do five gentle 4–2–6 cycles: breathe in for 4, pause softly for 2, and breathe out for 6. Keep it comfortable. Never force or hold if uncomfortable.",person:"🧑",prop:"🌬️",action:"Start the five guided breathing cycles.",breathing:true},
            "mid-3":{title:"Midday water break",line:"A tiny water break can help you pause. Watch me take a sip, then have some water if it's available.",person:"👧",prop:"💧",action:"Drink some water at your own pace.",drink:true},
            "mid-4":{title:"Check how you feel",line:"Let's gently check in. What emotion is here right now? What thought is asking for your attention? You don't have to judge or fix it.",person:"🧑",prop:"💗",action:"Name what you're feeling, even if the answer is 'not sure'."},
            "mid-5":{title:"Let a thought drift by",line:"Imagine a thought floating past like a cloud. You can notice it without holding on. Let it drift away in its own time.",person:"🧑",prop:"☁️",action:"Notice one thought and practice letting it pass."},
            "end-1":{title:"Three wins today",line:"Let's celebrate three things you managed today. Tiny wins count: showing up, trying again, or taking a pause.",person:"🧑",prop:"🏆",action:"Write or think of three things you feel good about."},
            "end-2":{title:"Tomorrow's priorities",line:"Let's make tomorrow feel lighter. Choose up to three priorities that matter most. They don't need to be perfect.",person:"🧑",prop:"📝",action:"Write three realistic priorities for tomorrow."},
            "end-3":{title:"Evening hydration",line:"One more gentle reminder from me: have some water if you'd like and if it suits your needs. Sip comfortably.",person:"👧",prop:"🥛",action:"Drink some water at a comfortable pace.",drink:true},
            "end-4":{title:"Give yourself a GOOD JOB poke",line:"You made it through another day. Give yourself a gentle little nose boop and say, 'Good job. I kept going.'",person:"🧑",prop:"👃✨",action:"Give yourself a gentle nose poke and a kind word."},
            "sleep-1":{title:"Gratitude for others",line:"Think of three things someone did that you appreciated today. They can be very small moments.",person:"🧑",prop:"💛",action:"Write or remember three gratitude points about others."},
            "sleep-2":{title:"Gratitude for blessings",line:"Take a quiet moment to remember three blessings or things you're thankful for today, in your own words.",person:"🧑",prop:"✨",action:"Write or remember three gratitude points."},
            "sleep-3":{title:"Screen sunset",line:"Let's give your eyes and mind a gentle break. Put your device aside for the last 30 minutes before sleep when you can.",person:"🧑",prop:"🌙📵",action:"Begin your screen-free wind-down."},
            "sleep-4":{title:"A peaceful intention",line:"Before sleep, pause for a prayer or a gentle intention. Let the day settle; you can pick things up tomorrow.",person:"🧑",prop:"🙏",action:"Take a quiet moment for prayer or intention."},
            "sleep-5":{title:"Bedtime water reminder",line:"If you're thirsty, have a comfortable sip of water. No need to drink more than feels right before bed.",person:"👧",prop:"💧",action:"Have water if you need it, at a comfortable pace.",drink:true},
            "cloud-checked":{title:"Cloud check",line:"Choose a thought or feeling you want to release. Tap one of the clouds on your card and watch it drift away. You can leave any thought alone if you're not ready.",person:"🧑",prop:"☁️💨",action:"Release a cloud thought when you're ready."}
        };

        function stopBreathingTimer() {
            if (breathingTimer) { clearInterval(breathingTimer); breathingTimer = null; }
            if (drinkGuideTimeout) { clearTimeout(drinkGuideTimeout); drinkGuideTimeout = null; }
        }


        function buildStretchingCartoon(mini = false) {
            const label = 'Two people, a man and a woman, raising their arms overhead for a gentle stretch.';
            return '<div class="stretch-demo-wrap'+(mini?' stretch-demo-preview':'')+'" role="img" aria-label="'+label+'">' +
                '<svg class="stretch-demo-svg" viewBox="0 0 320 190" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
                '<defs>' +
                    '<linearGradient id="stretch-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5fbff"/><stop offset="1" stop-color="#fff8ec"/></linearGradient>' +
                    '<linearGradient id="stretch-man-shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#76b9a7"/><stop offset="1" stop-color="#3f8778"/></linearGradient>' +
                    '<linearGradient id="stretch-woman-shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb0a8"/><stop offset="1" stop-color="#e77e91"/></linearGradient>' +
                '</defs>' +
                '<rect x="4" y="4" width="312" height="180" rx="22" fill="url(#stretch-sky)"/>' +
                '<circle class="stretch-demo-sun" cx="160" cy="26" r="11" fill="#f5cf72" opacity=".8"/>' +
                '<path d="M145 26 H133 M187 26 H175 M160 11 V3 M160 49 V41 M148 14 L142 8 M178 44 L172 38 M148 38 L142 44 M178 8 L172 14" stroke="#e8bd58" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>' +
                '<path d="M23 166 Q160 158 297 166" fill="none" stroke="#d7e7dc" stroke-width="3" stroke-linecap="round"/>' +
                '<ellipse cx="95" cy="168" rx="34" ry="5" fill="#a9c3b7" opacity=".3"/><ellipse cx="225" cy="168" rx="34" ry="5" fill="#a9c3b7" opacity=".3"/>' +

                /* Man: short dark hair, teal top and navy trousers. */
                '<g class="stretch-man">' +
                    '<path d="M78 117 Q72 137 72 160 M106 117 Q112 137 116 160" fill="none" stroke="#344b63" stroke-width="12" stroke-linecap="round"/>' +
                    '<path d="M58 161 Q71 155 81 162 Q84 168 69 170 Q56 171 58 161Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<path d="M106 162 Q118 155 130 162 Q132 169 117 170 Q105 171 106 162Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<g class="stretch-man-upper">' +
                        '<path d="M84 59 Q95 55 106 59 L116 118 Q95 127 74 118 Z" fill="url(#stretch-man-shirt)" stroke="#3a756b" stroke-width="2.3" stroke-linejoin="round"/>' +
                        '<path d="M88 64 Q95 70 102 64" fill="none" stroke="#d6f1e7" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M95 72 V116" stroke="#3e8276" stroke-width="2" opacity=".35"/>' +
                        '<path d="M86 112 Q95 116 104 112" fill="none" stroke="#a8d8c9" stroke-width="2" opacity=".75"/>' +
                        '<path d="M87 42 L87 59 M103 42 L103 59" stroke="#bd805f" stroke-width="6" stroke-linecap="round"/>' +
                        '<circle cx="95" cy="37" r="16" fill="#d99b78" stroke="#a86e50" stroke-width="2"/>' +
                        '<path d="M79 37 Q77 17 95 17 Q112 17 112 36 Q103 28 94 30 Q86 29 79 37Z" fill="#493a36" stroke="#302b2b" stroke-width="2" stroke-linejoin="round"/>' +
                        '<path d="M86 39 Q88 41 90 39 M100 39 Q102 41 104 39" fill="none" stroke="#3b302c" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M91 48 Q95 51 100 48" fill="none" stroke="#864e45" stroke-width="2" stroke-linecap="round"/>' +
                    '</g>' +
                    '<g class="stretch-arm stretch-man-left"><path d="M80 75 Q66 84 60 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="60" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                    '<g class="stretch-arm stretch-man-right"><path d="M110 75 Q124 84 130 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="130" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                '</g>' +

                /* Woman: long dark hair, coral top and plum leggings. */
                '<g class="stretch-woman">' +
                    '<path d="M208 117 Q202 137 199 160 M238 117 Q244 137 248 160" fill="none" stroke="#58445f" stroke-width="12" stroke-linecap="round"/>' +
                    '<path d="M184 161 Q197 155 207 162 Q210 168 195 170 Q182 171 184 161Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<path d="M238 162 Q250 155 262 162 Q264 169 249 170 Q237 171 238 162Z" fill="#f0be74" stroke="#b17e49" stroke-width="1.8"/>' +
                    '<g class="stretch-woman-upper">' +
                        '<path d="M214 59 Q225 55 236 59 L246 118 Q225 127 204 118 Z" fill="url(#stretch-woman-shirt)" stroke="#bd6477" stroke-width="2.3" stroke-linejoin="round"/>' +
                        '<path d="M218 65 Q225 71 232 65" fill="none" stroke="#ffe4df" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M225 72 V116" stroke="#bd6477" stroke-width="2" opacity=".3"/>' +
                        '<path d="M216 112 Q225 116 234 112" fill="none" stroke="#ffe2df" stroke-width="2" opacity=".75"/>' +
                        '<path d="M217 42 L217 59 M233 42 L233 59" stroke="#d99b78" stroke-width="6" stroke-linecap="round"/>' +
                        '<path d="M208 38 Q205 13 226 13 Q246 14 243 42 L243 65 Q238 75 234 61 L237 39 Q226 28 216 39 L216 62 Q209 70 205 59Z" fill="#493a36" stroke="#302b2b" stroke-width="2" stroke-linejoin="round"/>' +
                        '<circle cx="225" cy="37" r="16" fill="#d99b78" stroke="#a86e50" stroke-width="2"/>' +
                        '<path d="M209 36 Q208 19 225 19 Q242 19 241 36 Q231 27 223 30 Q215 29 209 36Z" fill="#493a36"/>' +
                        '<ellipse cx="219" cy="38" rx="1.8" ry="2.5" fill="#3b302c"/><ellipse cx="231" cy="38" rx="1.8" ry="2.5" fill="#3b302c"/>' +
                        '<path d="M220 48 Q225 52 230 48" fill="none" stroke="#864e45" stroke-width="2" stroke-linecap="round"/>' +
                        '<circle cx="211" cy="46" r="3" fill="#ee9b9b" opacity=".65"/><circle cx="239" cy="46" r="3" fill="#ee9b9b" opacity=".65"/>' +
                    '</g>' +
                    '<g class="stretch-arm stretch-woman-left"><path d="M210 75 Q196 84 190 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="190" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                    '<g class="stretch-arm stretch-woman-right"><path d="M240 75 Q254 84 260 105" fill="none" stroke="#d99b78" stroke-width="10" stroke-linecap="round"/><circle cx="260" cy="106" r="5.5" fill="#d99b78" stroke="#a86e50" stroke-width="1.5"/></g>' +
                '</g>' +
                '<g fill="#7aa99a" opacity=".8"><path d="M35 135 Q43 119 51 135 Q43 132 35 135Z"/><path d="M272 135 Q280 119 288 135 Q280 132 272 135Z"/></g>' +
                '</svg></div>';
        }

        function openModal(type, checkboxId) {
            stopBreathingTimer();
            activeModalType = type;
            activeTargetCheckboxId = checkboxId;
            activeModalAction = "complete";
            const guide = guideContent[checkboxId] || {
                title:"Let's do this together",line:"Take a gentle moment for this activity. Go at your own pace.",person:"🧑",prop:"✨",action:"When you're ready, tell me you've completed the activity."
            };
            const target = document.getElementById('modal-animation-target');
            const instructions = document.getElementById('modal-instructions');
            const button = document.getElementById('modal-complete-btn');
            document.querySelector('#modal-content-box h2')?.remove();
            target.replaceChildren();
            instructions.replaceChildren();
            button.disabled = false;
            button.classList.remove('opacity-50','cursor-not-allowed');
            button.style.display = 'block';

            const heading = document.createElement('h2');
            heading.className = 'text-2xl font-bold text-amber-900 handwriting mb-2';
            heading.textContent = guide.title;
            document.getElementById('modal-content-box').insertBefore(heading,target);

            if (type === 'clouds') {
                activeModalAction = "close";
                const gallery = document.createElement('div');
                gallery.className = 'cloud-intro-gallery';
                const cloudItems = [
                    { className: 'cloud-intro-item cloud-cumulus', art: '☁️', label: 'Cumulus' },
                    { className: 'cloud-intro-item cloud-stratus', art: '🌫️', label: 'Stratus' },
                    { className: 'cloud-intro-item cloud-stratocumulus', art: '🌥️', rain: '💧💧', label: 'Stratocumulus' }
                ];
                cloudItems.forEach(item => {
                    const card = document.createElement('div');
                    card.className = item.className;
                    const art = document.createElement('span');
                    art.className = 'cloud-art';
                    art.setAttribute('aria-hidden', 'true');
                    art.textContent = item.art;
                    if (item.rain) {
                        const rain = document.createElement('span');
                        rain.className = 'cloud-rain';
                        rain.textContent = item.rain;
                        art.append(rain);
                    }
                    const label = document.createElement('span');
                    label.textContent = item.label;
                    card.append(art, label);
                    gallery.append(card);
                });
                const cloudCopy = document.createElement('div');
                cloudCopy.className = 'guide-speech cloud-intro-copy';
                cloudCopy.textContent = 'Meet the three clouds. Tap each one on your card and watch it drift away. After all three have been released, your completion checkbox will appear.';
                target.append(gallery, cloudCopy);
                instructions.textContent = 'Notice each feeling gently. You can release a cloud when you feel ready.';
                button.textContent = 'Let’s release the clouds';
            } else if (guide.breathing) {
                activeModalAction = 'start-breathing';
                const breathingPanel = document.createElement('div');
                breathingPanel.className = 'flex flex-col items-center gap-3 w-full';
                [
                    ['breathing-orb', 'guide-breath-orb', ''],
                    ['breathing-phase', 'text-xl font-bold text-blue-800', 'Ready?'],
                    ['breathing-tip', 'text-sm text-slate-600', 'We will take five gentle cycles together.'],
                    ['breathing-count', 'guide-timer', '5 cycles'],
                    ['breathing-clock', 'text-xs text-blue-700 font-semibold', '12 seconds per cycle']
                ].forEach(([id, className, text]) => {
                    const node = document.createElement('div');
                    node.id = id;
                    node.className = className;
                    node.textContent = text;
                    breathingPanel.append(node);
                });
                target.append(breathingPanel);
                instructions.textContent = guide.line;
                button.textContent = 'Start 5 breathing cycles';
            } else {
                let motionClass = '';
                if (guide.drink) motionClass = 'drinking';
                else if (['start-3','mid-1'].includes(checkboxId)) motionClass = 'stretching';
                else if (['start-2','sleep-4'].includes(checkboxId)) motionClass = 'praying';
                else if (['start-1','end-1','sleep-1','sleep-2'].includes(checkboxId)) motionClass = 'thinking';
                else if (['end-2'].includes(checkboxId)) motionClass = 'writing';
                else if (['mid-5','cloud-checked'].includes(checkboxId)) motionClass = 'floating';
                else if (['end-4'].includes(checkboxId)) motionClass = 'boop';
                else if (['sleep-3'].includes(checkboxId)) motionClass = 'thinking';
                const propMotion = ['end-2'].includes(checkboxId) ? 'writing' : (['mid-5','cloud-checked'].includes(checkboxId) ? 'floating' : (checkboxId === 'sleep-3' ? 'screen-away' : ''));
                if (['start-3','mid-1'].includes(checkboxId)) {
                    // This is a fixed, developer-authored SVG illustration; no user text is parsed as markup.
                    target.innerHTML = buildStretchingCartoon(false);
                } else {
                    const scene = document.createElement('div');
                    scene.className = 'guide-scene';
                    const person = document.createElement('span');
                    person.className = 'guide-person ' + motionClass;
                    person.textContent = String(guide.person || '');
                    const prop = document.createElement('span');
                    prop.className = 'guide-prop ' + (guide.drink ? 'guide-cup ' : '') + propMotion;
                    prop.textContent = String(guide.prop || '');
                    scene.append(person, prop);
                    target.append(scene);
                }
                const speech = document.createElement('div');
                speech.className = 'guide-speech';
                speech.id = 'guide-speech';
                speech.textContent = String(guide.line || '');
                const action = document.createElement('p');
                action.className = 'text-xs text-slate-500 mt-3';
                action.id = 'guide-action';
                action.textContent = String(guide.action || '');
                target.append(speech, action);
                instructions.textContent = guide.drink ? "My turn... sip! Your turn next. Take your time." : "Let's do it at your own pace.";
                if (guide.drink) {
                    activeModalAction = 'waiting-for-drink';
                    button.disabled = true;
                    button.classList.add('opacity-50','cursor-not-allowed');
                    button.textContent = 'Please watch the 5-second water guide…';
                    instructions.textContent = 'Watch the short demonstration. When it finishes, it will be your turn.';
                    drinkGuideTimeout = setTimeout(() => {
                        const modal = document.getElementById('anim-modal');
                        if (!modal || modal.classList.contains('hidden') || activeModalType !== type || activeTargetCheckboxId !== checkboxId) return;
                        activeModalAction = 'complete';
                        button.disabled = false;
                        button.classList.remove('opacity-50','cursor-not-allowed');
                        instructions.textContent = 'The demonstration is done. Now it is your turn. Have water if appropriate for you, at your own pace. When you are finished, tap below.';
                        const speech = document.getElementById('guide-speech');
                        if (speech) speech.textContent = 'My sip is done! Your turn now. Take your time and enjoy your water.';
                        button.textContent = "I've had my water. Show my checkbox";
                    }, 5000);
                } else {
                    activeModalAction = 'complete';
                    button.textContent = "I've done it. Show my checkbox";
                }
            }
            document.getElementById('anim-modal').classList.remove('hidden');
        }

        function startBreathingExercise() {
            stopBreathingTimer();
            breathingCycle = 1;
            breathingPhaseIndex = 0;
            breathingSecondsLeft = breathingPhases[0].seconds;
            const button = document.getElementById('modal-complete-btn');
            activeModalAction = 'breathing-running';
            button.disabled = true;
            button.classList.add('opacity-50','cursor-not-allowed');
            button.textContent = 'Breathing with you...';
            updateBreathingDisplay();
            breathingTimer = setInterval(() => {
                breathingSecondsLeft--;
                if (breathingSecondsLeft <= 0) {
                    breathingPhaseIndex++;
                    if (breathingPhaseIndex >= breathingPhases.length) {
                        breathingPhaseIndex = 0;
                        breathingCycle++;
                    }
                    if (breathingCycle > 5) {
                        stopBreathingTimer();
                        document.getElementById('breathing-phase').textContent = 'Amazing work!';
                        document.getElementById('breathing-tip').textContent = 'Five gentle cycles complete. Take a normal, comfortable breath.';
                        document.getElementById('breathing-count').textContent = '5 / 5 cycles';
                        document.getElementById('breathing-clock').textContent = 'You did it!';
                        document.getElementById('breathing-orb').style.animation = 'none';
                        const doneButton = document.getElementById('modal-complete-btn');
                        activeModalAction = 'complete';
                        doneButton.disabled = false;
                        doneButton.classList.remove('opacity-50','cursor-not-allowed');
                        doneButton.textContent = 'Good job! Show my checkbox';
                        document.getElementById('modal-instructions').textContent = 'Good job! You are doing amazing!';
                        playPopSound();
                        return;
                    }
                    breathingSecondsLeft = breathingPhases[breathingPhaseIndex].seconds;
                }
                updateBreathingDisplay();
            },1000);
        }

        function updateBreathingDisplay() {
            const phase = breathingPhases[breathingPhaseIndex];
            const phaseEl = document.getElementById('breathing-phase');
            if (!phaseEl) return;
            phaseEl.textContent = phase.name;
            document.getElementById('breathing-tip').textContent = phase.tip;
            document.getElementById('breathing-count').textContent = 'Cycle ' + breathingCycle + ' of 5';
            document.getElementById('breathing-clock').textContent = breathingSecondsLeft + ' seconds';
            const orb = document.getElementById('breathing-orb');
            if (phase.name === 'Breathe in') {
                orb.style.animation = 'guide-breath-in 4s ease-in-out 1 forwards';
            } else if (phase.name === 'Hold softly') {
                orb.style.animation = 'none';
                orb.style.transform = 'scale(1.2)';
            } else {
                orb.style.animation = 'guide-breath-out 6s ease-in-out 1 forwards';
            }
        }

        function handleModalPrimaryAction() {
            if (activeModalAction === 'close') {
                closeModal();
                return;
            }
            if (activeModalAction === 'start-breathing') {
                startBreathingExercise();
                return;
            }
            if (activeModalAction === 'complete') completeAnimation();
        }

        function closeModal() {
            stopBreathingTimer();
            document.getElementById('anim-modal').classList.add('hidden');
        }

        function completeAnimation() {
            const chk = activeTargetCheckboxId
                ? (document.getElementById('chk-' + activeTargetCheckboxId) || document.querySelector('[data-id="' + activeTargetCheckboxId + '"]'))
                : null;
            closeModal();
            playPopSound();
            if (chk) {
                chk.disabled = false;
                chk.dataset.guideUnlocked = 'true';
                chk.classList.remove('guide-hidden');
                const row = chk.closest('.guided-task-row');
                const label = row?.querySelector('.guide-checkbox-label');
                if (label) label.classList.add('is-unlocked');
                // Leave Show me visible so the user can replay the demonstration.
                saveData();
            }
        }

        function restoreCloudProgress(data) {
            document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
                const released = data['cloud_' + item.dataset.cloud] === true;
                item.dataset.released = released ? 'true' : 'false';
                item.disabled = released;
                item.setAttribute('aria-pressed',released ? 'true' : 'false');
                item.classList.toggle('cloud-released',released);
                item.classList.toggle('is-restored',released);
                const status = item.querySelector('.cloud-status');
                if (status) status.textContent = released ? 'Released ✓' : 'Tap to release';
            });
            updateCloudProgress();
        }

        function updateCloudProgress() {
            const items = Array.from(document.querySelectorAll('.cloud-item[data-cloud]'));
            const releasedCount = items.filter(item => item.dataset.released === 'true').length;
            const progress = document.getElementById('cloud-progress');
            if (progress) {
                progress.textContent = releasedCount === items.length
                    ? '3 of 3 clouds released. Lovely work! Your completion checkbox is ready below.'
                    : releasedCount + ' of ' + items.length + ' clouds released. Tap each cloud to let it drift away.';
            }

            const cloudChk = document.getElementById('chk-cloud-checked');
            if (!cloudChk) return;
            const allReleased = items.length > 0 && releasedCount === items.length;

            if (allReleased) {
                cloudChk.disabled = false;
                cloudChk.dataset.guideUnlocked = 'true';
                cloudChk.classList.remove('guide-hidden');
                cloudChk.closest('.guided-task-row')?.querySelector('.guide-checkbox-label')?.classList.add('is-unlocked');
            } else if (!cloudChk.checked) {
                cloudChk.disabled = true;
                cloudChk.dataset.guideUnlocked = 'false';
                cloudChk.classList.add('guide-hidden');
                cloudChk.closest('.guided-task-row')?.querySelector('.guide-checkbox-label')?.classList.remove('is-unlocked');
            }
        }

        function releaseCloud(el) {
            if (!el || !el.dataset.cloud || el.dataset.released === 'true') return;
            el.dataset.released = 'true';
            el.disabled = true;
            el.setAttribute('aria-pressed','true');
            el.classList.add('cloud-released');
            const status = el.querySelector('.cloud-status');
            if (status) status.textContent = 'Released ✓';
            playPopSound();
            confetti({ particleCount: 15, spread: 40, origin: { y: 0.6 } });
            updateCloudProgress();
            saveData();
            updateEcosystemTree({trunk:true});
        }

        function speakProudCue() {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance("I am so proud of you!");
                utterance.pitch = 1.2;
                utterance.rate = 0.95;
                window.speechSynthesis.speak(utterance);
            }
        }

        function playPopSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(850, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.08);
        }

        function playFanfareSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, index) => {
                setTimeout(() => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.35);
                }, index * 130);
            });
        }

        function attachChecklistCartoons() {
            document.querySelectorAll('.app-chk').forEach(chk => {
                const label = chk.closest('label');
                if (!label || label.closest('.guided-task-row')) return;
                const row = document.createElement('div');
                row.className = 'guided-task-row';
                label.parentNode.insertBefore(row,label);
                row.appendChild(label);
                label.classList.add('guide-checkbox-label');
                chk.classList.add('guide-hidden');
                const id = chk.dataset.id;
                // Card 6 is guided by its three individually animated cloud buttons.
                if (id === 'cloud-checked') return;
                const guideButton = document.createElement('button');
                guideButton.type = 'button';
                guideButton.className = 'guide-launch';
                const playIcon = document.createElement('span');
                playIcon.className = 'guide-play-icon';
                playIcon.setAttribute('aria-hidden', 'true');
                playIcon.textContent = '▶';
                const guideLabel = document.createElement('span');
                guideLabel.textContent = 'Show me';
                guideButton.append(playIcon, guideLabel);
                guideButton.setAttribute('aria-label','Show animated guide for '+id);
                guideButton.addEventListener('click',() => openModal('guided',id));
                row.insertBefore(guideButton,label);
            });
            document.querySelectorAll('button[onclick^="openModal("]').forEach(button => {
                // Hide only the old inline guide button; never hide its task heading or row.
                // Card 6 keeps its dedicated cloud-animation launcher.
                if (!button.closest('#card-step-6')) button.classList.add('legacy-guide-button');
            });
            syncChecklistCartoons();
        }

        function syncChecklistCartoons() {
            document.querySelectorAll('.app-chk').forEach(chk => {
                const row = chk.closest('.guided-task-row');
                const label = row?.querySelector('.guide-checkbox-label');
                const launch = row?.querySelector('.guide-launch');
                const unlocked = chk.dataset.guideUnlocked === 'true' || chk.checked;
                chk.classList.toggle('guide-hidden',!unlocked);
                if (unlocked) {
                    chk.disabled = false;
                    label?.classList.add('is-unlocked');
                    chk.dataset.guideUnlocked = 'true';
                } else {
                    label?.classList.remove('is-unlocked');
                }
                // Keep "Show me" available so the user can replay the demonstration anytime.
                launch?.classList.remove('is-hidden');
            });
        }

        function getStorageKey(dateStr) { return 'mindful_pokes_data_' + dateStr; }

        const MISSED_CARD_DISMISS_PREFIX = 'faith_focus_missed_card_notice_dismissed_';

        function getPreviousDeviceDateString(dateString = getDeviceLocalDateString()) {
            const [year, month, day] = dateString.split('-').map(Number);
            const previous = new Date(year, month - 1, day, 12, 0, 0, 0);
            previous.setDate(previous.getDate() - 1);
            return getDeviceLocalDateString(previous);
        }

        function hideMissedCardNotifications() {
            document.getElementById('missed-card-notice')?.classList.add('hidden');
        }

        function renderMissedCardNotifications() {
            const panel = document.getElementById('missed-card-notice');
            const dateInput = document.getElementById('currentDate');
            if (!panel || dateInput?.value !== getDeviceLocalDateString()) {
                hideMissedCardNotifications();
                return;
            }

            const missedDate = getPreviousDeviceDateString();
            const raw = localStorage.getItem(getStorageKey(missedDate));
            if (!raw || localStorage.getItem(MISSED_CARD_DISMISS_PREFIX + missedDate) === 'true') {
                hideMissedCardNotifications();
                return;
            }

            let dailyData;
            try {
                dailyData = JSON.parse(raw);
            } catch {
                hideMissedCardNotifications();
                return;
            }

            const sections = Array.from({ length: 6 }, (_, index) => {
                const number = index + 1;
                const card = document.getElementById('card-step-' + number);
                const title = card?.querySelector('h2')?.textContent?.trim() || 'Card ' + number;
                const ids = Array.from(document.querySelectorAll('.sec-' + number))
                    .map(checkbox => checkbox.dataset.id)
                    .filter(Boolean);
                return { number, title, ids };
            });
            const missed = getMissedChecklistCards(dailyData, sections);
            if (!missed.length) {
                hideMissedCardNotifications();
                return;
            }

            const dateLabel = new Intl.DateTimeFormat(undefined, {
                weekday: 'long', month: 'long', day: 'numeric'
            }).format(new Date(missedDate + 'T12:00:00'));
            const count = document.getElementById('missed-card-count');
            const dateText = document.getElementById('missed-card-date');
            const list = document.getElementById('missed-card-list');
            if (!list) {
                hideMissedCardNotifications();
                return;
            }

            panel.dataset.missedDate = missedDate;
            if (count) count.textContent = missed.length + (missed.length === 1 ? ' card to revisit' : ' cards to revisit');
            if (dateText) dateText.textContent = 'From ' + dateLabel;
            list.replaceChildren();

            missed.forEach(card => {
                const item = document.createElement('li');
                item.className = 'missed-card-item';
                const title = document.createElement('span');
                title.className = 'missed-card-item-title';
                title.textContent = card.title;
                const review = document.createElement('button');
                review.type = 'button';
                review.className = 'missed-card-review-button';
                review.dataset.action = 'reviewMissedCard';
                review.dataset.missedDate = missedDate;
                review.dataset.cardNumber = String(card.number);
                review.textContent = 'Review card';
                item.append(title, review);
                list.append(item);
            });

            panel.classList.remove('hidden');
        }

        function dismissMissedCardNotifications() {
            const panel = document.getElementById('missed-card-notice');
            const missedDate = panel?.dataset.missedDate;
            if (missedDate && /^\d{4}-\d{2}-\d{2}$/.test(missedDate)) {
                try {
                    localStorage.setItem(MISSED_CARD_DISMISS_PREFIX + missedDate, 'true');
                } catch (error) {
                    console.warn('[Checklist] The reminder dismissal could not be saved on this device.', error);
                }
            }
            hideMissedCardNotifications();
        }

        async function reviewMissedCard(trigger) {
            const missedDate = trigger?.dataset?.missedDate;
            const cardNumber = Number(trigger?.dataset?.cardNumber);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(missedDate || '')
                || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > 6) return;

            const dateInput = document.getElementById('currentDate');
            if (!dateInput) return;
            if (missedCardVictoryTimer) window.clearTimeout(missedCardVictoryTimer);
            missedCardVictoryTimer = null;
            missedCardReviewContext = {
                missedDate,
                returnDate: getDeviceLocalDateString(),
                returnStep: currentStep
            };
            dateInput.value = missedDate;
            try {
                await handleDateChange();
                showPage('checklist');
                if (currentStep !== cardNumber) changeStep(cardNumber - currentStep);
            } catch (error) {
                missedCardReviewContext = null;
                console.error('[Checklist] Could not open a missed card for review.', error);
                const status = document.getElementById('finish-status');
                if (status) {
                    status.textContent = 'This saved checklist date could not be opened. Your existing records remain unchanged. ' + (error?.message || '');
                    status.classList.remove('hidden');
                }
            }
        }

        async function returnFromMissedCardReview() {
            const context = missedCardReviewContext;
            if (!context) return;

            missedCardReviewContext = null;
            if (missedCardVictoryTimer) window.clearTimeout(missedCardVictoryTimer);
            missedCardVictoryTimer = null;

            const dateInput = document.getElementById('currentDate');
            if (!dateInput) return;
            const today = getDeviceLocalDateString();
            dateInput.value = today;

            try {
                await handleDateChange();
                document.getElementById('grand-finale-overlay')?.classList.add('hidden');
                resetChecklistWizard();

                // Restore the current-day card position when returning on the
                // same date. If midnight passed during the celebration, start
                // the new day at Card 1.
                const returnStep = context.returnDate === today ? context.returnStep : 1;
                if (Number.isInteger(returnStep) && returnStep > 1 && returnStep <= 6) {
                    changeStep(returnStep - 1);
                }
                showPage('checklist');
            } catch (error) {
                document.getElementById('grand-finale-overlay')?.classList.add('hidden');
                showPage('checklist');
                const status = document.getElementById('finish-status');
                if (status) {
                    status.textContent = 'Your missed-card celebration is complete, but today’s checklist could not be reloaded automatically. Your saved records remain unchanged. ' + (error?.message || '');
                    status.classList.remove('hidden');
                }
            }
        }

        function scheduleMissedCardVictoryReturn(dateString) {
            if (!missedCardReviewContext
                || missedCardReviewContext.missedDate !== dateString
                || missedCardVictoryTimer) return;

            missedCardVictoryTimer = window.setTimeout(() => {
                missedCardVictoryTimer = null;
                returnFromMissedCardReview().catch(error => {
                    console.error('[Checklist] Could not return to today after the missed-card celebration.', error);
                });
            }, MISSED_CARD_VICTORY_DELAY_MS);
        }

        function setLocationCheckinMessage(message, state = 'info') {
            const element = document.getElementById('location-checkin-message');
            if (!element) return;
            element.textContent = message;
            element.dataset.state = state;
            element.classList.toggle('hidden', !message);
        }

        function formatLocationCheckinEntry(record) {
            const formattedTime = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
            }).format(new Date(record.capturedAt));
            return LOCATION_CHECKIN_OPTIONS[record.locationId] + ': '
                + record.latitude.toFixed(6) + ', ' + record.longitude.toFixed(6)
                + ' (accuracy ±' + Math.round(record.accuracyMeters) + ' m) · ' + formattedTime;
        }

        function createLocationCoordinateControls(record) {
            const coordinates = record.latitude.toFixed(6) + ', ' + record.longitude.toFixed(6);
            const controls = document.createElement('span');
            controls.className = 'inline-flex flex-wrap items-center gap-2';

            const mapLink = document.createElement('a');
            mapLink.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(coordinates);
            mapLink.target = '_blank';
            mapLink.rel = 'noopener noreferrer';
            mapLink.className = 'font-semibold text-purple-800 underline decoration-purple-300 underline-offset-2 hover:text-purple-950';
            mapLink.textContent = coordinates;
            mapLink.setAttribute('aria-label', 'Open coordinates in Google Maps');

            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.dataset.action = 'copyLocationCoordinates';
            copyButton.dataset.coordinates = coordinates;
            copyButton.className = 'rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-800 hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-400';
            copyButton.textContent = 'Copy';
            copyButton.setAttribute('aria-label', 'Copy coordinates');

            controls.append(mapLink, copyButton);
            return controls;
        }

        async function copyLocationCoordinates(button) {
            const coordinates = button?.dataset?.coordinates;
            if (!coordinates) return;

            try {
                let copied = false;
                if (navigator.clipboard?.writeText) {
                    try {
                        await navigator.clipboard.writeText(coordinates);
                        copied = true;
                    } catch (clipboardError) {
                        copied = false;
                    }
                }
                if (!copied) {
                    const temporaryInput = document.createElement('textarea');
                    temporaryInput.value = coordinates;
                    temporaryInput.setAttribute('readonly', '');
                    temporaryInput.style.position = 'fixed';
                    temporaryInput.style.opacity = '0';
                    document.body.append(temporaryInput);
                    temporaryInput.select();
                    try {
                        copied = document.execCommand('copy');
                    } finally {
                        temporaryInput.remove();
                    }
                    if (!copied) throw new Error('Clipboard access is unavailable in this browser.');
                }

                const originalLabel = button.textContent;
                button.textContent = 'Copied';
                button.setAttribute('aria-label', 'Coordinates copied');
                window.setTimeout(() => {
                    if (!button.isConnected) return;
                    button.textContent = originalLabel;
                    button.setAttribute('aria-label', 'Copy coordinates');
                }, 1600);
            } catch (error) {
                button.textContent = 'Copy failed';
                button.title = 'Select the coordinate link text to copy it manually.';
            }
        }

        function renderLocationCheckinDetails(dateString) {
            const container = document.getElementById('location-checkin-details');
            if (!container) return;
            container.replaceChildren();

            const entries = loadLocationCheckinEntries(localStorage, dateString);
            for (const record of entries) {
                const line = document.createElement('p');
                line.className = 'location-checkin-entry flex flex-wrap items-center gap-x-2 gap-y-1';
                const label = document.createElement('strong');
                label.textContent = LOCATION_CHECKIN_OPTIONS[record.locationId] + ':';
                const metadata = document.createTextNode(
                    ' · accuracy ±' + Math.round(record.accuracyMeters) + ' m · '
                    + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                        .format(new Date(record.capturedAt))
                );
                line.append(label, createLocationCoordinateControls(record), metadata);
                container.append(line);
            }

            container.classList.toggle('hidden', entries.length === 0);
        }

        function renderDiaryLocationLogs(dateString = getCurrentWritingDate()) {
            const container = document.getElementById('diary-location-log');
            if (!container) return;
            container.replaceChildren();

            const dateLabel = document.getElementById('diary-location-date');
            if (dateLabel) {
                dateLabel.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })
                    .format(new Date(dateString + 'T00:00:00'));
            }

            const entries = loadLocationCheckinEntries(localStorage, dateString);
            if (!entries.length) {
                const empty = document.createElement('li');
                empty.className = 'rounded-xl bg-white/70 px-3 py-3 text-xs text-purple-800';
                empty.textContent = 'No location check-ins were recorded for this date.';
                container.append(empty);
                return;
            }

            entries.forEach((record, index) => {
                const item = document.createElement('li');
                item.className = 'rounded-xl bg-white/80 border border-purple-100 px-3 py-3';
                const title = document.createElement('p');
                title.className = 'font-bold text-xs text-purple-950';
                title.textContent = (index + 1) + '. ' + LOCATION_CHECKIN_OPTIONS[record.locationId];
                const details = document.createElement('div');
                details.className = 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-purple-800 break-words';
                const metadata = document.createTextNode(
                    '(accuracy ±' + Math.round(record.accuracyMeters) + ' m) · '
                    + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                        .format(new Date(record.capturedAt))
                );
                details.append(createLocationCoordinateControls(record), metadata);
                item.append(title, details);
                container.append(item);
            });
        }

        function formatDiaryArchiveDate(dateString) {
            return new Intl.DateTimeFormat(undefined, {
                weekday: 'short',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(new Date(dateString + 'T00:00:00'));
        }

        async function collectDiaryArchiveDates() {
            const summaries = new Map();
            const ensureDate = dateString => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
                if (!summaries.has(dateString)) {
                    summaries.set(dateString, {
                        dateString,
                        hasWrittenEntry: false,
                        locationCount: 0,
                        voiceNoteCount: 0
                    });
                }
                return summaries.get(dateString);
            };

            const currentDate = getCurrentWritingDate();
            ensureDate(currentDate);

            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (!key) continue;

                if (key.startsWith(WRITING_DIARY_PREFIX)) {
                    const summary = ensureDate(key.slice(WRITING_DIARY_PREFIX.length));
                    if (summary) summary.hasWrittenEntry = true;
                } else if (key.startsWith(LOCATION_CHECKIN_STORAGE_PREFIX)) {
                    const summary = ensureDate(key.slice(LOCATION_CHECKIN_STORAGE_PREFIX.length));
                    if (summary) {
                        summary.locationCount = loadLocationCheckinEntries(localStorage, summary.dateString).length;
                    }
                }
            }

            const voiceNotes = await exportPrivateVoiceNotes();
            voiceNotes.forEach(note => {
                const summary = ensureDate(note.dateString);
                if (summary) summary.voiceNoteCount += 1;
            });

            return [...summaries.values()].sort((left, right) =>
                right.dateString.localeCompare(left.dateString)
            );
        }

        function closeDiaryArchive() {
            const panel = document.getElementById('diary-archive-panel');
            if (panel) panel.classList.add('hidden');
            diaryArchiveVoiceUrls.forEach(url => URL.revokeObjectURL(url));
            diaryArchiveVoiceUrls = [];
            document.getElementById('diary-archive-entry-voice-notes')?.replaceChildren();
            document.getElementById('diary-archive-button')?.focus({ preventScroll: true });
        }

        function showDiaryArchiveList() {
            document.getElementById('diary-archive-list-view')?.classList.remove('hidden');
            document.getElementById('diary-archive-entry-view')?.classList.add('hidden');
            diaryArchiveVoiceUrls.forEach(url => URL.revokeObjectURL(url));
            diaryArchiveVoiceUrls = [];
            document.getElementById('diary-archive-entry-voice-notes')?.replaceChildren();
        }

        async function openDiaryArchive() {
            if (!writingCryptoKey) {
                setWritingSecurityStatus('Unlock your Diary before opening your notebook.', 'info');
                return;
            }

            const panel = document.getElementById('diary-archive-panel');
            const list = document.getElementById('diary-archive-date-list');
            if (!panel || !list) return;

            panel.classList.remove('hidden');
            list.replaceChildren();
            const loading = document.createElement('li');
            loading.className = 'diary-archive-empty';
            loading.textContent = 'Collecting your saved Diary dates…';
            list.append(loading);

            try {
                diaryArchiveDateSummaries = await collectDiaryArchiveDates();
                list.replaceChildren();

                if (!diaryArchiveDateSummaries.length) {
                    const empty = document.createElement('li');
                    empty.className = 'diary-archive-empty';
                    empty.textContent = 'Your notebook is ready. Your saved entries will appear here by date.';
                    list.append(empty);
                    return;
                }

                diaryArchiveDateSummaries.forEach(summary => {
                    const item = document.createElement('li');
                    item.className = 'diary-archive-date-item';

                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.action = 'openDiaryArchiveDate';
                    button.dataset.date = summary.dateString;
                    button.className = 'diary-archive-date-button';

                    const date = document.createElement('strong');
                    date.className = 'diary-archive-date-title';
                    date.textContent = formatDiaryArchiveDate(summary.dateString);

                    const meta = document.createElement('span');
                    meta.className = 'diary-archive-date-meta';
                    const descriptors = [];
                    if (summary.hasWrittenEntry) descriptors.push('written entry');
                    if (summary.locationCount) descriptors.push(summary.locationCount + ' location' + (summary.locationCount === 1 ? '' : 's'));
                    if (summary.voiceNoteCount) descriptors.push(summary.voiceNoteCount + ' voice note' + (summary.voiceNoteCount === 1 ? '' : 's'));
                    meta.textContent = descriptors.join(' · ') || 'Clean daily page';

                    const arrow = document.createElement('span');
                    arrow.className = 'diary-archive-date-arrow';
                    arrow.textContent = '›';
                    button.append(date, meta, arrow);
                    item.append(button);
                    list.append(item);
                });
            } catch (error) {
                list.replaceChildren();
                const failed = document.createElement('li');
                failed.className = 'diary-archive-empty is-error';
                failed.textContent = 'The notebook dates could not be loaded. ' + (error?.message || '');
                list.append(failed);
            }
        }

        async function openDiaryArchiveDate(dateString) {
            console.log('[Diary Notebook] Date selected:', { dateString, diaryUnlocked: Boolean(writingCryptoKey) });
            if (!writingCryptoKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.warn('[Diary Notebook] Date selection ignored because the Diary is locked or the date is invalid.', { dateString });
                return;
            }

            const editor = document.getElementById('private-diary-entry');
            const recordButton = document.getElementById('record-btn');
            if (!editor || !recordButton) return;

            try {
                await flushPrivateWritingQueue();
                await loadPrivateWritingForDate(dateString);
                console.log('[Diary Notebook] Decrypted Diary entry loaded:', { dateString });
                diaryViewingHistoricalDate = dateString;
                updateDiaryDateAccess(dateString);
                editor.value = typeof editor.value === 'string' ? editor.value : '';
                editor.readOnly = true;
                editor.setAttribute('aria-label', 'Read-only Diary entry for ' + formatDiaryArchiveDate(dateString));
                editor.placeholder = 'No written entry was saved for this date.';
                recordButton.disabled = true;
                recordButton.setAttribute('aria-disabled', 'true');
                recordButton.title = 'Voice notes from past dates can be played below, but new recordings are for today.';
                recordButton.classList.add('opacity-50', 'cursor-not-allowed');

                updateDiaryDateLabel(dateString);
                renderDiaryLocationLogs(dateString);
                await renderDiaryVoiceNotes(dateString);

                const panel = document.getElementById('diary-archive-panel');
                if (panel) panel.classList.add('hidden');
                document.getElementById('diary-archive-list-view')?.classList.remove('hidden');
                document.getElementById('diary-archive-entry-view')?.classList.add('hidden');
                diaryArchiveVoiceUrls.forEach(url => URL.revokeObjectURL(url));
                diaryArchiveVoiceUrls = [];
                document.getElementById('diary-archive-entry-voice-notes')?.replaceChildren();

                const label = document.getElementById('diary-current-date-label');
                if (label) label.textContent = formatDiaryArchiveDate(dateString) + ' · SAVED ENTRY';
                document.getElementById('diary-return-today')?.classList.remove('hidden');
            } catch (error) {
                console.error('[Diary Notebook] Could not open selected saved date:', { dateString, error });
                setWritingSecurityStatus('This saved Diary date could not be opened. Your existing entries were not changed. '
                    + (error?.message || ''), 'error');
            }
        }

        function restoreCurrentDiaryDate() {
            if (!diaryViewingHistoricalDate) return;
            diaryViewingHistoricalDate = null;
            document.getElementById('diary-return-today')?.classList.add('hidden');
            const editor = document.getElementById('private-diary-entry');
            const recordButton = document.getElementById('record-btn');
            if (editor) {
                editor.readOnly = false;
                editor.removeAttribute('aria-label');
                editor.placeholder = 'Your private thoughts are encrypted before they are saved on this device.';
            }
            updateDiaryDateAccess(getCurrentWritingDate());
            handleDateChange().catch(error =>
                setWritingSecurityStatus('Your current Diary page could not be restored. Saved entries remain unchanged. '
                    + (error?.message || ''), 'error')
            );
        }

        function updateDiaryDateLabel(dateString = getCurrentWritingDate()) {
            const label = document.getElementById('diary-current-date-label');
            if (label) label.textContent = formatDiaryArchiveDate(dateString);
        }

        function updateDiaryDateAccess(dateString = getCurrentWritingDate()) {
            const isToday = dateString === getDeviceLocalDateString();
            const canEditCurrentDiary = isToday
                && !diaryViewingHistoricalDate
                && Boolean(writingCryptoKey)
                && writingLoadedDate === dateString;
            const editor = document.getElementById('private-diary-entry');
            const recordButton = document.getElementById('record-btn');
            const updateButton = document.getElementById('diary-update-button');

            if (editor) {
                editor.readOnly = !canEditCurrentDiary;
                if (canEditCurrentDiary) {
                    editor.removeAttribute('aria-label');
                    editor.placeholder = 'Your private thoughts are encrypted before they are saved on this device.';
                } else {
                    editor.setAttribute('aria-label', 'Read-only Diary entry for ' + formatDiaryArchiveDate(dateString));
                    editor.placeholder = 'Past Diary entries are read-only.';
                }
            }
            if (recordButton) {
                recordButton.disabled = !canEditCurrentDiary || mediaRecorder?.state === 'recording';
                recordButton.classList.toggle('opacity-50', !canEditCurrentDiary);
                recordButton.classList.toggle('cursor-not-allowed', !canEditCurrentDiary);
                if (canEditCurrentDiary) {
                    recordButton.removeAttribute('aria-disabled');
                    recordButton.removeAttribute('title');
                } else {
                    recordButton.setAttribute('aria-disabled', 'true');
                    recordButton.title = 'New voice notes can only be recorded for today. Previous recordings are read-only.';
                }
            }
            if (updateButton) {
                updateButton.classList.toggle('hidden', !canEditCurrentDiary);
                updateButton.disabled = !canEditCurrentDiary;
            }

            // Location check-ins are append-only history. Past dates may be viewed,
            // but their location selectors cannot be changed or used to add captures.
            document.querySelectorAll('#card-step-1 .app-chk.sec-1').forEach(checkbox => {
                checkbox.disabled = !isToday;
                if (isToday) checkbox.removeAttribute('aria-disabled');
                else checkbox.setAttribute('aria-disabled', 'true');
            });
        }

        function revokeDiaryVoiceNoteUrls() {
            document.querySelectorAll('#diary-voice-note-list audio').forEach(audio => {
                audio.pause();
                audio.removeAttribute('src');
                audio.load();
            });
            voiceNoteObjectUrls.forEach(url => URL.revokeObjectURL(url));
            voiceNoteObjectUrls = [];
        }

        function clearDiaryVoiceNotePlayback() {
            voiceNotesRenderVersion += 1;
            revokeDiaryVoiceNoteUrls();
            const list = document.getElementById('diary-voice-note-list');
            if (!list) return;
            list.replaceChildren();
            const item = document.createElement('li');
            item.className = 'rounded-xl bg-white/70 px-3 py-3 text-xs text-purple-800';
            item.textContent = 'Unlock your Diary to listen to saved voice notes.';
            list.append(item);
        }

        async function renderDiaryVoiceNotes(dateString = getCurrentWritingDate()) {
            const list = document.getElementById('diary-voice-note-list');
            if (!list || !writingCryptoKey) return;
            const renderVersion = ++voiceNotesRenderVersion;
            revokeDiaryVoiceNoteUrls();
            list.replaceChildren();

            const loading = document.createElement('li');
            loading.className = 'rounded-xl bg-white/70 px-3 py-3 text-xs text-purple-800';
            loading.textContent = 'Loading encrypted voice notes…';
            list.append(loading);

            try {
                const notes = await loadPrivateVoiceNotesForDate(dateString);
                if (renderVersion !== voiceNotesRenderVersion) return;
                list.replaceChildren();

                if (!notes.length) {
                    const empty = document.createElement('li');
                    empty.className = 'rounded-xl bg-white/70 px-3 py-3 text-xs text-purple-800';
                    empty.textContent = 'No saved voice notes for this date yet.';
                    list.append(empty);
                    return;
                }

                notes.forEach((note, index) => {
                    const item = document.createElement('li');
                    item.className = 'rounded-xl bg-white/80 border border-purple-100 px-3 py-3';
                    const label = document.createElement('p');
                    label.className = 'mb-2 font-bold text-xs text-purple-950';
                    label.textContent = 'Voice Note ' + (index + 1) + ' · ' + new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                    }).format(new Date(note.capturedAt));
                    const player = document.createElement('audio');
                    player.controls = true;
                    player.preload = 'none';
                    player.className = 'w-full';
                    player.setAttribute('aria-label', 'Play saved voice note ' + (index + 1));
                    const url = URL.createObjectURL(note.blob);
                    voiceNoteObjectUrls.push(url);
                    player.src = url;
                    item.append(label, player);
                    list.append(item);
                });
            } catch (error) {
                if (renderVersion !== voiceNotesRenderVersion) return;
                list.replaceChildren();
                const failed = document.createElement('li');
                failed.className = 'rounded-xl bg-rose-50 px-3 py-3 text-xs text-rose-800';
                failed.textContent = 'A saved voice note could not be decrypted or loaded. ' + (error?.message || '');
                list.append(failed);
                throw error;
            }
        }

        document.addEventListener('private-writing:locked', () => {
            clearDiaryVoiceNotePlayback();
            closeDiaryArchive();
            updateDiaryDateAccess(getCurrentWritingDate());
        });
        registerVoiceNoteStopHandler(stopActiveVoiceRecording);

        function requestLocationCheckin(checkbox) {
            const locationId = checkbox?.dataset?.id;
            if (!checkbox?.checked || !Object.hasOwn(LOCATION_CHECKIN_OPTIONS, locationId)) return;

            const dateString = document.getElementById('currentDate')?.value;
            if (!dateString) return;
            if (dateString !== getDeviceLocalDateString()) {
                setLocationCheckinMessage('Past location history is permanent and cannot be changed.', 'info');
                return;
            }

            if (!navigator.geolocation) {
                setLocationCheckinMessage('This browser does not provide location access. The location was not recorded.', 'error');
                return;
            }

            setLocationCheckinMessage('Getting a fresh location for ' + LOCATION_CHECKIN_OPTIONS[locationId] + '…');

            navigator.geolocation.getCurrentPosition(
                position => {
                    try {
                        saveLocationCheckin(localStorage, dateString, locationId, position);
                        renderLocationCheckinDetails(document.getElementById('currentDate')?.value || dateString);
                        setLocationCheckinMessage('Location recorded for ' + LOCATION_CHECKIN_OPTIONS[locationId] + '.', 'success');
                    } catch (error) {
                        setLocationCheckinMessage('The location was received but could not be saved on this device.', 'error');
                    }
                },
                error => {
                    const message = error?.code === 1
                        ? 'Location permission was not granted. The location was not recorded.'
                        : error?.code === 3
                            ? 'Location capture timed out. Uncheck and check the box again to retry.'
                            : 'A current location could not be obtained. Uncheck and check the box again to retry.';
                    setLocationCheckinMessage(message, 'error');
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
            );
        }

        function updateScoreDisplay() {
            let totalScore = parseInt(localStorage.getItem('user_confidence_score') || '0');
            document.getElementById('launcher-score').innerText = totalScore;
        }

        function updateDailyActivityProgress() {
            let total=1,completed=isSectionComplete(1)?1:0;
            for(let section=2;section<=6;section++){
                const checks=Array.from(document.querySelectorAll('.sec-'+section));
                total+=checks.length;completed+=checks.filter(check=>check.checked).length;
            }
            const label=document.getElementById('daily-progress-count'),bar=document.getElementById('daily-progress-bar'),track=document.getElementById('daily-progress-track');
            const percent=total?Math.round((completed/total)*100):0;
            if(label)label.textContent=completed+' of '+total+' steps';
            if(bar)bar.style.width=percent+'%';
            if(track)track.setAttribute('aria-valuenow',String(completed));
        }


        function replayEcosystemEffect(selector,className){
            const element=document.querySelector(selector);
            if(!element)return;
            element.classList.remove(className);
            void element.getBoundingClientRect();
            element.classList.add(className);
        }

        const ecosystemCanvasMotion={roots:0,clouds:0,flowers:0,seedDrop:0};
        const ecosystemCanvasTargets={roots:0,clouds:0,flowers:0,seedDrop:0};
        let ecosystemCanvasParticles=[];
        let ecosystemCanvasContext=null;
        let ecosystemCanvasFrame=null;

        function ecosystemCanvasReducedMotion(){
            return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }

        function resizeEcosystemCanvas(){
            const canvas=document.getElementById('ecosystem-canvas');
            const fallback=document.getElementById('ecosystem-tree-art');
            if(!canvas)return;
            if(!ecosystemCanvasContext){
                try{ecosystemCanvasContext=canvas.getContext('2d');}catch(error){ecosystemCanvasContext=null;}
            }
            if(!ecosystemCanvasContext){
                canvas.style.display='none';
                if(fallback)fallback.style.display='block';
                return;
            }
            if(fallback)fallback.style.display='none';
            canvas.style.display='block';
            const rect=canvas.getBoundingClientRect();
            if(rect.width<1||rect.height<1)return;
            const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
            const pixelWidth=Math.max(1,Math.round(rect.width*dpr));
            const pixelHeight=Math.max(1,Math.round(rect.height*dpr));
            if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
            if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
            const scale=Math.min(rect.width/320,rect.height/240);
            const offsetX=(rect.width-320*scale)/2;
            const offsetY=(rect.height-240*scale)/2;
            try{ecosystemCanvasContext.setTransform(scale*dpr,0,0,scale*dpr,offsetX*dpr,offsetY*dpr);}
            catch(error){
                ecosystemCanvasContext=null;
                canvas.style.display='none';
                if(fallback)fallback.style.display='block';
                return;
            }
            drawEcosystemCanvas();
        }

        function traceEcosystemRoot(ctx,x0,y0,cx,cy,x1,y1,progress){
            const amount=Math.max(0,Math.min(1,progress));
            if(amount<=0)return;
            const steps=28;
            const last=Math.max(1,Math.ceil(steps*amount));
            ctx.beginPath();
            ctx.moveTo(x0,y0);
            for(let i=1;i<=last;i++){
                const t=Math.min(amount,i/steps);
                const inverse=1-t;
                ctx.lineTo(inverse*inverse*x0+2*inverse*t*cx+t*t*x1,inverse*inverse*y0+2*inverse*t*cy+t*t*y1);
            }
            ctx.stroke();
        }

        function drawEcosystemFlower(ctx,x,y,scale){
            if(scale<=0.01)return;
            ctx.save();
            ctx.translate(x,y);
            ctx.scale(scale,scale);
            ctx.fillStyle='#f48fb1';
            ctx.strokeStyle='#d5799a';
            ctx.lineWidth=1;
            for(let i=0;i<5;i++){
                ctx.save();
                ctx.rotate((Math.PI*2*i)/5);
                ctx.beginPath();
                ctx.ellipse(0,-5.2,3.2,5.8,0,0,Math.PI*2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            ctx.beginPath();
            ctx.fillStyle='#fff1a8';
            ctx.arc(0,0,2.7,0,Math.PI*2);
            ctx.fill();
            ctx.restore();
        }

        function drawEcosystemCanvas(){
            const ctx=ecosystemCanvasContext;
            if(!ctx)return;
            const roots=Math.max(0,Math.min(1,ecosystemCanvasMotion.roots));
            const clouds=Math.max(0,Math.min(3,ecosystemCanvasMotion.clouds));
            const flowers=Math.max(0,Math.min(1,ecosystemCanvasMotion.flowers));
            const seedDrop=Math.max(0,ecosystemCanvasMotion.seedDrop);
            const centerX=160;
            const groundY=184;
            ctx.clearRect(0,0,320,240);

            const sky=ctx.createRadialGradient(160,84,8,160,104,150);
            sky.addColorStop(0,'rgba(255,255,245,.88)');
            sky.addColorStop(1,'rgba(220,235,220,0)');
            ctx.fillStyle=sky;
            ctx.fillRect(8,4,304,210);

            const soil=ctx.createLinearGradient(0,groundY,0,240);
            soil.addColorStop(0,'#a77b4f');
            soil.addColorStop(1,'#705034');
            ctx.fillStyle=soil;
            ctx.fillRect(12,groundY,296,56);
            ctx.beginPath();
            ctx.moveTo(18,groundY+1);
            ctx.quadraticCurveTo(78,groundY-5,128,groundY+1);
            ctx.quadraticCurveTo(190,groundY+6,244,groundY);
            ctx.quadraticCurveTo(279,groundY-3,302,groundY+1);
            ctx.strokeStyle='#9dbd91';
            ctx.lineWidth=4;
            ctx.lineCap='round';
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(24,groundY+8);
            ctx.quadraticCurveTo(160,groundY+14,296,groundY+7);
            ctx.strokeStyle='rgba(231,238,213,.45)';
            ctx.lineWidth=1.5;
            ctx.setLineDash([3,5]);
            ctx.stroke();
            ctx.setLineDash([]);

            if(roots>0.001){
                ctx.save();
                ctx.strokeStyle='#6f5037';
                ctx.lineCap='round';
                ctx.lineJoin='round';
                ctx.lineWidth=5;
                traceEcosystemRoot(ctx,centerX,groundY,158,groundY+20,160,groundY+51,roots);
                ctx.lineWidth=3.8;
                traceEcosystemRoot(ctx,159,groundY+13,143,groundY+23,112,groundY+37,roots);
                traceEcosystemRoot(ctx,161,groundY+13,179,groundY+23,207,groundY+39,roots);
                ctx.lineWidth=2.5;
                traceEcosystemRoot(ctx,128,groundY+29,111,groundY+43,87,groundY+48,roots);
                traceEcosystemRoot(ctx,192,groundY+30,209,groundY+43,233,groundY+49,roots);
                ctx.restore();
            }

            // Each existing cloud release increases trunk width by exactly five percent.
            const trunkX=1+clouds*0.05;
            const trunkY=0.82+clouds*0.06;
            ctx.save();
            ctx.translate(centerX,groundY);
            ctx.scale(trunkX,trunkY);
            ctx.lineCap='round';
            ctx.lineJoin='round';
            ctx.beginPath();
            ctx.moveTo(-3,-56);
            ctx.quadraticCurveTo(-25,-78,-42,-91);
            ctx.moveTo(3,-58);
            ctx.quadraticCurveTo(27,-79,43,-92);
            ctx.strokeStyle='#866347';
            ctx.lineWidth=7;
            ctx.stroke();

            const bark=ctx.createLinearGradient(-14,0,14,0);
            bark.addColorStop(0,'#806044');
            bark.addColorStop(.48,'#b58b60');
            bark.addColorStop(1,'#76573d');
            ctx.beginPath();
            ctx.moveTo(-13,0);
            ctx.quadraticCurveTo(-8,-35,-7,-94);
            ctx.lineTo(7,-94);
            ctx.quadraticCurveTo(8,-38,13,0);
            ctx.closePath();
            ctx.fillStyle=bark;
            ctx.fill();
            ctx.strokeStyle='#75583e';
            ctx.lineWidth=2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-1,-12);
            ctx.quadraticCurveTo(3,-48,0,-85);
            ctx.strokeStyle='rgba(236,207,165,.65)';
            ctx.lineWidth=3;
            ctx.stroke();
            ctx.restore();

            const topY=groundY-94*trunkY;
            const leafClusters=[
                {x:centerX,y:topY-17,r:27,c:'#81ad78'},
                {x:centerX-32,y:topY-4,r:22,c:'#8fbd83'},
                {x:centerX+32,y:topY-5,r:22,c:'#6fa46f'},
                {x:centerX-17,y:topY-34,r:18,c:'#a8c995'},
                {x:centerX+18,y:topY-35,r:18,c:'#a4c48e'}
            ];
            leafClusters.forEach((leaf,index)=>{
                ctx.beginPath();
                ctx.fillStyle=leaf.c;
                ctx.arc(leaf.x,leaf.y,leaf.r,0,Math.PI*2);
                ctx.fill();
                ctx.beginPath();
                ctx.strokeStyle=index%2?'rgba(240,248,225,.75)':'rgba(231,244,218,.8)';
                ctx.lineWidth=1.1;
                ctx.moveTo(leaf.x,leaf.y+leaf.r*.55);
                ctx.lineTo(leaf.x,leaf.y-leaf.r*.55);
                ctx.stroke();
            });
            [
                [centerX-33,topY-15],[centerX+28,topY-18],[centerX,topY-45],
                [centerX-48,topY+7],[centerX+47,topY+5]
            ].forEach((point,index)=>drawEcosystemFlower(ctx,point[0],point[1],flowers*(index===2?1:.88)));

            const seedY=groundY-2-seedDrop*42;
            ctx.save();
            ctx.globalAlpha=Math.max(.28,1-roots*.72);
            const seedGlow=ctx.createRadialGradient(centerX,seedY,1,centerX,seedY,16);
            seedGlow.addColorStop(0,'rgba(255,236,151,.55)');
            seedGlow.addColorStop(1,'rgba(255,236,151,0)');
            ctx.fillStyle=seedGlow;
            ctx.beginPath();
            ctx.arc(centerX,seedY,16,0,Math.PI*2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(centerX,seedY,7,4.7,Math.PI/7,0,Math.PI*2);
            ctx.fillStyle='#d4b18a';
            ctx.fill();
            ctx.strokeStyle='#7e5d42';
            ctx.lineWidth=1.3;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(centerX-2,seedY-1);
            ctx.quadraticCurveTo(centerX+1,seedY-5,centerX+3,seedY-2);
            ctx.strokeStyle='#f5dfbd';
            ctx.lineWidth=1.1;
            ctx.stroke();
            ctx.restore();

            ecosystemCanvasParticles.forEach(particle=>{
                ctx.save();
                ctx.globalAlpha=Math.max(0,particle.life);
                ctx.fillStyle=particle.color;
                ctx.beginPath();
                ctx.arc(particle.x,particle.y,particle.radius*Math.max(.25,particle.life),0,Math.PI*2);
                ctx.fill();
                ctx.restore();
            });
        }

        function scheduleEcosystemCanvasFrame(){
            const canvas=document.getElementById('ecosystem-canvas');
            if(!canvas||!ecosystemCanvasContext)return;
            const rect=canvas.getBoundingClientRect();
            if(rect.width<1||rect.height<1)return;
            if(ecosystemCanvasFrame!==null)return;
            if(ecosystemCanvasReducedMotion()){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasMotion.seedDrop=ecosystemCanvasTargets.seedDrop;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            ecosystemCanvasFrame=requestAnimationFrame(runEcosystemCanvasFrame);
        }

        function runEcosystemCanvasFrame(){
            ecosystemCanvasFrame=null;
            if(ecosystemCanvasReducedMotion()){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasMotion.seedDrop=ecosystemCanvasTargets.seedDrop;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            const lerp=(start,end,factor)=>start+(end-start)*factor;
            ecosystemCanvasMotion.roots=lerp(ecosystemCanvasMotion.roots,ecosystemCanvasTargets.roots,.105);
            ecosystemCanvasMotion.clouds=lerp(ecosystemCanvasMotion.clouds,ecosystemCanvasTargets.clouds,.105);
            ecosystemCanvasMotion.flowers=lerp(ecosystemCanvasMotion.flowers,ecosystemCanvasTargets.flowers,.105);
            ecosystemCanvasMotion.seedDrop=lerp(ecosystemCanvasMotion.seedDrop,ecosystemCanvasTargets.seedDrop,.16);
            ecosystemCanvasParticles=ecosystemCanvasParticles.filter(particle=>{
                particle.x+=particle.vx;
                particle.y+=particle.vy;
                particle.vy+=.025;
                particle.life-=.035;
                return particle.life>.04;
            });
            drawEcosystemCanvas();
            const moving=['roots','clouds','flowers','seedDrop'].some(key=>Math.abs(ecosystemCanvasMotion[key]-ecosystemCanvasTargets[key])>.002);
            if(moving||ecosystemCanvasParticles.length)ecosystemCanvasFrame=requestAnimationFrame(runEcosystemCanvasFrame);
        }

        function updateEcosystemCanvas(rootCount,cloudCount,canopyBloomed,animate={}){
            const canvas=document.getElementById('ecosystem-canvas');
            if(!canvas)return;
            ecosystemCanvasTargets.roots=Math.max(0,Math.min(1,rootCount/6));
            ecosystemCanvasTargets.clouds=Math.max(0,Math.min(3,cloudCount));
            ecosystemCanvasTargets.flowers=canopyBloomed?1:0;
            const reduced=ecosystemCanvasReducedMotion();
            if(animate.roots)spawnEcosystemCanvasParticles(160,190);
            if(animate.trunk)spawnEcosystemCanvasParticles(160,100);
            if(animate.flower)spawnEcosystemCanvasParticles(206,64);
            if(reduced){
                ecosystemCanvasMotion.roots=ecosystemCanvasTargets.roots;
                ecosystemCanvasMotion.clouds=ecosystemCanvasTargets.clouds;
                ecosystemCanvasMotion.flowers=ecosystemCanvasTargets.flowers;
                ecosystemCanvasParticles=[];
                drawEcosystemCanvas();
                return;
            }
            const changed=['roots','clouds','flowers'].some(key=>Math.abs(ecosystemCanvasMotion[key]-ecosystemCanvasTargets[key])>.002);
            if(changed||ecosystemCanvasParticles.length)scheduleEcosystemCanvasFrame();
            else drawEcosystemCanvas();
        }

        function spawnEcosystemCanvasParticles(x,y){
            const colors=['#8fbd83','#f48fb1','#f5d37c','#a7c8df'];
            for(let i=0;i<12&&ecosystemCanvasParticles.length<36;i++){
                const angle=(Math.PI*2*i)/12;
                const speed=.55+Math.random()*1.05;
                ecosystemCanvasParticles.push({
                    x:x+(Math.random()-.5)*9,y:y+(Math.random()-.5)*7,
                    vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-.35,
                    color:colors[i%colors.length],radius:1.4+Math.random()*1.4,life:.9+Math.random()*.1
                });
            }
        }

        function replayEcosystemWelcome(){
            const panel=document.getElementById('ecosystem-panel');
            if(panel&&!panel.classList.contains('has-roots')){
                ecosystemCanvasMotion.seedDrop=1;
                ecosystemCanvasTargets.seedDrop=0;
                scheduleEcosystemCanvasFrame();
                replayEcosystemEffect('#ecosystem-seed','is-arriving');
            }
        }

        function updateEcosystemTree(animate = {}) {
            const dateStr=document.getElementById('currentDate')?.value;
            if(!dateStr)return;
            let data={};
            try{data=JSON.parse(localStorage.getItem(getStorageKey(dateStr))||'{}')||{};}catch(error){data={};}

            const rootActions=['start-2','sleep-4','start-4','mid-3','end-3','sleep-5'];
            const rootCount=rootActions.filter(id=>data[id]===true).length;
            const cloudCount=['cumulus','stratus','stratocumulus'].filter(name=>data['cloud_'+name]===true).length;
            const canopyBloomed=data['sleep-3']===true;

            const panel=document.getElementById('ecosystem-panel');
            const seed=document.getElementById('ecosystem-seed');
            const roots=document.getElementById('ecosystem-roots');
            const trunk=document.getElementById('ecosystem-trunk');
            const canopy=document.getElementById('ecosystem-canopy');
            const rootStatus=document.getElementById('ecosystem-root-status');
            const trunkStatus=document.getElementById('ecosystem-trunk-status');
            const canopyStatus=document.getElementById('ecosystem-canopy-status');
            const intro=document.getElementById('ecosystem-intro-copy');

            panel?.classList.toggle('has-roots',rootCount>0);
            if(rootCount>0)seed?.classList.remove('is-arriving');
            if(roots){
                const rootProgress=rootCount/rootActions.length;
                roots.style.setProperty('--root-scale',(1+rootCount*.065).toFixed(3));
                roots.querySelectorAll('path').forEach(path=>{
                    let length=Number(path.dataset.ecoLength||0);
                    if(!length){
                        try{
                            length=path.getTotalLength();
                            path.dataset.ecoLength=String(length);
                            path.style.strokeDasharray=length.toFixed(2);
                        }catch(error){length=0;}
                    }
                    if(length)path.style.strokeDashoffset=(length*(1-rootProgress)).toFixed(2);
                });
            }
            if(trunk){
                trunk.style.setProperty('--trunk-x',(1+cloudCount*.05).toFixed(3));
                trunk.style.setProperty('--trunk-y',(0.82+cloudCount*.06).toFixed(3));
            }
            canopy?.classList.toggle('has-flower',canopyBloomed);

            if(rootStatus)rootStatus.textContent=rootCount
                ?rootCount+' of 6 prayer and water actions completed · roots reaching farther'
                :'0 of 6 actions · plant the seed with prayer or water';
            if(trunkStatus)trunkStatus.textContent=(cloudCount*5)+'% growth · '+cloudCount+' of 3 clouds released';
            if(canopyStatus)canopyStatus.textContent=canopyBloomed
                ?'1 of 1 · a flower has bloomed'
                :'0 of 1 · waiting for Screen Curfew';
            if(intro)intro.textContent=rootCount
                ?'Your small, steady actions are helping the roots reach farther. The trunk and canopy grow in their own time.'
                :'A fresh day begins with a seed. Choose one small prayer or water action to help it take root.';

            const updateMeter=(trackId,fillId,value,max)=>{
                const track=document.getElementById(trackId);
                const fill=document.getElementById(fillId);
                if(track)track.setAttribute('aria-valuenow',String(value));
                if(fill)fill.style.width=(max?Math.round((value/max)*100):0)+'%';
            };
            updateMeter('ecosystem-root-meter','ecosystem-root-meter-fill',rootCount,6);
            updateMeter('ecosystem-trunk-meter','ecosystem-trunk-meter-fill',cloudCount,3);
            updateMeter('ecosystem-canopy-meter','ecosystem-canopy-meter-fill',canopyBloomed?1:0,1);
            updateEcosystemCanvas(rootCount,cloudCount,canopyBloomed,animate);

            if(animate.roots&&rootCount)replayEcosystemEffect('#ecosystem-roots','is-pulsing');
            if(animate.trunk&&cloudCount)replayEcosystemEffect('#ecosystem-trunk','is-growing');
            if(animate.flower&&canopyBloomed)replayEcosystemEffect('#ecosystem-canopy','has-flower');
        }

        function checkSectionCompletion() {
            updateDailyActivityProgress();
            let completedCards = 0;
            for (let i = 1; i <= 6; i++) {
                const chks = document.querySelectorAll('.sec-' + i);
                const allChecked = isSectionComplete(i);
                
                const trophy = document.getElementById('trophy-' + i);
                if (allChecked && chks.length > 0) {
                    trophy.classList.remove('opacity-30');
                    trophy.classList.add('scale-125', 'opacity-100');
                    completedCards++;
                } else {
                    trophy.classList.add('opacity-30');
                    trophy.classList.remove('scale-125', 'opacity-100');
                }
            }

            const trophyBanner = document.getElementById('trophy-banner');
            const dateStr = document.getElementById('currentDate').value;
            const scoreAwardedKey = 'score_awarded_' + dateStr;

            const grandFinale = document.getElementById('grand-finale-overlay');
            // This date-specific marker already exists in synced daily records.
            // Previous app versions set it when the victory was first shown, so
            // it also prevents old completed dates from replaying after this update.
            if (completedCards === 6 && !localStorage.getItem(scoreAwardedKey)) {
                // Claim the one-time reward before showing anything. Reloads,
                // repeated checks, and repeated Finish clicks cannot replay it.
                localStorage.setItem(scoreAwardedKey, 'true');
                let currentScore = parseInt(localStorage.getItem('user_confidence_score') || '0');
                localStorage.setItem('user_confidence_score', currentScore + 100);
                updateScoreDisplay();

                trophyBanner.classList.remove('hidden');
                playFanfareSound();
                setTimeout(speakProudCue, 400);
                confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 } });

                grandFinale.classList.remove('hidden');
                requestAnimationFrame(() => {
                    resizeEcosystemCanvas();
                    updateEcosystemTree();
                });
                scheduleMissedCardVictoryReturn(dateStr);
            } else if (completedCards !== 6) {
                trophyBanner.classList.add('hidden');
                grandFinale.classList.add('hidden');
            }
        }

        function closeGrandFinale() {
            document.getElementById('grand-finale-overlay').classList.add('hidden');
            // If the user closes the missed-card celebration early, honor that
            // action by returning to today's checklist immediately.
            if (missedCardReviewContext && missedCardVictoryTimer) {
                window.clearTimeout(missedCardVictoryTimer);
                missedCardVictoryTimer = null;
                returnFromMissedCardReview().catch(error => {
                    console.error('[Checklist] Could not return to today after closing the celebration.', error);
                });
            }
        }

        function loadData() {
            const dateStr = document.getElementById('currentDate').value;
            const saved = localStorage.getItem(getStorageKey(dateStr));
            const data = saved ? JSON.parse(saved) : {};

            // Older versions marked the cloud task complete after only one click.
            // Clear that legacy completion before restoring the checkbox state.
            if (data.cloud_flow_version !== 1 && data['cloud-checked'] === true) {
                data['cloud-checked'] = false;
                data['cloud-checked__guided'] = false;
            }

            document.querySelectorAll('.app-chk').forEach(chk => {
                const id = chk.dataset.id;
                const isChecked = data[id] !== undefined ? data[id] : false;
                chk.checked = isChecked;
                const guided = data[id + '__guided'] === true || isChecked;
                chk.dataset.guideUnlocked = guided ? 'true' : 'false';
                if (guided) chk.disabled = false;
            });

            // Private diary and reflections are loaded only after the passphrase unlocks them.
            restoreCloudProgress(data);
            syncChecklistCartoons();
            updateEcosystemTree();

            checkSectionCompletion();
            updateScoreDisplay();
            renderLocationCheckinDetails(dateStr);
            renderMissedCardNotifications();
        }

        function saveData(e) {
            if(e?.target&&(e.target.id==='private-diary-entry'||e.target.id==='diary-passphrase'||e.target.id==='diary-passphrase-confirm'||e.target.classList?.contains('text-input')))return;
            const dateStr=document.getElementById('currentDate').value;
            // Preserve old note values until they have been encrypted during first-time setup.
            let data={};
            try{data=JSON.parse(localStorage.getItem(getStorageKey(dateStr))||'{}')||{};}catch(error){data={};}

            document.querySelectorAll('.app-chk').forEach(chk => {
                data[chk.dataset.id] = chk.checked;
                data[chk.dataset.id + '__guided'] = chk.dataset.guideUnlocked === 'true' || chk.checked;
            });

            // Private reflection text is saved separately using AES-256-GCM.
            data.cloud_flow_version = 1;
            document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
                data['cloud_' + item.dataset.cloud] = item.dataset.released === 'true';
            });

            localStorage.setItem(getStorageKey(dateStr), JSON.stringify(data));

            const changedId=e?.type==='change'&&e.target?.type==='checkbox'&&e.target.checked?e.target.dataset.id:null;
            updateEcosystemTree({
                roots:['start-2','sleep-4','start-4','mid-3','end-3','sleep-5'].includes(changedId),
                flower:changedId==='sleep-3'
            });

            if (e && e.target && e.target.type === 'checkbox' && e.target.checked) {
                playPopSound();
                confetti({ particleCount: 30, spread: 50, origin: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } });
            }

            checkSectionCompletion();
        }

        async function handleDateChange() {
            await flushPrivateWritingQueue();
            const previousDate=writingLoadedDate;
            if(writingCryptoKey&&previousDate)await savePrivateWritingForDate(previousDate);
            loadData();
            const dateString = getCurrentWritingDate();
            updateDiaryDateAccess(dateString);
            if (diaryViewingHistoricalDate) {
                const historicalDate = diaryViewingHistoricalDate;
                const editor = document.getElementById('private-diary-entry');
                if (editor) editor.readOnly = true;
                updateDiaryDateLabel(historicalDate);
                renderDiaryLocationLogs(historicalDate);
                await renderDiaryVoiceNotes(historicalDate);
                return;
            }
            updateDiaryDateLabel(dateString);
            if(writingCryptoKey){
                try {
                    await loadPrivateWritingForDate(dateString);
                    updateDiaryDateAccess(dateString);
                    renderDiaryLocationLogs(dateString);
                    await renderDiaryVoiceNotes(dateString);
                    updateDiaryDateLabel(dateString);
                } catch(error) {
                    setWritingSecurityStatus('Could not decrypt this date’s private writing. Nothing was overwritten. '+(error?.message||''),'error');
                }
            }
        }

        function resetChecklistWizard() {
            currentStep = 1;
            for (let step = 1; step <= 6; step++) {
                document.getElementById('card-step-' + step)?.classList.toggle('hidden', step !== 1);
                document.getElementById('dot-' + step)?.classList.toggle('opacity-30', step !== 1);
            }
            const stepNumber = document.getElementById('current-step-num');
            if (stepNumber) stepNumber.textContent = '1';
            const previous = document.getElementById('btn-prev');
            if (previous) {
                previous.disabled = true;
                previous.classList.add('opacity-50', 'cursor-not-allowed');
            }
            const next = document.getElementById('btn-next');
            if (next) next.textContent = 'Next Card ➔';
            document.getElementById('finish-status')?.classList.add('hidden');
            document.getElementById('trophy-banner')?.classList.add('hidden');
            document.getElementById('grand-finale-overlay')?.classList.add('hidden');
            document.getElementById('location-checkin-footer')?.classList.remove('hidden');
            const checklistMain = document.querySelector('#view-checklist main');
            if (checklistMain) checklistMain.scrollTop = 0;
        }

        async function resetDayData() {
            const dateStr=document.getElementById('currentDate').value;
            const confirmation = "Start the Health Checklist over for " + dateStr
                + "? This clears checklist progress and reflection notes for that date and resets the Garden so you can plant your seeds again. "
                + "Your Personal Diary entries and all location logs will be kept.";
            if (!confirm(confirmation)) return;

            try {
                await flushPrivateWritingQueue();
                localStorage.removeItem(getStorageKey(dateStr));
                localStorage.removeItem(getSecureWritingStorageKey('notes',dateStr));
                localStorage.removeItem(GARDEN_STORAGE_KEY);
            } catch (error) {
                setWritingSecurityStatus('The reset could not be completed. Please review the current checklist state before trying again. '
                    + (error?.message || ''), 'error');
                return;
            }

            document.dispatchEvent(new CustomEvent('garden:reset-for-checklist'));
            resetChecklistWizard();
            loadData();
            setLocationCheckinMessage('', 'info');

            if (writingCryptoKey) {
                try {
                    await loadPrivateWritingForDate(dateStr);
                    renderDiaryLocationLogs(dateStr);
                } catch(error) {
                    setWritingSecurityStatus('The checklist was reset, but saved private writing could not be read. '
                        + (error?.message || ''), 'error');
                }
            }
        }

        async function handleDiaryKeyActionWithLocationLogs() {
            await handleDiaryKeyAction();
            updateDiaryDateAccess(getCurrentWritingDate());
            if (writingCryptoKey) {
                renderDiaryLocationLogs(getCurrentWritingDate());
                await renderDiaryVoiceNotes(getCurrentWritingDate());
            }
        }

        async function startVoiceNoteRecording() {
            const dateString = getCurrentWritingDate();
            if (!writingCryptoKey) throw new Error('Unlock your Diary before recording a voice note.');
            if (dateString !== getDeviceLocalDateString()
                || writingLoadedDate !== dateString
                || diaryViewingHistoricalDate) {
                throw new Error('New voice notes can only be recorded on today’s Diary page. Previous voice notes are read-only.');
            }
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
                throw new Error('This browser does not support voice recording.');
            }

            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (!writingCryptoKey) throw new Error('The Diary locked before recording could begin.');

                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                activeVoiceNoteDate = getCurrentWritingDate();
                voiceNoteStopPromise = new Promise(resolve => {
                    voiceNoteStopResolve = resolve;
                });
                activeVoiceNoteBytes = 0;
                activeVoiceNoteExceededLimit = false;
                mediaRecorder.ondataavailable = event => {
                    if (!event.data?.size || activeVoiceNoteExceededLimit) return;
                    if (activeVoiceNoteBytes + event.data.size > MAX_VOICE_NOTE_BYTES) {
                        activeVoiceNoteExceededLimit = true;
                        console.warn('[Diary Voice Note] Recording stopped at the configured size limit.', {
                            maxBytes: MAX_VOICE_NOTE_BYTES,
                            receivedBytes: activeVoiceNoteBytes + event.data.size
                        });
                        if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
                        return;
                    }
                    audioChunks.push(event.data);
                    activeVoiceNoteBytes += event.data.size;
                };
                mediaRecorder.onstop = async () => {
                    const mimeType = mediaRecorder?.mimeType
                        || audioChunks.find(chunk => chunk.type)?.type
                        || 'audio/webm';
                    stream?.getTracks().forEach(track => track.stop());
                    const dateString = activeVoiceNoteDate;

                    try {
                        if (activeVoiceNoteExceededLimit) {
                            throw new Error('Voice notes are limited to ' + Math.round(MAX_VOICE_NOTE_BYTES / 1024) + ' KB each. The recording was stopped and the oversized audio was discarded before encryption.');
                        }
                        if (!isAllowedVoiceNoteMimeType(mimeType)) {
                            throw new Error('This browser produced an unsupported audio format (' + mimeType + '). Use a browser that records WebM, MP4, Ogg, WAV, AAC, or FLAC audio.');
                        }
                        const blob = new Blob(audioChunks, { type: mimeType });
                        if (!blob.size) throw new Error('The microphone did not produce any audio data.');
                        if (blob.size > MAX_VOICE_NOTE_BYTES) {
                            throw new Error('Voice notes are limited to ' + Math.round(MAX_VOICE_NOTE_BYTES / 1024) + ' KB each.');
                        }
                        const saveStatus = document.getElementById('writing-save-status');
                        if (saveStatus) saveStatus.textContent = 'Encrypting and saving your voice note…';
                        await savePrivateVoiceNoteForDate(dateString, blob);
                        if (writingCryptoKey && writingLoadedDate === dateString) {
                            await renderDiaryVoiceNotes(dateString);
                        }
                        if (saveStatus) saveStatus.textContent = 'Voice note saved securely in your Diary.';
                    } catch (error) {
                        setWritingSecurityStatus('The voice note could not be saved. ' + (error?.message || ''), 'error');
                    } finally {
                        audioChunks = [];
                        activeVoiceNoteBytes = 0;
                        activeVoiceNoteExceededLimit = false;
                        activeVoiceNoteDate = null;
                        mediaRecorder = null;
                        const recordBtn = document.getElementById('record-btn');
                        const recordText = document.getElementById('record-text');
                        if (recordText) recordText.textContent = 'Record Voice Note';
                        if (recordBtn) {
                            recordBtn.disabled = false;
                            recordBtn.classList.replace('bg-red-600', 'bg-rose-400');
                        }
                        voiceNoteStopResolve?.();
                        voiceNoteStopResolve = null;
                        voiceNoteStopPromise = null;
                    }
                };

                mediaRecorder.start(1000);
                const recordBtn = document.getElementById('record-btn');
                const recordText = document.getElementById('record-text');
                if (recordText) recordText.textContent = 'Stop Recording';
                if (recordBtn) {
                    recordBtn.disabled = false;
                    recordBtn.classList.replace('bg-rose-400', 'bg-red-600');
                }
                const saveStatus = document.getElementById('writing-save-status');
                if (saveStatus) saveStatus.textContent = 'Recording voice note…';
            } catch (error) {
                stream?.getTracks().forEach(track => track.stop());
                mediaRecorder = null;
                activeVoiceNoteDate = null;
                audioChunks = [];
                activeVoiceNoteBytes = 0;
                activeVoiceNoteExceededLimit = false;
                voiceNoteStopResolve?.();
                voiceNoteStopResolve = null;
                voiceNoteStopPromise = null;
                throw error;
            }
        }

        async function stopActiveVoiceRecording() {
            if (voiceRecorderStarting) await voiceRecorderStarting;
            if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
            if (voiceNoteStopPromise) await voiceNoteStopPromise;
        }

        async function updateCurrentDiary() {
            const dateString = getCurrentWritingDate();
            const canUpdate = dateString === getDeviceLocalDateString()
                && writingLoadedDate === dateString
                && Boolean(writingCryptoKey)
                && !diaryViewingHistoricalDate;
            const button = document.getElementById('diary-update-button');
            if (!canUpdate) {
                updateDiaryDateAccess(dateString);
                setWritingSecurityStatus('Only today’s Diary page can be updated. Previous entries remain read-only.', 'info');
                return;
            }

            if (button) {
                button.disabled = true;
                button.textContent = 'Updating…';
            }
            try {
                // This also finishes an in-progress recording before confirming the update.
                await flushAndSaveCurrentPrivateWriting();
                await renderDiaryVoiceNotes(dateString);
                setWritingSecurityStatus('Today’s Diary page and its saved voice notes are up to date on this device.', 'success');
            } catch (error) {
                setWritingSecurityStatus('The current Diary page could not be updated. Your visible text remains here. '
                    + (error?.message || ''), 'error');
            } finally {
                if (button) button.textContent = 'Update';
                updateDiaryDateAccess(getCurrentWritingDate());
            }
        }

        async function toggleVoiceRecording() {
            const dateString = getCurrentWritingDate();
            if (dateString !== getDeviceLocalDateString()
                || writingLoadedDate !== dateString
                || diaryViewingHistoricalDate) {
                setWritingSecurityStatus('New voice notes can only be recorded on today’s Diary page. Previous recordings are read-only.', 'info');
                updateDiaryDateAccess(dateString);
                return;
            }
            const recordBtn = document.getElementById('record-btn');
            const recordText = document.getElementById('record-text');

            if (mediaRecorder?.state === 'recording') {
                if (recordBtn) recordBtn.disabled = true;
                if (recordText) recordText.textContent = 'Saving…';
                mediaRecorder.stop();
                return;
            }

            if (voiceRecorderStarting) return;
            voiceRecorderStarting = startVoiceNoteRecording();
            try {
                await voiceRecorderStarting;
            } catch (error) {
                setWritingSecurityStatus(error?.message || 'Microphone access was denied or unavailable.', 'error');
                const recordBtn = document.getElementById('record-btn');
                const recordText = document.getElementById('record-text');
                if (recordBtn) {
                    recordBtn.disabled = false;
                    recordBtn.classList.replace('bg-red-600', 'bg-rose-400');
                }
                if (recordText) recordText.textContent = 'Record Voice Note';
            } finally {
                voiceRecorderStarting = null;
            }
        }

        window.addEventListener('load',async function() {
            requestPersistentStorage();

            const now=new Date();
            const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
            document.getElementById('currentDate').value=today;
            updateDiaryDateAccess(today);
            updateDeviceClock();
            window.setInterval(updateDeviceClock,15000);
            attachChecklistCartoons();
            loadData();
            updatePrivateWritingAccess();
        });


        const delegatedClickActions={
            reviewMissedCard:el=>reviewMissedCard(el),
            dismissMissedCardNotifications:()=>dismissMissedCardNotifications(),
            showPage:el=>showPage(el.dataset.page),
            openModal:el=>openModal(el.dataset.modal,el.dataset.target),
            openDiaryArchive:()=>openDiaryArchive(),
            returnToCurrentDiary:()=>restoreCurrentDiaryDate(),
            closeDiaryArchive:()=>closeDiaryArchive(),
            backDiaryArchiveList:()=>showDiaryArchiveList(),
            openDiaryArchiveDate:el=>openDiaryArchiveDate(el.dataset.date),
            changeStep:el=>changeStep(Number(el.dataset.direction)),
            releaseCloud:el=>releaseCloud(el),
            closeGrandFinale:()=>closeGrandFinale(),
            closeModal:()=>closeModal(),
            completeAnimation:()=>handleModalPrimaryAction(),
            handleDiaryKeyAction:()=>handleDiaryKeyActionWithLocationLogs(),
            handleNextStep:()=>handleNextStep(),
            lockPrivateWriting:()=>lockPrivateWriting(),
            resetDayData:()=>resetDayData(),
            toggleVoiceRecording:()=>toggleVoiceRecording(),
            updateCurrentDiary:()=>updateCurrentDiary(),
            copyLocationCoordinates:button=>copyLocationCoordinates(button)
        };
        document.addEventListener('click',event=>{
            const trigger=event.target.closest('[data-action]');
            if(!trigger)return;
            const action=delegatedClickActions[trigger.dataset.action];
            if(action){event.preventDefault();action(trigger);}
        });
        document.addEventListener('keydown',event=>{
            if (event.key === 'Escape' && !document.getElementById('diary-archive-panel')?.classList.contains('hidden')) {
                closeDiaryArchive();
                return;
            }
            if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-action][role="button"]')){
                event.preventDefault();
                event.target.click();
            }
        });
        document.addEventListener('change',event=>{
            const trigger=event.target.closest('[data-change-action]');
            if(trigger&&trigger.dataset.changeAction==='handleDateChange')handleDateChange();
        },true);
        document.addEventListener('change', event => {
            const checkbox = event.target;
            if (!checkbox?.matches?.('#card-step-1 .app-chk.sec-1')) return;
            if (checkbox.checked) requestLocationCheckin(checkbox);
        });
        window.addEventListener('faith-focus:app-unlocked', () => {
            showPage('garden');
        });
        window.addEventListener('faith-focus:vault-data-restored', async event => {
            const dateString = event.detail?.dateString;
            if (!dateString) return;
            if (dateString === getPreviousDeviceDateString()) renderMissedCardNotifications();
            if (dateString !== document.getElementById('currentDate')?.value) return;
            loadData();
            if (writingCryptoKey) {
                try {
                    await loadPrivateWritingForDate(dateString);
                    updateDiaryDateAccess(dateString);
                    renderDiaryLocationLogs(dateString);
                    await renderDiaryVoiceNotes(dateString);
                } catch (error) {
                    setWritingSecurityStatus('The restored Diary data could not be opened. The encrypted local packet remains available. ' + (error?.message || ''), 'error');
                }
            }
        });

        window.addEventListener('resize',resizeEcosystemCanvas,{passive:true});
        document.addEventListener('change',saveData);
        document.addEventListener('input',saveData);
        document.querySelectorAll('#private-diary-entry,.text-input').forEach(field=>{
            field.addEventListener('input',schedulePrivateWritingSave);
            field.addEventListener('change',schedulePrivateWritingSave);
        });
        document.addEventListener('visibilitychange',()=>{
            if(document.visibilityState==='hidden'){
                // Save local Diary edits on hide. Account locking is controlled
                // only by the 15-minute inactivity timer or an explicit lock action.
                flushAndSaveCurrentPrivateWriting().catch(error => {
                    setWritingSecurityStatus('Encrypted save failed on hide. '+(error?.message||''),'error');
                });
            }
        });