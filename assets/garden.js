import {
    FLOWER_TYPES, GARDEN_STORAGE_KEY, TREE_TYPES, createGardenState,
    getFlowerStage, getPlantAgeDays, getTreeStage, validateGardenState
} from './garden-model.js';

const overlay = document.getElementById('little-garden');
if (overlay) initializeGarden(overlay);

function initializeGarden(root) {
    let windowIsOpen = false;

    const byId = id => root.querySelector('#' + id);
    let garden = loadSavedGarden();

    function todayISO() {
        const now = new Date();
        return [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('-');
    }

    function showStatus(message, state = 'info') {
        const status = byId('garden-status');
        if (!status) return;
        status.textContent = message;
        status.dataset.state = state;
    }

    function saveGarden() {
        try {
            localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(garden));
            return true;
        } catch (error) {
            showStatus('Your garden is still here for this visit, but this browser could not save it. Check available site storage before closing the app.', 'error');
            return false;
        }
    }

    function loadSavedGarden() {
        try {
            const stored = localStorage.getItem(GARDEN_STORAGE_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            const safeState = validateGardenState(parsed);
            if (!safeState) {
                showStatus('The saved garden data could not be verified, so it was left untouched. You can start a new garden on this device.', 'error');
                return null;
            }
            return safeState;
        } catch (error) {
            showStatus('The saved garden could not be read. Your checklist and diary data were not changed.', 'error');
            return null;
        }
    }

    function setScene(sceneName) {
        overlay.classList.toggle('garden-room-home', sceneName === 'room');
        overlay.classList.toggle('garden-checklist-active', sceneName === 'checklist');
        root.querySelectorAll('[data-garden-scene]').forEach(scene => {
            scene.classList.toggle('hidden', scene.dataset.gardenScene !== sceneName);
        });
        const heading = byId('garden-scene-heading');
        if (heading) {
            const labels = { room: 'The Forge Room', outdoors: 'The Garden', checklist: 'My Health Checklist', diary: 'Personal Diary' };
            heading.textContent = labels[sceneName] || 'The Forge Room';
        }
        const intro = byId('garden-scene-intro');
        if (intro) {
            const descriptions = {
                room: 'Build and strengthen your armor, one day at a time.',
                outdoors: 'Your seeds of Hope and Faith grow with the passing days. Watering is a kind moment, never a race.',
                checklist: 'Small steps strengthen your focus. Move through each card at your own pace.',
                diary: 'A private place for your thoughts. Your writing is encrypted with your separate passphrase.'
            };
            intro.textContent = descriptions[sceneName] || descriptions.room;
        }
        const focusTarget = sceneName === 'checklist' ? byId('checklist-page-title') : heading;
        if (!overlay.classList.contains('hidden')) focusTarget?.focus({ preventScroll: true });
    }

    function renderRoom() {
        const setup = byId('garden-first-planting');
        const fields = byId('garden-planting-fields');
        const heading = byId('garden-planting-heading');
        const description = byId('garden-planting-description');
        const plantButton = byId('garden-planting-button');
        const completion = byId('garden-planting-complete');
        const isComplete = Boolean(garden);

        // Plant selection is a one-time setup milestone, restored from the saved garden.
        if (setup) {
            setup.dataset.setupState = isComplete ? 'complete' : 'pending';
            setup.classList.toggle('is-complete', isComplete);
        }
        if (fields) fields.disabled = isComplete;
        if (heading) heading.textContent = isComplete ? 'Initial planting setup completed' : 'Day 1: Let’s plant two little seeds!';
        if (description) {
            description.textContent = isComplete
                ? 'Your original seed choices are saved. This setup is complete and cannot be changed here.'
                : 'Choose one fruit tree and one pretty flower. They will grow with the passing days, even when you are away.';
        }
        if (plantButton) {
            plantButton.disabled = isComplete;
            plantButton.textContent = isComplete ? 'Setup Completed ✓' : 'Plant my two seeds 🌱';
        }
        if (completion) completion.classList.toggle('hidden', !isComplete);

        if (garden) {
            const tree = TREE_TYPES[garden.treeType];
            const flower = FLOWER_TYPES[garden.flowerType];
            const treeChoice = byId('garden-tree-choice');
            const flowerChoice = byId('garden-flower-choice');
            if (treeChoice) treeChoice.value = garden.treeType;
            if (flowerChoice) flowerChoice.value = garden.flowerType;
            const seeds = byId('garden-room-seeds');
            const date = byId('garden-room-date');
            if (seeds) seeds.textContent = tree.name + ' tree and ' + flower.name;
            if (date) date.textContent = garden.plantedOn;
        }
        const windowButton = byId('garden-window-button');
        const roomWindow = byId('garden-window');
        if (windowButton) {
            windowButton.setAttribute('aria-pressed', String(windowIsOpen));
            windowButton.textContent = windowIsOpen ? 'Close the window 🍃' : 'Open the window 🍃';
        }
        if (roomWindow) roomWindow.classList.toggle('is-open', windowIsOpen);
    }

    function updatePlantCard(prefix, stage, name, ageDays, plantedOn) {
        const visual = byId(prefix + '-visual');
        const title = byId(prefix + '-name');
        const description = byId(prefix + '-description');
        const progress = byId(prefix + '-progress');
        const progressText = byId(prefix + '-progress-text');
        const ageText = byId(prefix + '-age');

        if (visual) visual.textContent = stage.emoji;
        if (title) title.textContent = name;
        if (description) description.textContent = stage.label;
        if (ageText) ageText.textContent = ageDays === 0 ? 'Planted today' : ageDays + (ageDays === 1 ? ' day growing' : ' days growing');
        if (progress) {
            progress.style.width = stage.progress + '%';
            progress.setAttribute('aria-valuenow', String(stage.progress));
        }
        if (progressText) {
            progressText.textContent = stage.nextAt === null
                ? 'One-year milestone reached'
                : stage.daysUntilNext + (stage.daysUntilNext === 1 ? ' day to next stage' : ' days to next stage');
        }
        const dateLabel = byId(prefix + '-planted-on');
        if (dateLabel) dateLabel.textContent = 'Planted ' + plantedOn;
    }

    function renderGarden() {
        if (!garden) {
            setScene('room');
            showStatus('The Forge Room is ready. Choose a fruit tree seed and a flower seed to begin growing.', 'info');
            return;
        }

        const today = todayISO();
        const ageDays = getPlantAgeDays(garden.plantedOn, today) ?? 0;
        const tree = TREE_TYPES[garden.treeType];
        const flower = FLOWER_TYPES[garden.flowerType];

        updatePlantCard('garden-tree', getTreeStage(ageDays), tree.name + ' tree ' + tree.fruit, ageDays, garden.plantedOn);
        updatePlantCard('garden-flower', getFlowerStage(ageDays), flower.name + ' ' + flower.bloom, ageDays, garden.plantedOn);

        const dayNumber = ageDays + 1;
        const dayCount = byId('garden-day-count');
        const plantedDate = byId('garden-planted-date');
        if (dayCount) dayCount.textContent = 'Day ' + dayNumber + ' of your garden';
        if (plantedDate) plantedDate.textContent = 'Your two seeds were planted on ' + garden.plantedOn + '.';

        const waterButton = byId('garden-water-button');
        const wateredToday = garden.wateringDates.includes(today);
        if (waterButton) {
            waterButton.disabled = wateredToday;
            waterButton.textContent = wateredToday ? 'Watered today ✓' : 'Water the garden';
        }

        const careCount = byId('garden-care-count');
        if (careCount) careCount.textContent = String(garden.wateringDates.length);
        const treeMilestone = byId('garden-tree-milestone');
        if (treeMilestone) {
            treeMilestone.textContent = ageDays >= 365
                ? 'A whole year of patience. Your tree has reached its one-year milestone.'
                : 'The fruit tree’s one-year milestone is Day 366 on the garden calendar.';
        }
    }

    function openOverlay() {
        overlay.classList.remove('hidden');
        document.body.classList.add('garden-overlay-open');
        windowIsOpen = false;
        renderRoom();
        setScene('room');
        byId('garden-close')?.focus();
    }

    function closeOverlay() {
        // Escape and the Room control return to the Forge Room, the app home.
        renderRoom();
        setScene('room');
        byId('garden-close')?.focus();
    }

    function handleAction(action, trigger) {
        if (action === 'open-garden') {
            openOverlay();
            return;
        }
        if (!overlay.contains(trigger)) return;

        switch (action) {
            case 'close-garden':
                closeOverlay();
                break;
            case 'toggle-window':
                windowIsOpen = !windowIsOpen;
                renderRoom();
                showStatus(windowIsOpen ? 'A little fresh air is coming through the window.' : 'The window is closed and the room is cozy.', 'info');
                break;
            case 'begin-planting': {
                if (garden) {
                    showStatus('Your first two seeds are already planted. They are growing at their own gentle pace.', 'info');
                    setScene('outdoors');
                    renderGarden();
                    return;
                }
                try {
                    const treeChoice = byId('garden-tree-choice')?.value;
                    const flowerChoice = byId('garden-flower-choice')?.value;
                    garden = createGardenState(treeChoice, flowerChoice, todayISO());
                    if (!saveGarden()) {
                        garden = null;
                        renderRoom();
                        setScene('room');
                        return;
                    }
                    renderRoom();
                    setScene('outdoors');
                    renderGarden();
                    showStatus('Two little seeds are in the soil. Your initial setup is complete, and their growth will follow the calendar.', 'success');
                } catch (error) {
                    showStatus(error?.message || 'Please choose one tree and one flower.', 'error');
                }
                break;
            }
            case 'visit-garden':
                renderGarden();
                setScene('outdoors');
                break;
            case 'back-to-room':
                renderRoom();
                setScene('room');
                break;
            case 'water-garden': {
                if (!garden) return;
                const today = todayISO();
                if (garden.wateringDates.includes(today)) {
                    showStatus('You have already watered today. Your plants can rest now; missing a day will never make them disappear.', 'info');
                    return;
                }
                garden.wateringDates.push(today);
                garden.wateringDates = garden.wateringDates.slice(-3660);
                saveGarden();
                renderGarden();
                showStatus('A gentle drink for both plants. Watering is a caring moment, not a growth shortcut.', 'success');
                break;
            }
            default:
                break;
        }
    }

    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-garden-action]');
        if (!trigger) return;
        handleAction(trigger.dataset.gardenAction, trigger);
    });

    document.addEventListener('garden:open', () => {
        if (overlay.classList.contains('hidden')) openOverlay();
        else {
            renderRoom();
            setScene('room');
        }
    });

    document.addEventListener('garden:show-scene', event => {
        const sceneName = event.detail?.scene;
        if (!['checklist', 'diary'].includes(sceneName)) return;
        if (overlay.classList.contains('hidden')) openOverlay();
        setScene(sceneName);
    });

    document.addEventListener('keydown', event => {
        if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('[data-garden-action][role="button"]')) return;
        event.preventDefault();
        event.target.click();
    });

    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeOverlay();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...overlay.querySelectorAll('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]')]
            .filter(element => !element.closest('.hidden'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !overlay.classList.contains('hidden') && garden) {
            renderGarden();
        }
    });
    window.addEventListener('focus', () => {
        if (!overlay.classList.contains('hidden') && garden) renderGarden();
    });

    // Loading and rendering never touch checklist progress or private diary storage.
    renderRoom();
    if (!garden) showStatus('The Forge Room is ready. Your growing journey can begin whenever you are ready.', 'info');
}
