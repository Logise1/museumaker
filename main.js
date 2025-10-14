import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { initUI, showView, renderDashboard, showModal, hideModal } from './ui-handler.js';
import { init3D, listenToMuseumData, saveMuseumToDB, switchToPreviewMode, setPlacingDrawingCanvas, clearScene } from './three-scene.js';

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyBLpiDOy69AWI7oHHbeXArkT1UXvIMGNZU",
    authDomain: "museumaker-79294.firebaseapp.com",
    databaseURL: "https://museumaker-79294-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "museumaker-79294",
    storageBucket: "museumaker-79294.appspot.com",
    messagingSenderId: "466260653400",
    appId: "1:466260653400:web:b03257442d6f6fa16da12d",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- GLOBAL STATE ---
let currentUser = null;
let currentMuseumId = null;
let currentMuseumName = "";
let isViewerMode = false;
let museumDataListenerUnsubscribe = null;
let isDataLoaded = false;
let saveTimeout;
let lastSaveTime = 0;
let isDirty = false;
let museumToDelete = { id: null, name: null };

// --- CORE LOGIC ---

function markAsDirty() {
    if (isViewerMode || !isDataLoaded) return;
    isDirty = true;
    requestSave();
}

function requestSave() {
    clearTimeout(saveTimeout);
    const now = Date.now();
    // Save immediately if it's been a while, otherwise debounce
    if (now - lastSaveTime > 10000) { 
        saveCurrentMuseum();
    } else {
        saveTimeout = setTimeout(saveCurrentMuseum, 3000);
    }
}

function saveCurrentMuseum(onComplete) {
    if (!isDirty || isViewerMode || !currentMuseumId) {
        if (onComplete) onComplete();
        return;
    }
    isDirty = false;
    lastSaveTime = Date.now();
    saveMuseumToDB(db, currentMuseumId, isViewerMode, onComplete);
}


// --- AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        if (!isViewerMode) {
            const museumsRef = ref(db, `users/${currentUser.uid}/museums`);
            renderDashboard(museumsRef, startEditor, confirmMuseumDelete);
            showView('dashboard');
        }
    } else {
        if (isViewerMode) {
            signInAnonymously(auth).catch(error => console.error("Anonymous sign-in failed:", error));
        } else {
            showView('auth');
            const renderer = document.querySelector('#app-container canvas');
            if(renderer) renderer.remove();
        }
    }
});

function confirmMuseumDelete(id, name) {
    museumToDelete = { id, name };
    const modal = document.getElementById('delete-confirm-modal');
    document.getElementById('deleting-museum-name').textContent = name;
    modal.dataset.museumId = id; // Store for the handler
    showModal('delete-confirm-modal');
}

// --- APPLICATION FLOW ---

function checkViewerMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const viewId = urlParams.get('view');
    if (viewId) {
        isViewerMode = true;
        startViewer(viewId);
    }
}

function startEditor(museumId, museumName) {
    currentMuseumId = museumId;
    currentMuseumName = museumName;
    isViewerMode = false;
    document.getElementById('museum-name-display').textContent = museumName;
    document.getElementById('editor-top-bar').classList.remove('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    museumDataListenerUnsubscribe = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

function startViewer(museumId) {
    currentMuseumId = museumId;
    isViewerMode = true;
    document.getElementById('editor-top-bar').classList.add('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    museumDataListenerUnsubscribe = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

function goBackToDashboard() {
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    currentMuseumId = null;
    isDataLoaded = false;
    clearScene();
    showView('dashboard');
}

// --- UI CALLBACKS ---
const uiCallbacks = {
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    createMuseum: async (museumName) => {
        if (!currentUser) return;
        const newMuseumRef = push(ref(db, `museums`));
        const museumId = newMuseumRef.key;
        const initialRoom = {
            id: 'initial',
            position: { x: 0, y: 0, z: 0 },
            openings: [],
            width: 20,
            depth: 20,
            height: 10,
            artworks: []
        };
        await set(newMuseumRef, {
            owner: currentUser.uid,
            name: museumName,
            createdAt: serverTimestamp(),
            isPublic: false,
            data: { rooms: [initialRoom], settings: { floorTexture: 'marble', wallTexture: 'wood', ceilingTexture: 'marble', music: 'none' } }
        });
        await set(ref(db, `users/${currentUser.uid}/museums/${museumId}`), { name: museumName });
        startEditor(museumId, museumName);
    },
    deleteMuseum: async (museumId) => {
        if (!museumId || !currentUser) return;
        await remove(ref(db, `museums/${museumId}`));
        await remove(ref(db, `users/${currentUser.uid}/museums/${museumId}`));
    },
    goBack: goBackToDashboard,
    publishMuseum: async () => {
        return new Promise((resolve) => {
            saveCurrentMuseum(() => {
                if (!currentMuseumId) return resolve(null);
                set(ref(db, `museums/${currentMuseumId}/isPublic`), true);
                const url = `${window.location.origin}${window.location.pathname}?view=${currentMuseumId}`;
                resolve(url);
            });
        });
    },
    addDrawing: () => {
        setPlacingDrawingCanvas(true);
        switchToPreviewMode();
    },
    switchToPreview: () => switchToPreviewMode(),
    markAsDirty: markAsDirty,
};

// --- INITIALIZATION ---
initUI(uiCallbacks);
checkViewerMode();

