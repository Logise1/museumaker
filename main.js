import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { initUI, showView, renderDashboard, showModal, showMessage } from './ui-handler.js';
import { init3D, listenToMuseumData, saveMuseumToDB, clearScene, getRenderer, isDataLoaded, setPlacingDrawingCanvas, switchToPreviewMode } from './three-scene.js';

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
let currentUser = null, currentMuseumId = null;
let isViewerMode = false;
let museumDataListener = null;

// --- AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        if (!isViewerMode) {
            const museumsRef = ref(db, `users/${user.uid}/museums`);
            renderDashboard(museumsRef, startEditor, (id, name) => {
                const modal = document.getElementById('delete-confirm-modal');
                modal.dataset.museumId = id;
                modal.dataset.museumName = name;
                document.getElementById('deleting-museum-name').textContent = name;
                showModal('delete-confirm-modal');
            });
            showView('dashboard');
        }
    } else {
        if (isViewerMode) {
            signInAnonymously(auth).catch(error => console.error("Anonymous sign-in failed:", error));
        } else {
            showView('auth');
            const renderer = getRenderer();
            if (renderer) {
                renderer.dispose();
                const canvas = document.querySelector('#app-container canvas');
                if(canvas) canvas.remove();
            }
        }
    }
});

// --- APPLICATION START & VIEW CONTROL ---
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
    isViewerMode = false;
    document.getElementById('museum-name-display').textContent = museumName;
    document.getElementById('editor-top-bar').classList.remove('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    museumDataListener = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

function startViewer(museumId) {
    currentMuseumId = museumId;
    isViewerMode = true;
    document.getElementById('editor-top-bar').classList.add('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    museumDataListener = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

function goBackToDashboard() {
    if (museumDataListener) {
        museumDataListener(); // This is the unsubscribe function returned by onValue
        museumDataListener = null;
    }
    currentMuseumId = null;
    clearScene();
    showView('dashboard');
}

// --- Museum Data Handling ---
async function createNewMuseum(museumName) {
    if (!museumName || !currentUser) return;

    const newMuseumRef = push(ref(db, `museums`));
    const museumId = newMuseumRef.key;

    const initialRoom = {
        position: { x: 0, y: 0, z: 0 },
        openings: [], width: 20, depth: 20, height: 10, artworks: []
    };
    const initialData = {
        owner: currentUser.uid,
        name: museumName,
        createdAt: serverTimestamp(),
        isPublic: false,
        data: { rooms: [initialRoom], settings: { floorTexture: 'marble', wallTexture: 'wood', ceilingTexture: 'marble', music: 'none' } }
    };
    await set(newMuseumRef, initialData);
    await set(ref(db, `users/${currentUser.uid}/museums/${museumId}`), { name: museumName });

    startEditor(museumId, museumName);
}

async function deleteMuseum(museumId) {
    if (!museumId || !currentUser) return;
    await remove(ref(db, `museums/${museumId}`));
    await remove(ref(db, `users/${currentUser.uid}/museums/${museumId}`));
}

async function publishMuseum() {
    // Await the save operation before publishing
    await new Promise(resolve => saveMuseumToDB(db, currentMuseumId, isViewerMode, resolve));
    
    if (!currentMuseumId) return;
    await set(ref(db, `museums/${currentMuseumId}/isPublic`), true);
    const url = `${window.location.origin}${window.location.pathname}?view=${currentMuseumId}`;
    return url;
}


// --- Saving ---
let saveTimeout;
let lastSaveTime = 0;
let isDirty = false;

function markAsDirty() {
    if (isViewerMode || !isDataLoaded()) return;
    if (isDirty) return; // Don't queue multiple saves
    isDirty = true;
    requestSave();
}

function requestSave() {
    clearTimeout(saveTimeout);
    const now = Date.now();
    // Save immediately if it's been a while, otherwise debounce
    if (now - lastSaveTime > 5000) {
        saveAndReset();
    } else {
        saveTimeout = setTimeout(saveAndReset, 2000);
    }
}

function saveAndReset() {
    if (!isDirty) return;
    saveMuseumToDB(db, currentMuseumId, isViewerMode, () => {
        isDirty = false;
        lastSaveTime = Date.now();
        console.log("Save complete.");
    });
}

// Initialize UI with callbacks
initUI({
    // Auth
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    // Museum
    createMuseum: createNewMuseum,
    deleteMuseum: deleteMuseum,
    publishMuseum: publishMuseum,
    goBack: goBackToDashboard,
    // Editor Actions
    addDrawing: () => {
        setPlacingDrawingCanvas(true);
        showMessage("Entra en 'Visitar Museo' y haz clic en una pared para colocar la pizarra.");
        switchToPreviewMode();
    },
    switchToPreview: () => switchToPreviewMode()
});

checkViewerMode();

