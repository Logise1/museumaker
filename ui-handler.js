import { onValue, push, set, get, query, orderByChild, limitToFirst, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getSelectedObject, updateRoomDimensions, markAsDirty, textureCache, textureNames, currentMusic, drawingColors, getDb, getMuseumId } from './three-scene.js';

let callbacks = {};

const views = {
    auth: document.getElementById('auth-container'),
    dashboard: document.getElementById('dashboard-container'),
    app: document.getElementById('app-container')
};

export function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) views[viewName].classList.remove('hidden');
}

export function showModal(modalId) { document.getElementById(modalId).classList.remove('hidden'); }
export function hideModal(modalId) { document.getElementById(modalId).classList.add('hidden'); }

export function showMessage(message, type = 'success') {
    const box = document.createElement('div');
    box.textContent = message;
    box.className = `fixed top-5 left-1/2 -translate-x-1/2 p-3 px-5 rounded-lg text-white shadow-lg z-50 ${type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
}

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
                                <button data-id="${museumId}" data-name="${museum.name}" class="edit-btn btn btn-primary btn-sm">Editar</button>`;
            museumsList.appendChild(item);
        }
        museumsList.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', (e) => startEditorCallback(e.target.dataset.id, e.target.dataset.name)));
        museumsList.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', (e) => confirmDeleteCallback(e.target.dataset.id, e.target.dataset.name)));
    });
}

export function updateInfoPanel(selectedObject) {
    const views = ['default', 'room', 'painting', 'settings'];
    let currentView = 'default';
    if (!selectedObject) {
        // Keep default view
    } else if (selectedObject.userData.isRoom) {
        currentView = 'room';
    } else if (selectedObject.userData.isPainting || selectedObject.userData.isDrawingCanvas) {
        currentView = 'painting';
    }

    views.forEach(v => document.getElementById(`info-panel-${v}`).classList.toggle('hidden', v !== currentView));

    if (currentView === 'room' && selectedObject) {
        document.getElementById('room-width').value = selectedObject.userData.width;
        document.getElementById('room-depth').value = selectedObject.userData.depth;
        document.getElementById('room-height').value = selectedObject.userData.height;
        ['floor', 'wall', 'ceiling'].forEach(type => {
            document.querySelectorAll(`#${type}-texture-selector > div`).forEach(el => el.classList.toggle('border-indigo-500', el.dataset.textureName === selectedObject.userData.textures[type]));
        });
    } else if (currentView === 'painting' && selectedObject) {
        const initialWidth = selectedObject.userData.initialWidth || (selectedObject.userData.isDrawingCanvas ? 4 : 4);
        const initialHeight = selectedObject.userData.initialHeight || (selectedObject.userData.isDrawingCanvas ? 3 : 4);
        document.getElementById('painting-width').value = (initialWidth * selectedObject.scale.x).toFixed(2);
        document.getElementById('painting-height').value = (initialHeight * selectedObject.scale.y).toFixed(2);
        const infoTextEl = document.getElementById('painting-info-text');
        infoTextEl.value = selectedObject.userData.infoText || '';
        infoTextEl.disabled = selectedObject.userData.isDrawingCanvas;
        document.querySelector('#info-panel-painting h1').textContent = selectedObject.userData.isDrawingCanvas ? 'Editar Pizarra' : 'Editar Cuadro';
    }
}

export function deselectObject() {
    updateInfoPanel(null);
}

export async function showFocusView(paintingGroup, getImageDataUrl) {
    if (!paintingGroup) return;
    document.body.classList.add('is-interacting'); // To prevent pointer lock
    
    const imageEl = document.getElementById('focus-image');
    const textEl = document.getElementById('focus-text');
    
    imageEl.src = 'https://placehold.co/800x600/f1f5f9/94a3b8?text=Cargando...';
    textEl.textContent = paintingGroup.userData.infoText || "No hay información disponible para esta obra.";

    showModal('focus-view-modal');

    const imageUrl = await getImageDataUrl(paintingGroup.userData.imageId);
    if (imageUrl) imageEl.src = imageUrl; else imageEl.src = 'https://placehold.co/800x600/fee2e2/ef4444?text=Error+al+cargar';
}

export function hideFocusView() {
    if (!document.getElementById('focus-view-modal').classList.contains('hidden')) {
        hideModal('focus-view-modal');
        document.body.classList.remove('is-interacting');
    }
}

let editingQuizData = [], currentEditingQuestionIndex = 0;
let currentQuizQuestions = [], currentQuestionIndex = 0, quizStartTime = 0, currentQuizRoom = null;

export function openQuizEditor(room) {
    const selectedObject = room;
    document.body.classList.add('is-interacting');
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


export async function showLeaderboard(roomId, yourTime = null) {
    document.body.classList.add('is-interacting');
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
    showModal('leaderboard-modal');
}

export function startQuiz(room, currentUser) {
    const quiz = room.userData.quiz;
    if (!quiz || quiz.length === 0) return;
    currentQuizRoom = room;
    currentQuizQuestions = quiz;
    currentQuestionIndex = 0;

    document.body.classList.add('is-interacting');
    
    renderTakeQuizQuestion(currentUser);
    showModal('take-quiz-modal');
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

export function updateSettingsUI(music) {
    const radioToCheck = document.querySelector(`.music-select-radio[value="${music}"]`);
    if (radioToCheck) radioToCheck.checked = true;
}

export function initUI(cb) {
    callbacks = cb;

    // Auth
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

    // Dashboard
    document.getElementById('create-museum-btn').addEventListener('click', () => {
         document.getElementById('new-museum-name').value = '';
         showModal('create-museum-modal');
    });
    document.getElementById('cancel-create-museum-btn').addEventListener('click', () => hideModal('create-museum-modal'));
    document.getElementById('confirm-create-museum-btn').addEventListener('click', async () => {
        const museumName = document.getElementById('new-museum-name').value;
        if (!museumName) return;
        hideModal('create-museum-modal');
        await callbacks.createMuseum(museumName);
    });
    document.getElementById('cancel-delete-btn').addEventListener('click', () => hideModal('delete-confirm-modal'));
    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        const modal = document.getElementById('delete-confirm-modal');
        const museumId = modal.dataset.museumId;
        await callbacks.deleteMuseum(museumId);
        hideModal('delete-confirm-modal');
    });

    // Editor
    document.getElementById('back-to-dashboard-btn').addEventListener('click', callbacks.goBack);
    document.getElementById('publish-btn').addEventListener('click', async () => {
        const url = await callbacks.publishMuseum();
        document.getElementById('publish-url').value = url;
        showModal('publish-modal');
    });
    document.getElementById('add-drawing-canvas-btn').addEventListener('click', callbacks.addDrawing);
    document.getElementById('preview-btn').addEventListener('click', callbacks.switchToPreview);

    // Modals
    document.getElementById('add-painting-btn').addEventListener('click', () => {
        const file = document.getElementById('image-file').files[0];
        if (!file) return showMessage("Por favor, selecciona una imagen.", 'error');
        // This part needs access to activePaintingIntersect and firebase push, so it's tricky.
        // It might be better to move this logic back into three-scene.js and call it from here.
    });

    document.getElementById('cancel-painting-btn').addEventListener('click', () => { hideModal('painting-modal'); document.body.classList.remove('is-interacting'); });
    document.getElementById('close-publish-modal-btn').addEventListener('click', () => hideModal('publish-modal'));
    document.getElementById('copy-url-btn').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('publish-url').value); showMessage("Enlace copiado!"); });

    // Info Panel
    document.getElementById('room-width').addEventListener('input', () => {
        const room = getSelectedObject(); if (!room?.userData.isRoom) return;
        const w = parseInt(document.getElementById('room-width').value) || 20;
        const d = room.userData.depth;
        const h = room.userData.height;
        updateRoomDimensions(room, w, d, h);
    });
    // Add listeners for depth and height similarly...
    document.getElementById('room-depth').addEventListener('input', () => {
        const room = getSelectedObject(); if (!room?.userData.isRoom) return;
        const w = room.userData.width;
        const d = parseInt(document.getElementById('room-depth').value) || 20;
        const h = room.userData.height;
        updateRoomDimensions(room, w, d, h);
    });
    document.getElementById('room-height').addEventListener('input', () => {
        const room = getSelectedObject(); if (!room?.userData.isRoom) return;
        const w = room.userData.width;
        const d = room.userData.depth;
        const h = parseInt(document.getElementById('room-height').value) || 10;
        updateRoomDimensions(room, w, d, h);
    });

    // Quiz Editor
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
        const room = getSelectedObject();
        if (!room?.userData.isRoom) return;
        saveCurrentQuizQuestionFromUI();
        
        const finalQuizData = editingQuizData.filter(q => q.question.trim() !== '' && q.options.every(opt => opt.trim() !== ''));

        if (finalQuizData.length === 0) {
             room.userData.quiz = null;
             if (room.userData.quizTrigger) {
                const trigger = room.userData.quizTrigger;
                // remove from objects array and scene
                trigger.removeFromParent(); room.userData.quizTrigger = null;
             }
        } else {
            room.userData.quiz = finalQuizData;
            if (!room.userData.quizTrigger) {
                // create and add quiz trigger
            }
        }
        
        markAsDirty();
        hideModal('quiz-modal');
        document.body.classList.remove('is-interacting');
    });

    document.getElementById('cancel-quiz-btn').addEventListener('click', () => { hideModal('quiz-modal'); document.body.classList.remove('is-interacting'); });
    document.getElementById('close-leaderboard-btn').addEventListener('click', () => { hideModal('leaderboard-modal'); document.body.classList.remove('is-interacting'); });

    // Name Prompt
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
}

