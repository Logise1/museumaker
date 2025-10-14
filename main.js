// --- IMPORTACIONES ---
// Se importan las funciones necesarias de Firebase para autenticación y base de datos en tiempo real.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
// Se importan funciones de los otros módulos de la aplicación.
import { initUI, showView, renderDashboard, showModal, updateSaveButtonState } from './ui-handler.js';
import { init3D, listenToMuseumData, saveMuseumToDB, switchToPreviewMode, setPlacingDrawingCanvas, clearScene, placePainting, createQuizTrigger, removeQuizTrigger } from './three-scene.js';

// --- CONFIGURACIÓN DE FIREBASE ---
// Objeto de configuración que conecta la aplicación con el proyecto de Firebase.
const firebaseConfig = {
    apiKey: "AIzaSyBLpiDOy69AWI7oHHbeXArkT1UXvIMGNZU",
    authDomain: "museumaker-79294.firebaseapp.com",
    databaseURL: "https://museumaker-79294-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "museumaker-79294",
    storageBucket: "museumaker-79294.appspot.com",
    messagingSenderId: "466260653400",
    appId: "1:466260653400:web:b03257442d6f6fa16da12d",
};

// Inicialización de la app de Firebase y obtención de los servicios de autenticación y base de datos.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
// Variables que mantienen el estado actual de la sesión y la aplicación.
let currentUser = null; // Almacena el objeto del usuario autenticado.
let currentMuseumId = null; // ID del museo que se está editando o viendo.
let isViewerMode = false; // Booleano que indica si la app está en modo "visitante".
let museumDataListenerUnsubscribe = null; // Función para detener la escucha de cambios en la base de datos.
let isDataLoaded = false; // Indica si los datos iniciales del museo se han cargado.
let isDirty = false; // Indica si hay cambios sin guardar en el museo.

// --- LÓGICA PRINCIPAL (GUARDADO) ---

/**
 * Marca el estado del museo como "sucio" (con cambios sin guardar)
 * y actualiza la UI del botón de guardar.
 */
function markAsDirty() {
    if (isViewerMode || !isDataLoaded) return;
    if (!isDirty) {
        isDirty = true;
        updateSaveButtonState('dirty'); // Pone el botón en estado "Guardar Cambios".
    }
}

/**
 * Guarda el estado actual del museo en Firebase.
 * Actualiza la UI del botón para reflejar el proceso de guardado.
 * @param {function} onComplete - Callback opcional que se ejecuta cuando el guardado finaliza.
 */
function saveCurrentMuseum(onComplete) {
    if (isViewerMode || !currentMuseumId) {
        if (onComplete) onComplete();
        return;
    }

    updateSaveButtonState('saving'); // Pone el botón en "Guardando...".

    // Llama a la función del módulo de la escena 3D para obtener los datos y guardarlos.
    saveMuseumToDB(db, currentMuseumId, isViewerMode, () => {
        isDirty = false;
        updateSaveButtonState('saved'); // Pone el botón en "Guardado".
        if (onComplete) onComplete();
    });
}

// --- GESTIÓN DE AUTENTICACIÓN ---

// Observador que se activa cada vez que cambia el estado de autenticación del usuario.
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        // Si el usuario está logueado y no es un visitante...
        if (!isViewerMode) {
            // Muestra el panel de control con sus museos.
            const museumsRef = ref(db, `users/${currentUser.uid}/museums`);
            renderDashboard(museumsRef, startEditor, confirmMuseumDelete);
            showView('dashboard');
        }
    } else {
        // Si el usuario no está logueado...
        if (isViewerMode) {
            // Si es un visitante, inicia sesión de forma anónima para poder leer datos públicos.
            signInAnonymously(auth).catch(error => console.error("Anonymous sign-in failed:", error));
        } else {
            // Si no es visitante, muestra la pantalla de login.
            showView('auth');
            const renderer = document.querySelector('#app-container canvas');
            if(renderer) renderer.remove(); // Limpia la escena 3D si existía.
        }
    }
});

/**
 * Muestra el modal de confirmación antes de borrar un museo.
 * @param {string} id - ID del museo a borrar.
 * @param {string} name - Nombre del museo a borrar.
 */
function confirmMuseumDelete(id, name) {
    const modal = document.getElementById('delete-confirm-modal');
    document.getElementById('deleting-museum-name').textContent = name;
    modal.dataset.museumId = id; // Almacena el ID en el modal para usarlo en el callback.
    showModal('delete-confirm-modal');
}

// --- FLUJO DE LA APLICACIÓN ---

/**
 * Comprueba si la URL contiene un parámetro "view" para iniciar en modo visitante.
 */
function checkViewerMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const viewId = urlParams.get('view');
    if (viewId) {
        isViewerMode = true;
        startViewer(viewId);
    }
}

/**
 * Inicia la aplicación en modo editor para un museo específico.
 * @param {string} museumId - ID del museo.
 * @param {string} museumName - Nombre del museo.
 */
function startEditor(museumId, museumName) {
    currentMuseumId = museumId;
    isViewerMode = false;
    document.getElementById('museum-name-display').textContent = museumName;
    document.getElementById('editor-top-bar').classList.remove('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    museumDataListenerUnsubscribe = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

/**
 * Inicia la aplicación en modo visitante para un museo específico.
 * @param {string} museumId - ID del museo.
 */
function startViewer(museumId) {
    currentMuseumId = museumId;
    isViewerMode = true;
    document.getElementById('editor-top-bar').classList.add('hidden');
    showView('app');
    init3D(isViewerMode, markAsDirty, db, () => currentMuseumId, () => currentUser);
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    museumDataListenerUnsubscribe = listenToMuseumData(db, currentMuseumId, isViewerMode, currentUser, goBackToDashboard);
}

/**
 * Vuelve al panel de control desde el editor, limpiando el estado actual.
 */
function goBackToDashboard() {
    if (museumDataListenerUnsubscribe) museumDataListenerUnsubscribe();
    currentMuseumId = null;
    isDataLoaded = false;
    isDirty = false;
    clearScene();
    showView('dashboard');
}

// --- CALLBACKS PARA LA UI ---
// Objeto que agrupa todas las funciones que la UI puede necesitar invocar desde la lógica principal.
const uiCallbacks = {
    // Funciones de autenticación
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    // Funciones de gestión de museos
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
    // Funciones de navegación y acciones del editor
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
    saveChanges: saveCurrentMuseum,
    addDrawing: () => {
        setPlacingDrawingCanvas(true);
        switchToPreviewMode();
    },
    switchToPreview: () => switchToPreviewMode(),
    // Funciones que se pasan a otros módulos
    markAsDirty: markAsDirty,
    placePainting: (url, data) => placePainting(url, data),
    createQuizTriggerForRoom: (room) => {
        const trigger = createQuizTrigger();
        trigger.position.y = -room.userData.height / 2 + 2;
        room.add(trigger);
        room.userData.quizTrigger = trigger;
    },
    removeQuizTriggerFromRoom: (room) => removeQuizTrigger(room)
};

// --- INICIALIZACIÓN ---
// Inicia la interfaz de usuario, pasándole los callbacks que necesitará.
initUI(uiCallbacks);
// Comprueba si debe iniciar en modo visitante.
checkViewerMode();

