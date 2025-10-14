import { onValue, push, set, get, query, orderByChild, limitToFirst, serverTimestamp, ref } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getSelectedObject, updateRoomDimensions as updateRoomDimensions3D, markAsDirty, textureUrls, textureNames, setCurrentMusic, drawingColors, setCurrentDrawingColor, getDb, getMuseumId, clearScene as clearScene3D, objects, roomGroups, getRenderer, drawingCanvases, placePainting } from './three-scene.js';

let callbacks = {};

// --- VIEW MANAGEMENT ---
const views = {
    auth: document.getElementById('auth-container'),
    dashboard: document.getElementById('dashboard-container'),
    app: document.getElementById('app-container')
};
export function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) views[viewName].classList.remove('hidden');
}

export function showModal(modalId) { 
    document.body.classList.add('is-interacting');
    document.getElementById(modalId).classList.remove('hidden'); 
}
export function hideModal(modalId) { 
    document.body.classList.remove('is-interacting');
    document.getElementById(modalId).classList.add('hidden'); 
}

export function showMessage(message, type = 'success') {
    const box = document.createElement('div');
    box.textContent = message;
    box.className = `fixed top-5 left-1/2 -translate-x-1/2 p-3 px-5 rounded-lg text-white shadow-lg z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
}

// --- DASHBOARD ---
export function renderDashboard(museumsRef, startEditorCallback, confirmDeleteCallback) {
    onValue(museumsRef, (snapshot) => {
        const museumsList = document.getElementById('museums-list');
        museumsList.innerHTML = '';
        if (!snapshot.exists()) {
            museumsList.innerHTML = `<p class="text-slate-500 text-center py-8">No tienes museos todavía. ¡Crea uno para empezar!</p>`;
            return;
        }
        const museums = snapshot.val();
        for (const museumId in museums) {
            const museum = museums[museumId];
            const item = document.createElement('div');
            item.className = 'museum-item';
            item.innerHTML = `<span class="font-semibold text-slate-700 truncate">${museum.name}</span>
                                <button data-id="${museumId}" data-name="${museum.name}" class="delete-btn btn btn-secondary btn-sm">Eliminar</button>
                                <button data-id="${museumId}" data-name="${museum.name}" class="edit-btn btn-primary btn-sm">Editar</button>`;
            museumsList.appendChild(item);
        }
        museumsList.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', (e) => startEditorCallback(e.target.dataset.id, e.target.dataset.name)));
        museumsList.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', (e) => confirmDeleteCallback(e.target.dataset.id, e.target.dataset.name)));
    });
}

// --- INFO PANEL & SELECTION ---
export function updateInfoPanel(selectedObject, forceView = null) {
    const panels = {
        default: document.getElementById('info-panel-default'),
        room: document.getElementById('info-panel-room'),
        painting: document.getElementById('info-panel-painting'),
        settings: document.getElementById('info-panel-settings'),
    };
    let currentView = forceView || 'default';
    if (!forceView && selectedObject) {
        if (selectedObject.userData.isRoom) currentView = 'room';
        else if (selectedObject.userData.isPainting || selectedObject.userData.isDrawingCanvas) currentView = 'painting';
    }
    
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('hidden', key !== currentView));

    if (currentView === 'room' && selectedObject) {
        document.getElementById('room-width').value = selectedObject.userData.width;
        document.getElementById('room-depth').value = selectedObject.userData.depth;
        document.getElementById('room-height').value = selectedObject.userData.height;
        ['floor', 'wall', 'ceiling'].forEach(type => {
            document.querySelectorAll(`#${type}-texture-selector > div`).forEach(el => el.classList.toggle('border-indigo-500', el.dataset.textureName === selectedObject.userData.textures[type]));
        });
    } else if (currentView === 'painting' && selectedObject) {
        const initialWidth = selectedObject.userData.initialWidth || 4;
        const initialHeight = selectedObject.userData.initialHeight || 3;
        document.getElementById('painting-width').value = (initialWidth * selectedObject.scale.x).toFixed(2);
        document.getElementById('painting-height').value = (initialHeight * selectedObject.scale.y).toFixed(2);
        const infoTextEl = document.getElementById('painting-info-text');
        infoTextEl.value = selectedObject.userData.infoText || '';
        infoTextEl.disabled = selectedObject.userData.isDrawingCanvas;
        panels.painting.querySelector('h1').textContent = selectedObject.userData.isDrawingCanvas ? 'Editar Pizarra' : 'Editar Cuadro';
    }
}

export function deselectObject() {
    updateInfoPanel(null);
}

// --- FOCUS VIEW ---
export async function showFocusView(paintingGroup, getImageDataUrl) {
    if (!paintingGroup) return;
    showModal('focus-view-modal');
    
    const imageEl = document.getElementById('focus-image');
    const textEl = document.getElementById('focus-text');
    
    imageEl.src = 'https://placehold.co/800x600/f1f5f9/94a3b8?text=Cargando...';
    textEl.textContent = paintingGroup.userData.infoText || "No hay información disponible para esta obra.";

    const imageUrl = await getImageDataUrl(paintingGroup.userData.imageId);
    if (imageUrl) imageEl.src = imageUrl; else imageEl.src = 'https://placehold.co/800x600/fee2e2/ef4444?text=Error+al+cargar';
}

export function hideFocusView() {
    if (!document.getElementById('focus-view-modal').classList.contains('hidden')) {
        hideModal('focus-view-modal');
    }
}

// --- QUIZ UI ---
let editingQuizData = [], currentEditingQuestionIndex = 0;
let currentQuizQuestions = [], currentQuestionIndex = 0, quizStartTime = 0, currentQuizRoom = null;

export function openQuizEditor(room) {
    currentQuizRoom = room;
    editingQuizData = JSON.parse(JSON.stringify(room.userData.quiz || []));
    if (editingQuizData.length === 0) {
        editingQuizData.push({ question: '', options: ['', '', '', ''], correctAnswer: 0 });
    }
    currentEditingQuestionIndex = 0;
    renderQuizEditor();
    showModal('quiz-modal');
}

function renderQuizEditor() {
    const navContainer = document.getElementById('quiz-question-nav');
    navContainer.innerHTML = '';
    editingQuizData.forEach((q, index) => {
        const navBtn = document.createElement('button');
        navBtn.textContent = index + 1;
        navBtn.className = `btn btn-sm ${index === currentEditingQuestionIndex ? 'btn-primary' : 'btn-secondary'}`;
        navBtn.onclick = () => {
            saveCurrentQuizQuestionFromUI();
            currentEditingQuestionIndex = index;
            renderQuizEditor();
        };
        navContainer.appendChild(navBtn);
    });

    const currentQ = editingQuizData[currentEditingQuestionIndex];
    if (!currentQ) return;
    document.getElementById('quiz-question').value = currentQ.question || '';
    const optionsContainer = document.getElementById('quiz-options-container');
    optionsContainer.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const optionValue = currentQ.options ? (currentQ.options[i] || '') : '';
        const isCorrect = (currentQ.correctAnswer === i);
        optionsContainer.insertAdjacentHTML('beforeend', `<div class="flex items-center gap-2"><input type="radio" name="correct-answer" value="${i}" ${isCorrect ? 'checked' : ''} class="form-radio h-5 w-5 text-indigo-600"><input type="text" class="quiz-option-input input-group-text" value="${optionValue}" placeholder="Respuesta ${i + 1}"></div>`);
    }
}

function saveCurrentQuizQuestionFromUI() {
     if (!editingQuizData[currentEditingQuestionIndex]) return;
     const question = document.getElementById('quiz-question').value.trim();
     const options = Array.from(document.querySelectorAll('.quiz-option-input')).map(input => input.value.trim());
     const correctRadio = document.querySelector('input[name="correct-answer"]:checked');
     const correctAnswer = correctRadio ? parseInt(correctRadio.value, 10) : 0;
     editingQuizData[currentEditingQuestionIndex] = { question, options, correctAnswer };
}

export function startQuiz(room, currentUser) {
    const quiz = room.userData.quiz;
    if (!quiz || quiz.length === 0) return;
    currentQuizRoom = room;
    currentQuizQuestions = quiz;
    currentQuestionIndex = 0;
    
    showModal('take-quiz-modal');
    renderTakeQuizQuestion(currentUser);
    quizStartTime = Date.now();
}

function renderTakeQuizQuestion(currentUser) {
    const question = currentQuizQuestions[currentQuestionIndex];
    document.getElementById('quiz-progress').textContent = `Pregunta ${currentQuestionIndex + 1} de ${currentQuizQuestions.length}`;
    document.getElementById('take-quiz-question').textContent = question.question;
    const optionsContainer = document.getElementById('take-quiz-options');
    optionsContainer.innerHTML = '';
    question.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-primary';
        button.textContent = option;
        button.onclick = () => answerQuiz(index === question.correctAnswer, currentUser);
        optionsContainer.appendChild(button);
    });
}

async function answerQuiz(isCorrect, currentUser) {
    currentQuestionIndex++;
    if (currentQuestionIndex >= currentQuizQuestions.length) {
        const completionTime = Date.now() - quizStartTime;
        hideModal('take-quiz-modal');

        if (!currentQuizRoom) {
            console.error("Quiz finished but no room was associated with it.");
            document.body.classList.remove('is-interacting');
            return;
        }

        if (currentUser && !currentUser.isAnonymous) {
            await saveScoreToLeaderboard(currentQuizRoom.userData.id, completionTime, currentUser.uid, currentUser.email);
            showLeaderboard(currentQuizRoom.userData.id, completionTime);
        } else {
            document.getElementById('player-name').value = '';
            const saveBtn = document.getElementById('save-score-btn');
            saveBtn.dataset.time = completionTime;
            saveBtn.dataset.roomId = currentQuizRoom.userData.id;
            showModal('name-prompt-modal');
        }
        currentQuizRoom = null;
    } else {
        renderTakeQuizQuestion(currentUser);
    }
}


export async function saveScoreToLeaderboard(roomId, time, userId, userEmail, userName = null) {
    const db = getDb();
    const museumId = getMuseumId();
    const leaderboardRef = ref(db, `museums/${museumId}/leaderboards/${roomId}`);
    const newScoreRef = push(leaderboardRef);
    await set(newScoreRef, { time, userId, userEmail, userName, createdAt: serverTimestamp() });
}

async function showLeaderboard(roomId, yourTime = null) {
    showModal('leaderboard-modal');
    const db = getDb();
    const museumId = getMuseumId();
    const leaderboardRef = query(ref(db, `museums/${museumId}/leaderboards/${roomId}`), orderByChild('time'), limitToFirst(10));
    const snapshot = await get(leaderboardRef);

    const listEl = document.getElementById('leaderboard-list');
    listEl.innerHTML = '<p class="text-slate-500">Cargando...</p>';

    if (yourTime !== null) {
        document.getElementById('leaderboard-time-info').textContent = `Tu tiempo: ${(yourTime / 1000).toFixed(2)} segundos.`;
    } else {
         document.getElementById('leaderboard-time-info').textContent = '';
    }
    
    if (!snapshot.exists()) {
        listEl.innerHTML = '<p class="text-slate-500">Nadie ha completado este quiz todavía. ¡Sé el primero!</p>';
    } else {
        listEl.innerHTML = '';
        const scores = [];
        snapshot.forEach(childSnapshot => {
            scores.push(childSnapshot.val());
        });
        
        scores.forEach((score, index) => {
            const item = document.createElement('div');
            item.className = `flex justify-between items-center p-2 rounded ${index === 0 ? 'bg-yellow-100' : 'bg-slate-100'}`;
            const userIdentifier = score.userName || (score.userEmail ? score.userEmail.split('@')[0] : 'Anónimo');
            item.innerHTML = `
                <span class="font-semibold text-slate-700">${index + 1}. ${userIdentifier}</span>
                <span class="text-slate-500">${(score.time / 1000).toFixed(2)}s</span>
            `;
            listEl.appendChild(item);
        });
    }
}

export function updateSettingsUI(music) {
    const radioToCheck = document.querySelector(`.music-select-radio[value="${music}"]`);
    if (radioToCheck) radioToCheck.checked = true;
}

// --- INITIALIZATION ---
export function initUI(cb) {
    callbacks = cb;
    
    // --- AUTH ---
    document.getElementById('login-btn').addEventListener('click', () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        callbacks.login(email, password).catch(err => document.getElementById('auth-error').textContent = err.message);
    });
    document.getElementById('signup-btn').addEventListener('click', () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        callbacks.signup(email, password).catch(err => document.getElementById('auth-error').textContent = err.message);
    });
    document.getElementById('logout-btn').addEventListener('click', callbacks.logout);

    // --- DASHBOARD ---
    document.getElementById('create-museum-btn').addEventListener('click', () => {
         document.getElementById('new-museum-name').value = '';
         showModal('create-museum-modal');
    });
    document.getElementById('cancel-create-museum-btn').addEventListener('click', () => hideModal('create-museum-modal'));
    document.getElementById('confirm-create-museum-btn').addEventListener('click', () => {
        const museumName = document.getElementById('new-museum-name').value;
        if (!museumName) return;
        hideModal('create-museum-modal');
        callbacks.createMuseum(museumName);
    });
    document.getElementById('cancel-delete-btn').addEventListener('click', () => hideModal('delete-confirm-modal'));
    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
        const modal = document.getElementById('delete-confirm-modal');
        const museumId = modal.dataset.museumId;
        callbacks.deleteMuseum(museumId);
        hideModal('delete-confirm-modal');
    });

    // --- EDITOR ---
    document.getElementById('back-to-dashboard-btn').addEventListener('click', callbacks.goBack);
    document.getElementById('publish-btn').addEventListener('click', async () => {
        const url = await callbacks.publishMuseum();
        document.getElementById('publish-url').value = url;
        showModal('publish-modal');
    });
    document.getElementById('add-drawing-canvas-btn').addEventListener('click', callbacks.addDrawing);
    document.getElementById('preview-btn').addEventListener('click', callbacks.switchToPreview);
    
    // --- MODALS ---
    document.getElementById('add-painting-btn').addEventListener('click', () => {
        const file = document.getElementById('image-file').files[0];
        if (!file) return showMessage("Por favor, selecciona una imagen.", 'error');
        
        const addButton = document.getElementById('add-painting-btn'); 
        addButton.disabled = true; 
        addButton.textContent = 'Procesando...';

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const db = getDb();
                const newImageRef = push(ref(db, 'images'));
                await set(newImageRef, e.target.result);
                // The placePainting function is now directly imported
                await placePainting(e.target.result, null, { imageId: newImageRef.key });
                hideModal('painting-modal');
                document.getElementById('image-file').value = '';
            } catch (error) { 
                showMessage("Hubo un problema al guardar tu imagen.", 'error');
            } finally { 
                addButton.disabled = false; 
                addButton.textContent = 'Añadir'; 
            }
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('cancel-painting-btn').addEventListener('click', () => hideModal('painting-modal'));
    document.getElementById('close-publish-modal-btn').addEventListener('click', () => hideModal('publish-modal'));
    document.getElementById('copy-url-btn').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('publish-url').value); showMessage("Enlace copiado!"); });
    document.getElementById('focus-view-modal').addEventListener('click', hideFocusView);


    // --- QUIZ ---
    document.getElementById('add-quiz-question-btn').addEventListener('click', () => {
        saveCurrentQuizQuestionFromUI();
        editingQuizData.push({ question: '', options: ['', '', '', ''], correctAnswer: 0 });
        currentEditingQuestionIndex = editingQuizData.length - 1;
        renderQuizEditor();
    });
    document.getElementById('delete-quiz-question-btn').addEventListener('click', () => {
        if (editingQuizData.length <= 1) return showMessage("Un quiz debe tener al menos una pregunta.", "error");
        editingQuizData.splice(currentEditingQuestionIndex, 1);
        currentEditingQuestionIndex = Math.max(0, currentEditingQuestionIndex - 1);
        renderQuizEditor();
    });
    document.getElementById('save-quiz-btn').addEventListener('click', () => {
        const room = currentQuizRoom;
        if (!room?.userData.isRoom) return;
        saveCurrentQuizQuestionFromUI();
        
        const finalQuizData = editingQuizData.filter(q => q.question.trim() !== '' && q.options.every(opt => opt.trim() !== ''));
        room.userData.quiz = finalQuizData.length > 0 ? finalQuizData : null;
        
        markAsDirty();
        hideModal('quiz-modal');
    });
    document.getElementById('cancel-quiz-btn').addEventListener('click', () => hideModal('quiz-modal'));
    document.getElementById('close-leaderboard-btn').addEventListener('click', () => hideModal('leaderboard-modal'));

    // --- NAME PROMPT ---
    document.getElementById('save-score-btn').addEventListener('click', async () => {
        const playerName = document.getElementById('player-name').value.trim();
        if (!playerName) return showMessage("Por favor, introduce un nombre.", "error");
        const btn = document.getElementById('save-score-btn');
        const time = parseInt(btn.dataset.time);
        const roomId = btn.dataset.roomId;
        hideModal('name-prompt-modal');
        await saveScoreToLeaderboard(roomId, time, 'anonymous', null, playerName);
        showLeaderboard(roomId, time);
    });
    document.getElementById('skip-score-btn').addEventListener('click', () => {
        const btn = document.getElementById('save-score-btn'); const roomId = btn.dataset.roomId;
        hideModal('name-prompt-modal'); showLeaderboard(roomId);
    });

    // --- INFO PANEL ---
    document.getElementById('settings-btn').addEventListener('click', () => updateInfoPanel(null, 'settings'));
    
    const updateDim = () => {
        const room = getSelectedObject(); if (!room?.userData.isRoom) return;
        const w = parseInt(document.getElementById('room-width').value) || 20;
        const d = parseInt(document.getElementById('room-depth').value) || 20;
        const h = parseInt(document.getElementById('room-height').value) || 10;
        updateRoomDimensions3D(room, w, d, h);
    };
    document.getElementById('room-width').addEventListener('input', updateDim);
    document.getElementById('room-depth').addEventListener('input', updateDim);
    document.getElementById('room-height').addEventListener('input', updateDim);

    document.getElementById('painting-width').addEventListener('input', updatePaintingDimensions);
    document.getElementById('painting-height').addEventListener('input', updatePaintingDimensions);

    document.getElementById('painting-info-text').addEventListener('input', (e) => {
        const selected = getSelectedObject();
        if (selected?.userData.isPainting) {
            selected.userData.infoText = e.target.value;
            markAsDirty();
        }
    });

    document.getElementById('delete-painting-btn').addEventListener('click', () => {
        const selected = getSelectedObject();
        if (selected?.userData.isPainting || selected?.userData.isDrawingCanvas) {
            if (selected.userData.isDrawingCanvas) {
                const { canvasId } = selected.userData;
                const listener = drawingCanvases[canvasId]?.listener;
                if(listener) listener();
                delete drawingCanvases[canvasId];
            }
            const objectIndex = objects.indexOf(selected); if(objectIndex > -1) objects.splice(objectIndex, 1);
            selected.removeFromParent();
            deselectObject();
            markAsDirty();
        }
    });

    // --- TEXTURES & MUSIC ---
    const onTextureSelect = (event) => {
        const item = event.target.closest('[data-texture-name]');
        const selected = getSelectedObject();
        if (!item || !selected?.userData.isRoom) return;
        const { textureName, type } = item.dataset;
        selected.userData.textures[type] = textureName;
        updateRoomDimensions3D(selected, selected.userData.width, selected.userData.depth, selected.userData.height);
        updateInfoPanel(selected);
        markAsDirty();
    };
    document.getElementById('floor-texture-selector').addEventListener('click', onTextureSelect);
    document.getElementById('wall-texture-selector').addEventListener('click', onTextureSelect);
    document.getElementById('ceiling-texture-selector').addEventListener('click', onTextureSelect);
    
    document.getElementById('music-selector').addEventListener('click', (event) => {
        const target = event.target;
        const previewBtn = target.closest('.preview-music-btn');
        const radioBtn = target.closest('.music-select-radio');
        const audio = document.getElementById('preview-audio');
        if (previewBtn) {
            event.stopPropagation();
            const fileName = previewBtn.dataset.file;
            if (fileName === 'none') { audio.pause(); return; }
            if (audio.src.includes(fileName) && !audio.paused) {
                audio.pause();
            } else {
                audio.src = `assets/music/${fileName}`;
                audio.play();
            }
        }
        if (radioBtn) {
            setCurrentMusic(radioBtn.value);
        }
    });

    document.getElementById('mute-btn').addEventListener('click', () => {
        const audio = document.getElementById('background-audio');
        audio.muted = !audio.muted;
        updateMuteButtonUI();
    });

    // --- DRAWING ---
    const drawingControls = document.getElementById('drawing-controls');
    drawingControls.innerHTML = '';
    drawingColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        if (color === '#000000') swatch.classList.add('selected');
        swatch.onclick = () => {
            setCurrentDrawingColor(color);
            drawingControls.querySelector('.selected')?.classList.remove('selected');
            swatch.classList.add('selected');
        };
        drawingControls.appendChild(swatch);
    });

    // Final setup of static elements
    setupTextureSelectors();
    updateMuteButtonUI(); // Set initial state
}

function setupTextureSelectors() {
    const selectors = {
        floor: document.getElementById('floor-texture-selector'),
        wall: document.getElementById('wall-texture-selector'),
        ceiling: document.getElementById('ceiling-texture-selector')
    };
    Object.entries(selectors).forEach(([type, container]) => {
        container.innerHTML = '';
        for (const key in textureUrls) {
            const item = document.createElement('div');
            item.className = 'cursor-pointer p-1 border-2 border-transparent rounded-md';
            item.dataset.textureName = key;
            item.dataset.type = type;
            item.innerHTML = `<div class="w-full h-12 rounded bg-cover bg-center" style="background-image: url(${textureUrls[key]})"></div><p class="text-xs text-center text-slate-600 mt-1 truncate">${textureNames[key]}</p>`;
            container.appendChild(item);
        }
    });
}

function updatePaintingDimensions() {
    const selected = getSelectedObject();
    if (!selected?.userData.isPainting && !selected?.userData.isDrawingCanvas) return;
    
    const newWidth = parseFloat(document.getElementById('painting-width').value);
    const newHeight = parseFloat(document.getElementById('painting-height').value);
    
    if (isNaN(newWidth) || isNaN(newHeight) || newWidth <= 0 || newHeight <= 0) return;

    const initialWidth = selected.userData.initialWidth || 4;
    const initialHeight = selected.userData.initialHeight || 3;

    selected.scale.x = newWidth / initialWidth;
    selected.scale.y = newHeight / initialHeight;
    
    markAsDirty();
}

function updateMuteButtonUI() {
    const audio = document.getElementById('background-audio');
    const btn = document.getElementById('mute-btn');
    const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/></svg>`;
    const muteIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zM6 5.04 4.312 6.39A.5.5 0 0 1 4 6.5H2v3h2a.5.5 0 0 1 .312.11L6 10.96V5.04zm7.854.606a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0z"/></svg>`;
    btn.innerHTML = audio.muted ? playIcon : muteIcon;
}

