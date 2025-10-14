import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { ref, set, onValue, push, get, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { showModal, hideModal, updateInfoPanel, deselectObject as deselectObjectUI, showMessage, openQuizEditor, hideFocusView, showFocusView, updateSettingsUI, startQuiz } from './ui-handler.js';

// --- MODULE STATE ---
let scene, camera, renderer, orbitControls, pointerLockControls;
let isEditMode = true, isViewerMode = false;
let markAsDirty, db, getCurrentMuseumId, getCurrentUser;

let addButtonTexture, deleteButtonTexture, quizButtonTexture;
let font;
let roomControlsGroup;
let isInteractingWithUI = false, draggedObject = null;
let activePaintingIntersect = null;
let viewerOverlay;
let lastPlayerPosition = new THREE.Vector3(0, 5, 0), lastPlayerQuaternion = new THREE.Quaternion();
const dragPlane = new THREE.Plane(), dragIntersection = new THREE.Vector3();
const raycaster = new THREE.Raycaster(), keysPressed = {};
const playerHeight = 5;
const clock = new THREE.Clock();
let playerVelocity = new THREE.Vector3();
const gravity = 30.0;

let selectedObject = null, selectionBox = null;

// Drawing State
let isPlacingDrawingCanvas = false;
let isDrawing = false, activeDrawingCanvas = null, currentDrawingPath = [];
export let currentDrawingColor = '#000000';
export const drawingCanvases = {};

const textureUrls = {
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
export const objects = [], collidables = [], roomGroups = [];

// --- GETTERS and SETTERS for state needed by other modules ---
export function getRenderer() { return renderer; }
export function isDataLoaded() { return _isDataLoaded; }
export function setPlacingDrawingCanvas(value) { isPlacingDrawingCanvas = value; }
export function getSelectedObject() { return selectedObject; }
export function getDb() { return db; }
export function getMuseumId() { return getCurrentMuseumId(); }
export function setCurrentMusic(music) { currentMusic = music; markAsDirty(); }
export function setCurrentDrawingColor(color) { currentDrawingColor = color; }

// --- INITIALIZATION ---
export function init3D(viewerMode, dirtyCallback, database, museumIdGetter, userGetter) {
    isViewerMode = viewerMode;
    markAsDirty = dirtyCallback;
    db = database;
    getCurrentMuseumId = museumIdGetter;
    getCurrentUser = userGetter;

    if (renderer) {
        orbitControls?.dispose();
        pointerLockControls?.dispose();
        renderer.dispose();
        const canvas = document.querySelector('#app-container canvas');
        if (canvas) canvas.remove();
        document.getElementById('vr-button-container').innerHTML = '';
    }
    viewerOverlay = document.getElementById('viewer-overlay');

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

    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    pointerLockControls = new PointerLockControls(camera, renderer.domElement);

    selectionBox = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 0xffff00);
    selectionBox.visible = false;
    scene.add(selectionBox);

    scene.add(pointerLockControls.getObject());
    setup3DEventListeners();
    loadAssets();

    renderer.setAnimationLoop(animate);
}

// --- DATA HANDLING ---
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

export function saveMuseumToDB(db, museumId, isViewerMode, onComplete) {
    if (isViewerMode || !museumId) {
        if (onComplete) onComplete();
        return;
    }

    const state = { rooms: [], settings: { music: currentMusic } };

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

async function loadMuseumState(state) {
    if (!state) return;
    currentMusic = state.settings?.music || 'none';

    const backgroundAudio = document.getElementById('background-audio');
    const musicPlayer = document.getElementById('music-player');

    if (isViewerMode) {
        if (currentMusic && currentMusic !== 'none') {
            backgroundAudio.src = `assets/music/${currentMusic}`;
            backgroundAudio.load();
            musicPlayer.classList.remove('hidden');
            // updateMuteButtonUI(); in ui-handler will handle the icon
        } else {
            musicPlayer.classList.add('hidden');
        }
    } else {
        updateSettingsUI(currentMusic);
    }

    clearScene();

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

    if (isViewerMode) switchToPreviewMode(true);
    else switchToEditMode();
}

async function getImageDataUrl(imageId) {
    if (!imageId) return null;
    try {
        const imageRef = ref(db, `images/${imageId}`);
        const snapshot = await get(imageRef);
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) { console.error("Error fetching image data:", error); return null; }
}

// --- SCENE MANAGEMENT ---
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

// --- RENDER & ANIMATION ---
function animate() {
    let dT = clock.getDelta();
    if (dT > 0.1) dT = 0.1;
    scene.traverse(o => { if (o.userData.isQuizTrigger) o.rotation.y += 0.5 * dT; })
    if (isEditMode) {
        orbitControls.update();
    } else {
        handleMovement(dT);
        // Gravity and physics
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

        if (p.position.y < -50) { // Respawn if fallen
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

// --- EVENT LISTENERS & CONTROLS ---
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

    p.position.y = oP.y; // Prevent flying

    const finalPos = p.position.clone();
    const moveDist = oP.distanceTo(finalPos);

    if (moveDist > 0) {
        const moveDir = finalPos.clone().sub(oP).normalize();
        raycaster.set(oP, moveDir);
        const wallIntersects = raycaster.intersectObjects(collidables, true);
        if (wallIntersects.length > 0 && wallIntersects[0].distance < moveDist + 0.5) {
            p.position.copy(oP); // Collision detected, revert position
        }
    }
}

function setup3DEventListeners() {
    viewerOverlay.addEventListener('click', () => {
        pointerLockControls.lock();
        if (isViewerMode && currentMusic && currentMusic !== 'none') {
            document.getElementById('background-audio').play().catch(e => console.log('Playback requires user interaction.'));
        }
    });
    pointerLockControls.addEventListener('lock', () => { isInteractingWithUI = false; document.body.classList.remove('is-interacting'); viewerOverlay.style.display = 'none'; document.getElementById('instructions').classList.remove('hidden'); });
    pointerLockControls.addEventListener('unlock', () => {
        if (document.body.classList.contains('is-interacting')) return; // Don't show overlay if a modal is open
        viewerOverlay.style.display = 'flex';
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('drawing-controls').classList.add('hidden');
        if (isDrawing) { isDrawing = false; activeDrawingCanvas = null; }
    });

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', (e) => {
        keysPressed[e.code] = true;
        if (e.code === 'Escape' && pointerLockControls.isLocked) {
             isInteractingWithUI = true;
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

function onWindowResize() {
    if (camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

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

// --- MODE SWITCHING ---
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

export function switchToPreviewMode(force = false) {
    if (!isEditMode && !force) return;
    isEditMode = false;
    draggedObject = null;
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

// --- OBJECT MANIPULATION & CREATION ---
// ... (All functions related to creating, deleting, updating rooms, paintings, etc.)
// ... onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseUp
// ... selectObject, deselectObject
// ... updateRoomDimensions, createRoom, addRoom, deleteRoom
// ... placePainting, placeDrawingCanvas, redrawCanvas
// ... createQuizTrigger, updateRoomControls

function onCanvasMouseDown(event) {
    if (document.body.classList.contains('is-interacting')) return;
    const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);

    if (isEditMode) {
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

        const artworks = objects.filter(o => o.userData.isPainting || o.userData.isDrawingCanvas);
        const artIntersects = raycaster.intersectObjects(artworks, true);
        if (artIntersects.length > 0) {
            const artObject = artIntersects[0].object.parent?.userData.isPainting || artIntersects[0].object.parent?.userData.isDrawingCanvas ? artIntersects[0].object.parent : artIntersects[0].object;
            selectObject(artObject);
            draggedObject = artObject;
            orbitControls.enabled = false;
            const wallNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(draggedObject.quaternion);
            dragPlane.setFromNormalAndCoplanarPoint(wallNormal, artIntersects[0].point);
            return;
        }
        
        const roomIntersects = raycaster.intersectObjects(roomGroups.map(rg => rg.children.find(c => c.userData.isFloor)), true);
        if (roomIntersects.length > 0) {
            selectObject(roomIntersects[0].object.userData.room);
            return;
        }

        deselectObject();

    } else if (pointerLockControls.isLocked) {
        raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        const intersects = raycaster.intersectObjects(objects, true);
        if (intersects.length === 0) return;
        
        const quizIntersect = intersects.find(i => i.object.userData.isQuizTrigger);
        if (quizIntersect) {
            const room = quizIntersect.object.parent;
            if (room && room.userData.quiz) startQuiz(room, getCurrentUser());
            return;
        }

        const paintingIntersect = intersects.find(i => (i.object.parent && i.object.parent.userData.isPainting));
        if (paintingIntersect) {
             showFocusView(paintingIntersect.object.parent, getImageDataUrl); return;
        }

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

function onCanvasMouseMove(event) {
    if (draggedObject && isEditMode) {
        const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersection)) {
            draggedObject.position.copy(dragIntersection);
            selectionBox.update();
        }
        return;
    }

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
            texture.needsUpdate = true;
        }
    }
}

function onCanvasMouseUp() {
    if (draggedObject) {
        draggedObject = null; orbitControls.enabled = true; markAsDirty();
    }
    if (isDrawing) {
        isDrawing = false;
        document.getElementById('drawing-controls').classList.add('hidden');
        const pathRef = push(ref(db, `museums/${getCurrentMuseumId()}/drawings/${activeDrawingCanvas.userData.canvasId}`));
        set(pathRef, { color: currentDrawingColor, points: currentDrawingPath });
        activeDrawingCanvas = null;
    }
}

function selectObject(object) {
    if (selectedObject === object) return;
    selectedObject = object;
    selectionBox.setFromObject(selectedObject, true);
    selectionBox.visible = true;
    updateInfoPanel(selectedObject);
}

function deselectObject() {
    if (selectedObject) {
        selectedObject = null;
        selectionBox.visible = false;
        deselectObjectUI();
    }
}

export function updateRoomDimensions(room, width, depth, height, shouldSelect = true) {
    const oldWidth = room.userData.width;
    const oldDepth = room.userData.depth;

    const oldBBox = new THREE.Box3().setFromObject(room);
    const artworksInRoom = objects.filter(o => (o.userData.isPainting || o.userData.isDrawingCanvas) && oldBBox.containsPoint(o.position));
    const artworkData = artworksInRoom.map(art => ({
        artwork: art,
        localPos: art.position.clone().sub(room.position)
    }));
    
    const oldCollidables = [];
    room.traverse(child => { if (child.userData.isWallContainer || child.userData.isWall || child.userData.isFloor) oldCollidables.push(child); });
    oldCollidables.forEach(c => { const index = collidables.indexOf(c); if(index > -1) collidables.splice(index,1); });
    if(room.userData.quizTrigger) { const index = objects.indexOf(room.userData.quizTrigger); if(index > -1) objects.splice(index,1); }


    const oldRoomIndex = roomGroups.indexOf(room); if (oldRoomIndex === -1) return;
    const newRoom = createRoom(width, depth, height, room.position, room.userData.openings, room.userData.quiz, room.userData.textures, room.userData.id);
    
    room.clear(); room.removeFromParent();
    roomGroups[oldRoomIndex] = newRoom;
    scene.add(newRoom);
    
    newRoom.traverse(child => { 
        if (child.userData.isWallContainer || child.userData.isWall || child.userData.isFloor) collidables.push(child);
        if (child.userData.isQuizTrigger) objects.push(child);
    });

    artworkData.forEach(data => {
        const scaledLocalPos = data.localPos.clone();
        scaledLocalPos.x *= width / oldWidth;
        scaledLocalPos.z *= depth / oldDepth;
        data.artwork.position.copy(newRoom.position).add(scaledLocalPos);
    });

    if (shouldSelect) selectObject(newRoom);
    markAsDirty();
    updateRoomControls();
}

function createRoom(w, d, h, pos, openings = [], quizData, textures, id) {
    const t = 0.5; const rG = new THREE.Group(); rG.position.copy(pos);
    rG.userData = { id: id || THREE.MathUtils.generateUUID(), isRoom: true, walls: {}, openings, width: w, depth: d, height: h, quiz: quizData || null, textures: textures || { floor: 'marble', wall: 'wood', ceiling: 'marble' } };
    const fM = new THREE.MeshStandardMaterial({ map: textureCache[rG.userData.textures.floor], side: THREE.DoubleSide }); const fG = new THREE.PlaneGeometry(w, d); const f = new THREE.Mesh(fG, fM); f.rotation.x = -Math.PI / 2; f.position.y = -h / 2; f.receiveShadow = true; f.userData.isFloor = true; f.userData.room = rG; rG.add(f);
    const cM = new THREE.MeshStandardMaterial({ map: textureCache[rG.userData.textures.ceiling], side: THREE.DoubleSide }); const cG = new THREE.PlaneGeometry(w, d); const c = new THREE.Mesh(cG, cM); c.rotation.x = Math.PI / 2; c.position.y = h / 2; c.userData.isCeiling = true; rG.add(c);
    const wD = [{ s: 'north', p: [0, 0, -d / 2], r: 0, l: w }, { s: 'south', p: [0, 0, d / 2], r: 0, l: w }, { s: 'west', p: [-w / 2, 0, 0], r: Math.PI / 2, l: d }, { s: 'east', p: [w / 2, 0, 0], r: Math.PI / 2, l: d }];
    wD.forEach(d => { let wall; const data = { s: [d.l, h, t], p: d.p, rotY: d.r }; if (openings.includes(d.s)) wall = createWallWithOpening(data, rG.userData.textures.wall); else wall = createWall(data, rG.userData.textures.wall); wall.userData.side = d.s; rG.add(wall); rG.userData.walls[d.s] = wall; });

    const light = new THREE.PointLight(0xffeedd, 1.5, Math.max(w, d, h) * 2); light.position.set(0, h / 2 - 1, 0); light.castShadow = true; light.shadow.mapSize.width = 1024; light.shadow.mapSize.height = 1024;
    rG.add(light);

    if (quizData && quizData.length > 0) {
        const quizTrigger = createQuizTrigger();
        quizTrigger.position.y = -h / 2 + 2;
        rG.add(quizTrigger);
        rG.userData.quizTrigger = quizTrigger;
    }

    rG.updateWorldMatrix(true, true); return rG;
}

function createWall(data, textureName) { const wM = new THREE.MeshStandardMaterial({ map: textureCache[textureName] }); const wG = new THREE.BoxGeometry(...data.s); const w = new THREE.Mesh(wG, wM); w.position.set(...data.p); if (data.rotY) w.rotation.y = data.rotY; w.castShadow = true; w.receiveShadow = true; w.userData.isWall = true; return w; }
function createWallWithOpening(data, textureName, dW = 4, dH = 8) { const wG = new THREE.Group(); const wM = new THREE.MeshStandardMaterial({ map: textureCache[textureName] }); const tW = data.s[0], tH = data.s[1], t = data.s[2]; const sW = (tW - dW) / 2, lH = tH - dH; if (sW > 0.01) { const lGeo = new THREE.BoxGeometry(sW, tH, t); const lW = new THREE.Mesh(lGeo, wM.clone()); lW.position.x = -(dW / 2 + sW / 2); wG.add(lW); const rGeo = new THREE.BoxGeometry(sW, tH, t); const rW = new THREE.Mesh(rGeo, wM.clone()); rW.position.x = (dW / 2 + sW / 2); wG.add(rW); } if (lH > 0.01) { const lGeo = new THREE.BoxGeometry(dW, lH, t); const l = new THREE.Mesh(lGeo, wM.clone()); l.position.y = dH + lH / 2 - tH / 2; wG.add(l); } wG.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; c.userData.isWall = true; }); wG.position.set(...data.p); if (data.rotY) wG.rotation.y = data.rotY; wG.userData.isWallContainer = true; return wG; }

function addRoom(w, d, h, pos, openings = [], quizData = null, textures, fromLoad = false, id) {
    const roomGroup = createRoom(w, d, h, pos, openings, quizData, textures, id);
    scene.add(roomGroup); roomGroups.push(roomGroup);
    roomGroup.traverse(child => {
        if (child.userData.isWallContainer || child.userData.isWall || child.userData.isFloor) collidables.push(child);
        if (child.userData.isQuizTrigger) objects.push(child);
    });
    if (!fromLoad) { markAsDirty(); selectObject(roomGroup); }
    updateRoomControls();
}

function updateRoomControls() {
    roomControlsGroup.clear();
    const addMat = new THREE.MeshBasicMaterial({ map: addButtonTexture, transparent: true });
    const deleteMat = new THREE.MeshBasicMaterial({ map: deleteButtonTexture, transparent: true });
    const quizMat = new THREE.MeshBasicMaterial({ map: quizButtonTexture, transparent: true });

    for (const room of roomGroups) {
        const deleteButton = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), deleteMat);
        deleteButton.position.copy(room.position); deleteButton.position.y += 0.1 - (room.userData.height / 2);
        deleteButton.position.x -= 2.5; deleteButton.rotation.x = -Math.PI / 2;
        deleteButton.userData = { room, action: 'delete' }; roomControlsGroup.add(deleteButton);

        const quizButton = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quizMat);
        quizButton.position.copy(room.position); quizButton.position.y += 0.1 - (room.userData.height / 2);
        quizButton.position.x += 2.5; quizButton.rotation.x = -Math.PI / 2;
        quizButton.userData = { room, action: 'quiz' }; roomControlsGroup.add(quizButton);

        for (const side of ['north', 'south', 'east', 'west']) {
            if (room.userData.walls[side] && !room.userData.openings.includes(side)) {
                const button = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), addMat);
                button.userData = { room, side, action: 'add' };
                let offset = new THREE.Vector3();
                if (side === 'north') offset.z = -room.userData.depth / 2 - 2.5; if (side === 'south') offset.z = room.userData.depth / 2 + 2.5;
                if (side === 'east') offset.x = room.userData.width / 2 + 2.5; if (side === 'west') offset.x = -room.userData.width / 2 - 2.5;

                const buttonPos = room.position.clone().add(offset);
                let isOccupied = roomGroups.some(otherRoom => otherRoom !== room && new THREE.Box3().setFromObject(otherRoom).containsPoint(buttonPos));

                if (!isOccupied) {
                    button.position.copy(room.position).add(offset); button.position.y = 0.1 - (room.userData.height / 2);
                    button.rotation.x = -Math.PI / 2; roomControlsGroup.add(button);
                }
            }
        }
    }
    if (roomGroups.length === 0) {
        const button = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), addMat);
        button.userData = { room: null, side: null, action: 'add_initial' };
        button.position.y = 0.1 - 5; button.rotation.x = -Math.PI / 2; roomControlsGroup.add(button);
    }
}

function deleteRoom(roomToDelete) {
    deselectObject();
    const artworksToRemove = objects.filter(obj => (obj.userData.isPainting || obj.userData.isDrawingCanvas) && new THREE.Box3().setFromObject(roomToDelete).containsPoint(obj.position));
    artworksToRemove.forEach(obj => {
        if (obj.userData.isDrawingCanvas) {
            const { canvasId, listener } = drawingCanvases[obj.userData.canvasId];
            if(listener) listener();
            delete drawingCanvases[obj.userData.canvasId];
            remove(ref(db, `museums/${getCurrentMuseumId()}/drawings/${canvasId}`));
        } else {
             remove(ref(db, `images/${obj.userData.imageId}`));
        }
        const index = objects.indexOf(obj); if (index > -1) objects.splice(index, 1);
        obj.removeFromParent();
    });

    // Remove openings from neighbors
    // This logic needs to be precise
    const roomIndex = roomGroups.indexOf(roomToDelete); if (roomIndex > -1) roomGroups.splice(roomIndex, 1);
    roomToDelete.removeFromParent();
    updateRoomControls();
    markAsDirty();
}

function createQuizTrigger() {
    if (!font) return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
    const geo = new TextGeometry('Q', { font, size: 1.5, height: 0.2, curveSegments: 12, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.05, bevelOffset: 0, bevelSegments: 5 });
    geo.computeBoundingBox(); geo.translate(-0.5 * (geo.boundingBox.max.x - geo.boundingBox.min.x), 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.5, roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.isQuizTrigger = true; mesh.visible = !isEditMode;
    return mesh;
}

export async function placePainting(url, intersect, restoreData) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(url, (texture) => {
            const maxDim = 4.0;
            const aspect = texture.image ? (texture.image.naturalWidth / texture.image.naturalHeight) : 1;
            const width = aspect >= 1 ? maxDim : maxDim * aspect;
            const height = aspect >= 1 ? maxDim / aspect : maxDim;
            const frameThickness = 0.2;
            const paintingGroup = new THREE.Group();
            const frameGeo = new THREE.BoxGeometry(width + frameThickness, height + frameThickness, frameThickness);
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.6, metalness: 0.4 });
            const frame = new THREE.Mesh(frameGeo, frameMat); frame.castShadow = true; paintingGroup.add(frame);
            const canvasGeo = new THREE.PlaneGeometry(width, height);
            const canvasMat = new THREE.MeshLambertMaterial({ map: texture });
            const canvas = new THREE.Mesh(canvasGeo, canvasMat); canvas.position.z = frameThickness / 2 + 0.01; paintingGroup.add(canvas);

            paintingGroup.uuid = restoreData?.uuid || THREE.MathUtils.generateUUID();
            paintingGroup.userData = {
                isPainting: true,
                infoText: restoreData?.infoText || "",
                imageId: restoreData?.imageId,
                initialWidth: width,
                initialHeight: height
            };

            if (intersect) {
                const worldNormal = new THREE.Vector3().copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
                paintingGroup.position.copy(intersect.point);
                paintingGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
                paintingGroup.position.addScaledVector(worldNormal, frameThickness / 2 + 0.01);
                markAsDirty();
            } else if (restoreData) {
                paintingGroup.position.copy(restoreData.position);
                paintingGroup.quaternion.copy(restoreData.quaternion);
                paintingGroup.scale.copy(restoreData.scale);
            }

            scene.add(paintingGroup); objects.push(paintingGroup); resolve(paintingGroup);
        }, undefined, () => reject(new Error('Failed to load painting texture.')));
    });
}

function placeDrawingCanvas(intersect, restoreData) {
    return new Promise((resolve) => {
        const canvasId = restoreData?.canvasId || THREE.MathUtils.generateUUID();

        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 768;
        const context = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const drawingRef = ref(db, `museums/${getCurrentMuseumId()}/drawings/${canvasId}`);
        const listener = onValue(drawingRef, (snapshot) => {
            redrawCanvas(canvasId, snapshot.val());
        });

        drawingCanvases[canvasId] = { canvas, context, texture, listener };

        const geo = new THREE.PlaneGeometry(4, 3);
        const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.userData = {
            isDrawingCanvas: true,
            canvasId,
            initialWidth: 4,
            initialHeight: 3,
            infoText: ''
        };
        mesh.uuid = restoreData?.uuid || THREE.MathUtils.generateUUID();

        if (intersect) {
            const worldNormal = new THREE.Vector3().copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
            mesh.position.copy(intersect.point);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
            mesh.position.addScaledVector(worldNormal, 0.1);
            markAsDirty();
        } else if (restoreData) {
            mesh.position.copy(restoreData.position);
            mesh.quaternion.copy(restoreData.quaternion);
            mesh.scale.copy(restoreData.scale);
        }

        scene.add(mesh);
        objects.push(mesh);
        resolve(mesh);
    });
}

function redrawCanvas(canvasId, paths) {
    const drawing = drawingCanvases[canvasId];
    if (!drawing) return;
    const { canvas, context, texture } = drawing;

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (!paths) {
        texture.needsUpdate = true;
        return;
    };

    context.lineCap = 'round';
    context.lineWidth = 5;

    for (const pathId in paths) {
        const path = paths[pathId];
        if (!path.points || path.points.length < 2) continue;
        context.strokeStyle = path.color;
        context.beginPath();

        let x = path.points[0] * canvas.width;
        let y = (1 - path.points[1]) * canvas.height;
        context.moveTo(x, y);

        for (let i = 2; i < path.points.length; i += 2) {
            x = path.points[i] * canvas.width;
            y = (1 - path.points[i + 1]) * canvas.height;
            context.lineTo(x, y);
        }
        context.stroke();
    }
    texture.needsUpdate = true;
}

