// --- IMPORTACIONES ---
// Se importa la librería Three.js y sus componentes adicionales para controles, VR, y texto 3D.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
// Funciones de Firebase para interactuar con la base de datos.
import { ref, set, onValue, push, get, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
// Funciones del manejador de UI para actualizar la interfaz desde la lógica 3D.
import { showModal, updateInfoPanel, deselectObject as deselectObjectUI, showMessage, openQuizEditor, hideFocusView, showFocusView, updateSettingsUI, startQuiz, updateSaveButtonState } from './ui-handler.js';

// --- ESTADO DEL MÓDULO ---
// Variables principales de la escena 3D.
let scene, camera, renderer, orbitControls, pointerLockControls;
let isEditMode = true, isViewerMode = false;
// Referencias a funciones y variables del módulo principal (main.js).
let markAsDirty, db, getCurrentMuseumId, getCurrentUser;

// Recursos y assets 3D.
let addButtonTexture, deleteButtonTexture, quizButtonTexture;
let font;
let roomControlsGroup; // Grupo que contiene los botones de control de las salas.
let activePaintingIntersect = null; // Almacena la intersección donde se colocará un nuevo cuadro.
let viewerOverlay;
let lastPlayerPosition = new THREE.Vector3(0, 5, 0), lastPlayerQuaternion = new THREE.Quaternion(); // Guarda la posición del jugador al cambiar de modo.
const dragPlane = new THREE.Plane(), dragIntersection = new THREE.Vector3(); // Para arrastrar objetos.
const raycaster = new THREE.Raycaster(), keysPressed = {};
const playerHeight = 5;
const clock = new THREE.Clock(); // Para manejar el tiempo en la animación.
let playerVelocity = new THREE.Vector3();
const gravity = 30.0;

let selectedObject = null, selectionBox = null; // Para el objeto seleccionado y su contorno.

// Estado del modo de dibujo.
let isPlacingDrawingCanvas = false;
let isDrawing = false, activeDrawingCanvas = null, currentDrawingPath = [];
export let currentDrawingColor = '#000000';
export const drawingCanvases = {}; // Almacena datos de los lienzos de dibujo.

// URLs y caché de texturas.
export const textureUrls = {
    marble: 'https://museumaker.netlify.app/assets/marble.jpg',
    wood: 'https://museumaker.netlify.app/assets/wood.jpg',
    darkwood: 'https://museumaker.netlify.app/assets/darkwood.jpg',
    blue: 'https://museumaker.netlify.app/assets/blue.png',
    darkred: 'https://museumaker.netlify.app/assets/darkred.png'
};
export const textureNames = { marble: 'Mármol', wood: 'Madera', darkwood: 'Madera Oscura', blue: 'Azul', darkred: 'Rojo Oscuro' };
export const textureCache = {};
export let currentMusic = 'none';

let _isDataLoaded = false;
// Arrays para gestionar los objetos de la escena.
export const objects = [], collidables = [], roomGroups = [];

// --- GETTERS Y SETTERS ---
// Funciones para que otros módulos puedan acceder al estado de este de forma controlada.
export function getRenderer() { return renderer; }
export function isDataLoaded() { return _isDataLoaded; }
export function setPlacingDrawingCanvas(value) { isPlacingDrawingCanvas = value; }
export function getSelectedObject() { return selectedObject; }
export function getDb() { return db; }
export function getMuseumId() { return getCurrentMuseumId(); }
export function setCurrentMusic(music) { currentMusic = music; markAsDirty(); }
export function setCurrentDrawingColor(color) { currentDrawingColor = color; }

// --- INICIALIZACIÓN ---
/**
 * Inicializa la escena 3D, cámara, renderer, y controles. Se llama al entrar al editor/visor.
 */
export function init3D(viewerMode, dirtyCallback, database, museumIdGetter, userGetter) {
    isViewerMode = viewerMode;
    markAsDirty = dirtyCallback;
    db = database;
    getCurrentMuseumId = museumIdGetter;
    getCurrentUser = userGetter;

    // Limpia la escena anterior si existe.
    if (renderer) {
        orbitControls?.dispose();
        pointerLockControls?.dispose();
        renderer.dispose();
        const canvas = document.querySelector('#app-container canvas');
        if (canvas) canvas.remove();
        document.getElementById('vr-button-container').innerHTML = '';
    }
    viewerOverlay = document.getElementById('viewer-overlay');

    // Configuración básica de la escena.
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 0, 250);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio * 0.75);
    renderer.shadowMap.enabled = true;
    renderer.xr.enabled = true;
    document.getElementById('app-container').insertBefore(renderer.domElement, viewerOverlay);
    const vrButton = VRButton.createButton(renderer);
    document.getElementById('vr-button-container').appendChild(vrButton);

    // Añade luces y un suelo base.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5.1;
    ground.receiveShadow = true;
    scene.add(ground);
    roomControlsGroup = new THREE.Group();
    scene.add(roomControlsGroup);

    // Configura los controles de cámara.
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    pointerLockControls = new PointerLockControls(camera, renderer.domElement);

    // Caja de selección para objetos.
    selectionBox = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 0xffff00);
    selectionBox.visible = false;
    scene.add(selectionBox);

    scene.add(pointerLockControls.getObject());
    setup3DEventListeners();
    loadAssets();

    // Inicia el bucle de animación.
    renderer.setAnimationLoop(animate);
}

// --- MANEJO DE DATOS ---

/**
 * Escucha los cambios en los datos del museo en Firebase y actualiza la escena.
 */
export function listenToMuseumData(db, museumId, isViewerMode, currentUser, goBackToDashboard) {
    Object.values(drawingCanvases).forEach(({ listener }) => listener && listener());

    if (!museumId) return null;
    const museumRef = ref(db, `museums/${museumId}`);
    
    const unsubscribe = onValue(museumRef, async (snapshot) => {
        if (!snapshot.exists()) {
            showMessage("Error: No se encontró el museo.", 'error');
            goBackToDashboard();
            return;
        }

        const selectedObjectId = selectedObject ? selectedObject.uuid : null;
        const museum = snapshot.val();
        if (isViewerMode && !museum.isPublic && museum.owner !== currentUser?.uid) {
            showMessage("Error: Este museo no es público.", 'error');
            return;
        }
        document.getElementById('museum-name-display').textContent = museum.name;

        await loadMuseumState(museum.data);
        _isDataLoaded = true;

        if (selectedObjectId && !isViewerMode) {
            const reSelectedObject = scene.getObjectByProperty('uuid', selectedObjectId);
            if (reSelectedObject) {
                selectObject(reSelectedObject);
            }
        }
    });

    return unsubscribe;
}

/**
 * Recopila el estado actual de la escena y lo guarda en Firebase.
 */
export function saveMuseumToDB(db, museumId, isViewerMode, onComplete) {
    if (isViewerMode || !museumId) {
        if (onComplete) onComplete();
        return;
    }

    const state = { rooms: [], settings: { music: currentMusic } };

    // Recopila datos de las salas.
    roomGroups.forEach(room => {
        const roomData = {
            id: room.userData.id,
            position: { x: room.position.x, y: room.position.y, z: room.position.z },
            openings: room.userData.openings || [],
            width: room.userData.width,
            depth: room.userData.depth,
            height: room.userData.height,
            textures: room.userData.textures,
            quiz: room.userData.quiz || null,
            artworks: []
        };
        state.rooms.push(roomData);
    });

    // Recopila datos de los cuadros y pizarras.
    objects.forEach(o => {
        if (o.userData.isPainting || o.userData.isDrawingCanvas) {
            const artData = {
                uuid: o.uuid,
                type: o.userData.isDrawingCanvas ? 'drawing' : 'painting',
                canvasId: o.userData.canvasId || null,
                position: { x: o.position.x, y: o.position.y, z: o.position.z },
                quaternion: { x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w },
                scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
                imageId: o.userData.imageId || null,
                infoText: o.userData.infoText || "",
            };
            const assignedRoom = roomGroups.find(r => new THREE.Box3().setFromObject(r).containsPoint(o.position));
            if (assignedRoom) {
                const roomData = state.rooms.find(rd => rd.id === assignedRoom.userData.id);
                if (roomData) roomData.artworks.push(artData);
            }
        }
    });

    set(ref(db, `museums/${museumId}/data`), state)
        .then(() => {
            if (onComplete) onComplete();
        })
        .catch(err => console.error("Error al guardar:", err));
}

/**
 * Carga el estado de un museo desde un objeto de datos y reconstruye la escena.
 */
async function loadMuseumState(state) {
    if (!state) return;
    currentMusic = state.settings?.music || 'none';

    // Configura la música de fondo.
    const backgroundAudio = document.getElementById('background-audio');
    const musicPlayer = document.getElementById('music-player');
    if (isViewerMode) {
        if (currentMusic && currentMusic !== 'none') {
            backgroundAudio.src = `assets/music/${currentMusic}`;
            backgroundAudio.load();
            musicPlayer.classList.remove('hidden');
        } else {
            musicPlayer.classList.add('hidden');
        }
    } else {
        updateSettingsUI(currentMusic);
    }

    clearScene();

    // Reconstruye las salas y obras de arte.
    const promises = [];
    if (state.rooms) {
        for (const roomData of state.rooms) {
            addRoom(roomData.width, roomData.depth, roomData.height, new THREE.Vector3().copy(roomData.position), roomData.openings, roomData.quiz, roomData.textures, true, roomData.id);
            if (roomData.artworks) {
                for (const artworkData of roomData.artworks) {
                    if (artworkData.type === 'drawing') {
                        promises.push(placeDrawingCanvas(null, artworkData));
                    } else {
                        promises.push(
                            getImageDataUrl(artworkData.imageId).then(imageUrl => {
                                if (imageUrl) return placePainting(imageUrl, null, artworkData);
                            })
                        );
                    }
                }
            }
        }
    }
    await Promise.all(promises.filter(p => p));

    if (isViewerMode) {
        switchToPreviewMode(true);
    } else {
        switchToEditMode();
    }
    updateSaveButtonState('default'); // Resetea el botón de guardar.
}

/**
 * Obtiene la URL de una imagen (en base64) desde Firebase.
 */
async function getImageDataUrl(imageId) {
    if (!imageId) return null;
    try {
        const imageRef = ref(db, `images/${imageId}`);
        const snapshot = await get(imageRef);
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) { console.error("Error fetching image data:", error); return null; }
}

// --- GESTIÓN DE LA ESCENA ---
/**
 * Limpia completamente la escena 3D, eliminando todos los objetos.
 */
export function clearScene() {
    _isDataLoaded = false;
    Object.values(drawingCanvases).forEach(({ listener }) => listener && listener());
    for (const key in drawingCanvases) { delete drawingCanvases[key]; }

    while (objects.length > 0) {
        const obj = objects.pop();
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material && obj.material.dispose) obj.material.dispose();
        obj.removeFromParent();
    }
    while (roomGroups.length > 0) {
        const room = roomGroups.pop();
        room.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material && child.material.dispose) child.material.dispose();
        });
        room.removeFromParent();
    }
    collidables.length = 0;
    if (roomControlsGroup) roomControlsGroup.clear();
    deselectObject();
}

// --- RENDERIZADO Y ANIMACIÓN ---
/**
 * Bucle de animación principal que se ejecuta en cada frame.
 */
function animate() {
    let dT = clock.getDelta();
    if (dT > 0.1) dT = 0.1; // Limita el delta de tiempo para evitar saltos.
    
    scene.traverse(o => { if (o.userData.isQuizTrigger) o.rotation.y += 0.5 * dT; })

    if (isEditMode) {
        orbitControls.update();
    } else {
        handleMovement(dT);
        // Lógica de gravedad para el jugador.
        const p = pointerLockControls.getObject();
        const onGroundRaycaster = new THREE.Raycaster(p.position, new THREE.Vector3(0, -1, 0));
        const floorCollidables = collidables.filter(c => c.userData.isFloor);
        const floorIntersects = onGroundRaycaster.intersectObjects(floorCollidables, true);
        const onGround = floorIntersects.length > 0 && floorIntersects[0].distance < (playerHeight + 0.1);

        if (onGround) {
            playerVelocity.y = 0;
            p.position.y = floorIntersects[0].point.y + playerHeight;
        } else {
            playerVelocity.y -= gravity * dT;
        }
        p.position.y += playerVelocity.y * dT;

        // Respawn si el jugador cae.
        if (p.position.y < -50) {
            const spawnPos = new THREE.Vector3(0, playerHeight, 5);
            if (roomGroups.length > 0) {
                const spawnRoom = roomGroups[0];
                spawnPos.copy(spawnRoom.position);
                spawnPos.y = spawnRoom.position.y - (spawnRoom.userData.height / 2) + playerHeight;
            }
            p.position.copy(spawnPos);
            playerVelocity.set(0, 0, 0);
        }
    }
    renderer.render(scene, camera);
}

// --- EVENTOS Y CONTROLES ---

/**
 * Maneja el movimiento del jugador basado en las teclas presionadas.
 */
function handleMovement(dT) {
    if (!pointerLockControls.isLocked && !renderer.xr.isPresenting) return;
    const p = pointerLockControls.getObject();

    const moveSpeed = 10.0;
    const mF = (Number(keysPressed['KeyW'] || false) - Number(keysPressed['KeyS'] || false));
    const mR = (Number(keysPressed['KeyD'] || false) - Number(keysPressed['KeyA'] || false));

    if (mF === 0 && mR === 0) return;

    const oP = p.position.clone();

    if (mF !== 0) p.translateZ(-mF * moveSpeed * dT);
    if (mR !== 0) p.translateX(mR * moveSpeed * dT);

    p.position.y = oP.y; // Evita que el jugador vuele.

    // Detección de colisiones simple.
    const finalPos = p.position.clone();
    const moveDist = oP.distanceTo(finalPos);
    if (moveDist > 0) {
        const moveDir = finalPos.clone().sub(oP).normalize();
        raycaster.set(oP, moveDir);
        const wallIntersects = raycaster.intersectObjects(collidables, true);
        if (wallIntersects.length > 0 && wallIntersects[0].distance < moveDist + 0.5) {
            p.position.copy(oP); // Si hay colisión, revierte el movimiento.
        }
    }
}

/**
 * Configura los event listeners relacionados con la escena 3D.
 */
function setup3DEventListeners() {
    viewerOverlay.addEventListener('click', () => {
        pointerLockControls.lock();
        if (isViewerMode && currentMusic && currentMusic !== 'none') {
            document.getElementById('background-audio').play().catch(e => console.log('Playback requires user interaction.'));
        }
    });
    pointerLockControls.addEventListener('lock', () => { document.body.classList.remove('is-interacting'); viewerOverlay.style.display = 'none'; document.getElementById('instructions').classList.remove('hidden'); });
    pointerLockControls.addEventListener('unlock', () => {
        if (document.body.classList.contains('is-interacting')) return;
        viewerOverlay.style.display = 'flex';
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('drawing-controls').classList.add('hidden');
        if (isDrawing) { isDrawing = false; activeDrawingCanvas = null; }
    });

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', (e) => {
        keysPressed[e.code] = true;
        if (e.code === 'Escape' && pointerLockControls.isLocked) {
             document.body.classList.add('is-interacting');
             pointerLockControls.unlock();
             if(!isViewerMode) switchToEditMode();
        }
        if (e.code === 'Space' || e.code === 'Escape') hideFocusView();
    });
    document.addEventListener('keyup', (e) => { keysPressed[e.code] = false; });
    renderer.domElement.addEventListener('mousedown', onCanvasMouseDown);
    renderer.domElement.addEventListener('mousemove', onCanvasMouseMove);
    renderer.domElement.addEventListener('mouseup', onCanvasMouseUp);
}

/**
 * Ajusta el tamaño del renderer y la cámara cuando la ventana cambia de tamaño.
 */
function onWindowResize() {
    if (camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

/**
 * Carga texturas, fuentes y otros assets necesarios para la escena.
 */
function loadAssets() {
    const textureLoader = new THREE.TextureLoader();
    for (const key in textureUrls) {
        textureCache[key] = textureLoader.load(textureUrls[key], (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    }
    const fontLoader = new FontLoader();
    fontLoader.load('https://cdn.jsdelivr.net/npm/three@0.163.0/examples/fonts/helvetiker_regular.typeface.json', (loadedFont) => font = loadedFont);
    
    const generateButtonTexture = (text, color) => { 
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; 
        const context = canvas.getContext('2d'); 
        context.fillStyle = color; context.fillRect(0, 0, 128, 128); 
        context.fillStyle = 'white'; context.font = 'bold 96px sans-serif'; 
        context.textAlign = 'center'; context.textBaseline = 'middle'; 
        context.fillText(text, 64, 64); return new THREE.CanvasTexture(canvas); 
    };
    addButtonTexture = generateButtonTexture('+', 'rgba(34, 197, 94, 0.8)');
    deleteButtonTexture = generateButtonTexture('X', 'rgba(239, 68, 68, 0.8)');
    quizButtonTexture = generateButtonTexture('?', 'rgba(59, 130, 246, 0.8)');
}

// --- CAMBIO DE MODO (EDICIÓN/VISTA PREVIA) ---

/**
 * Cambia la aplicación al modo de edición (vista cenital).
 */
function switchToEditMode() {
    isEditMode = true;
    document.body.classList.remove('is-interacting');
    roomControlsGroup.visible = true;
    orbitControls.enabled = true;
    scene.traverse(c => {
        if (c.userData.isCeiling) c.visible = false;
        if (c.userData.isQuizTrigger) c.visible = false;
    });
    if (pointerLockControls.getObject().position.y > -50) {
        lastPlayerPosition.copy(pointerLockControls.getObject().position);
        lastPlayerQuaternion.copy(camera.quaternion);
    }
    camera.position.set(0, 80, 20);
    orbitControls.target.set(0, 0, 0);

    document.getElementById('info-panel').classList.remove('hidden');
    if (viewerOverlay) viewerOverlay.style.display = 'none';
}

/**
 * Cambia la aplicación al modo de vista previa (primera persona).
 */
export function switchToPreviewMode(force = false) {
    if (!isEditMode && !force) return;
    isEditMode = false;
    roomControlsGroup.visible = false;
    deselectObject();
    const player = pointerLockControls.getObject();
    if (!force) {
        if (roomGroups.length > 0) {
            const spawnRoom = roomGroups[0];
            lastPlayerPosition.copy(spawnRoom.position);
            lastPlayerPosition.y = spawnRoom.position.y - (spawnRoom.userData.height / 2) + playerHeight;
        } else {
            lastPlayerPosition.set(0, playerHeight, 5);
        }
        playerVelocity.set(0, 0, 0);
    }
    player.position.copy(lastPlayerPosition);
    camera.position.set(0,0,0);
    camera.quaternion.copy(lastPlayerQuaternion);
    scene.traverse(c => {
        if (c.userData.isCeiling || c.userData.isQuizTrigger) c.visible = true;
    });
    orbitControls.enabled = false;
    document.getElementById('info-panel').classList.add('hidden');
    if (viewerOverlay) viewerOverlay.style.display = 'flex';
}

// --- CREACIÓN Y MANIPULACIÓN DE OBJETOS ---

/**
 * Maneja el evento de clic del ratón en el canvas 3D.
 */
function onCanvasMouseDown(event) {
    if (document.body.classList.contains('is-interacting')) return;
    const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);

    if (isEditMode) {
        // Lógica para los controles de sala (añadir, borrar, quiz).
        const controlIntersects = raycaster.intersectObjects(roomControlsGroup.children, true);
        if (controlIntersects.length > 0) {
             const { room, side, action } = controlIntersects[0].object.userData;
             if (action === 'add_initial') { addRoom(20, 20, 10, new THREE.Vector3(0, 0, 0)); return; }
             if (action === 'quiz') { openQuizEditor(room); return; }
             if (action === 'add') {
                const newSize = 20, newHeight = room.userData.height;
                let newPos = room.position.clone(); let opSide;
                if (side === 'north') { newPos.z -= (room.userData.depth / 2) + (newSize / 2); opSide = 'south'; } 
                if (side === 'south') { newPos.z += (room.userData.depth / 2) + (newSize / 2); opSide = 'north'; }
                if (side === 'east') { newPos.x += (room.userData.width / 2) + (newSize / 2); opSide = 'west'; } 
                if (side === 'west') { newPos.x -= (room.userData.width / 2) + (newSize / 2); opSide = 'east'; }
                room.userData.openings.push(side);
                updateRoomDimensions(room, room.userData.width, room.userData.depth, room.userData.height, false);
                addRoom(newSize, newSize, newHeight, newPos, [opSide]);
             } else if (action === 'delete') {
                deleteRoom(room);
             }
             return;
        }

        // Lógica para seleccionar y arrastrar cuadros.
        const artworks = objects.filter(o => o.userData.isPainting || o.userData.isDrawingCanvas);
        const artIntersects = raycaster.intersectObjects(artworks, true);
        if (artIntersects.length > 0) {
            const artObject = artIntersects[0].object.parent?.userData.isPainting || artIntersects[0].object.parent?.userData.isDrawingCanvas ? artIntersects[0].object.parent : artIntersects[0].object;
            selectObject(artObject);
            orbitControls.enabled = false;
            const wallNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(artObject.quaternion);
            dragPlane.setFromNormalAndCoplanarPoint(wallNormal, artIntersects[0].point);
            return;
        }
        
        // Lógica para seleccionar salas.
        const roomIntersects = raycaster.intersectObjects(roomGroups, true);
        if (roomIntersects.length > 0) {
            const intersectedRoom = roomIntersects.find(i => i.object.userData.isFloor)?.object.userData.room;
            if (intersectedRoom) {
                selectObject(intersectedRoom);
                return;
            }
        }

        deselectObject();

    } else if (pointerLockControls.isLocked) {
        // Lógica de interacción en modo primera persona.
        raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (intersects.length === 0) return;
        
        // Interactuar con un quiz.
        const quizIntersect = intersects.find(i => i.object.userData.isQuizTrigger);
        if (quizIntersect) {
            const room = quizIntersect.object.parent;
            if (room && room.userData.quiz) startQuiz(room, getCurrentUser());
            return;
        }

        // Hacer foco en un cuadro.
        const paintingIntersect = intersects.find(i => (i.object.parent && i.object.parent.userData.isPainting));
        if (paintingIntersect) {
             showFocusView(paintingIntersect.object.parent, getImageDataUrl); return;
        }

        // Empezar a dibujar.
        const drawingCanvasIntersect = intersects.find(i => i.object.userData.isDrawingCanvas);
        if (drawingCanvasIntersect) {
            isDrawing = true;
            activeDrawingCanvas = drawingCanvasIntersect.object;
            currentDrawingPath = [];
            document.getElementById('drawing-controls').classList.remove('hidden');
            const uv = drawingCanvasIntersect.uv;
            currentDrawingPath.push(uv.x, uv.y);
            
            const { canvas, context } = drawingCanvases[activeDrawingCanvas.userData.canvasId];
            const x = uv.x * canvas.width;
            const y = (1 - uv.y) * canvas.height;
            context.beginPath();
            context.moveTo(x, y);
            context.strokeStyle = currentDrawingColor;
            context.lineWidth = 5;
            context.lineCap = 'round';
            return;
        }

        // Colocar un nuevo cuadro o pizarra.
        if (!isViewerMode) {
            const wallIntersect = intersects.find(i => i.object.userData.isWall);
            if (wallIntersect) {
                if (isPlacingDrawingCanvas) {
                    placeDrawingCanvas(wallIntersect);
                    isPlacingDrawingCanvas = false;
                } else {
                    document.body.classList.add('is-interacting');
                    pointerLockControls.unlock();
                    activePaintingIntersect = wallIntersect;
                    showModal('painting-modal');
                }
            }
        }
    }
}

/**
 * Maneja el movimiento del ratón para arrastrar objetos y dibujar.
 */
function onCanvasMouseMove(event) {
    // Arrastrar cuadro
    if (selectedObject && selectedObject.userData.isPainting && !orbitControls.enabled) {
        const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersection)) {
            selectedObject.position.copy(dragIntersection);
            selectionBox.update();
        }
        return;
    }

    // Dibujar en pizarra
    if (isDrawing && activeDrawingCanvas) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(activeDrawingCanvas);
        if (intersects.length > 0) {
            const uv = intersects[0].uv;
            currentDrawingPath.push(uv.x, uv.y);

            const { canvas, context, texture } = drawingCanvases[activeDrawingCanvas.userData.canvasId];
            const x = uv.x * canvas.width;
            const y = (1 - uv.y) * canvas.height;
            context.lineTo(x, y);
            context.stroke();
            texture.needs

