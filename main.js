import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as FB from './firebase.js';
import * as UI from './ui.js';

// --- GLOBAL STATE ---
let currentMuseumId = null;
let isViewerMode = false;
let museumDataListener = null;
let isDataLoaded = false;
let scene;
let camera;
let renderer;
let orbitControls;
let pointerLockControls;
let isEditMode = true;
let addButtonTexture, deleteButtonTexture;
const objects = [], collidables = [], roomGroups = [];
let roomControlsGroup;
let isInteractingWithUI = false;
let isResizing = false;
let draggedObject = null;
let activePaintingIntersect = null;
let currentEditingPainting = null;
let currentResizeHandle = null;
let viewerOverlay;
let lastPlayerPosition = new THREE.Vector3(0, 5, 0), lastPlayerQuaternion = new THREE.Quaternion();
const dragPlane = new THREE.Plane(), dragIntersection = new THREE.Vector3();
const raycaster = new THREE.Raycaster(), keysPressed = {};
const moveSpeed = 10.0, gravity = 30.0, playerHeight = 5;
const playerVelocity = new THREE.Vector3(), clock = new THREE.Clock();
let animationFrameId;

const textureUrls = {
  marble: 'https://museumaker.netlify.app/assets/marble.jpg',
  wood: 'https://museumaker.netlify.app/assets/wood.jpg',
  darkwood: 'https://museumaker.netlify.app/assets/darkwood.jpg',
  blue: 'https://museumaker.netlify.app/assets/blue.png',
  darkred: 'https://museumaker.netlify.app/assets/darkred.png'
};
const textureNames = {
  marble: 'Mármol',
  wood: 'Madera',
  darkwood: 'Madera Oscura',
  blue: 'Azul',
  darkred: 'Rojo Oscuro'
};
const textureCache = {};
let currentFloorTextureName = 'marble';
let currentWallTextureName = 'wood';

const musicList = {
    'jazz1': { name: 'Jazz 1', url: 'https://museumaker.netlify.app/assets/music/jazz1.mp3' },
    'jazz2': { name: 'Jazz 2', url: 'https://museumaker.netlify.app/assets/music/jazz2.mp3' },
    'airong': { name: 'Airong', url: 'https://museumaker.netlify.app/assets/music/airong.mp3' },
    'clairdelune': { name: 'Clair de Lune', url: 'https://museumaker.netlify.app/assets/music/clairdelune.mp3' },
    'cylinderfive': { name: 'Cylinder Five', url: 'https://museumaker.netlify.app/assets/music/cylinderfive.mp3' },
    'gymnopedie': { name: 'Gymnopédie', url: 'https://museumaker.netlify.app/assets/music/gymnopedie.mp3' },
    'nocturne9': { name: 'Nocturne No. 9', url: 'https://museumaker.netlify.app/assets/music/nocturne9.mp3' },
};
let currentMusicKey = null;
let previewAudio = new Audio();
let backgroundAudio;
let currentPreview = { key: null, button: null };


// --- INITIALIZATION ---
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
  UI.showView('app');
  init3D();
  listenToMuseumData(currentMuseumId, false);
}

function startViewer(museumId) {
  currentMuseumId = museumId;
  isViewerMode = true;
  document.getElementById('editor-top-bar').classList.add('hidden');
  UI.showView('app');
  init3D();
  listenToMuseumData(currentMuseumId, true);
}

// --- DATA HANDLING ---
function listenToMuseumData(museumId, isPublic) {
  if (museumDataListener) museumDataListener();
  museumDataListener = FB.listenToMuseumData(museumId, async (snapshot) => {
    if (!snapshot.exists()) {
      UI.showMessage("Error: No se encontró el museo.", 'error');
      goBackToDashboard();
      return;
    }
    const museum = snapshot.val();
    if (isPublic && !museum.isPublic) {
      UI.showMessage("Error: Este museo no es público.", 'error');
      return;
    }
    document.getElementById('museum-name-display').textContent = museum.name;
    await loadMuseumState(museum.data);
    isDataLoaded = true;
  });
}

async function loadMuseumState(state) {
    if (!state) return;
    currentFloorTextureName = state.settings?.floorTexture || 'marble';
    currentWallTextureName = state.settings?.wallTexture || 'wood';
    currentMusicKey = state.settings?.musicKey || null;

    UI.updateTextureSelectorUI(currentFloorTextureName, currentWallTextureName);
    UI.updateMusicSelectorUI(currentMusicKey);

    clearMuseum();
    setTimeout(async () => {
        if (state.rooms) {
            for (const roomData of state.rooms) {
                const roomGroup = addRoom(roomData.width, roomData.depth, roomData.height, new THREE.Vector3().copy(roomData.position), roomData.openings, true);
                if (roomData.artworks) {
                    for (const artworkData of roomData.artworks) {
                        const imageUrl = await FB.getImageDataUrl(artworkData.imageId);
                        if (imageUrl) {
                            try {
                                const paintingGroup = await placePainting(imageUrl, null, artworkData);
                                if (paintingGroup && roomGroup) {
                                    roomGroup.userData.artworks.push(paintingGroup);
                                    paintingGroup.userData.room = roomGroup;
                                }
                            } catch (error) {
                                console.error("Failed to place restored painting:", error);
                            }
                        }
                    }
                }
            }
        }
        if (isViewerMode) {
            switchToPreviewMode(true);
            if (currentMusicKey && musicList[currentMusicKey]) {
                backgroundAudio.src = musicList[currentMusicKey].url;
                document.getElementById('music-controls').classList.remove('hidden');
                updateMusicButtonIcon(true);
            }
        } else {
            switchToEditMode();
        }
        console.log("Museo cargado.");
    }, 100);
}

function gatherState() {
    const state = {
        rooms: [],
        settings: {
            floorTexture: currentFloorTextureName,
            wallTexture: currentWallTextureName,
            musicKey: currentMusicKey
        }
    };

    for (const roomGroup of roomGroups) {
        const roomArtworks = [];
        if (roomGroup.userData.artworks) {
            for (const painting of roomGroup.userData.artworks) {
                if (painting.parent) { 
                     const infoText = painting.userData.infoTextMesh;
                     roomArtworks.push({
                        uuid: painting.uuid,
                        imageId: painting.userData.imageId,
                        position: painting.position.clone(),
                        quaternion: painting.quaternion.clone(),
                        scale: painting.scale.clone(),
                        infoTextContent: painting.userData.infoText,
                        infoTextPosition: infoText ? infoText.position.clone() : null
                    });
                }
            }
        }

        state.rooms.push({
            position: roomGroup.position.clone(),
            openings: roomGroup.userData.openings,
            width: roomGroup.userData.width,
            depth: roomGroup.userData.depth,
            height: roomGroup.userData.height,
            artworks: roomArtworks
        });
    }
    
    return state;
}

async function saveMuseumToDB() {
    if (!currentMuseumId || !isDataLoaded) return;
    console.log("Guardando...");
    const state = gatherState();
    try {
        await FB.saveMuseumData(currentMuseumId, state);
        console.log("¡Guardado con éxito!");
    } catch (error) {
        console.error("Error al guardar:", error);
        UI.showMessage("No se pudo guardar el museo.", 'error');
    }
}


// --- 3D SCENE & LOGIC ---
function init3D() {
  if (renderer) {
    console.warn("A renderer instance already existed. Forcing cleanup.");
    cleanup3D();
  }

  viewerOverlay = document.getElementById('viewer-overlay');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 0, 250);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  document.getElementById('app-container').insertBefore(renderer.domElement, viewerOverlay);
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
  scene.add(pointerLockControls.getObject());
  backgroundAudio = document.getElementById('background-music');
  setup3DEventListeners();
  loadAssets();
  animate();
}

function cleanup3D() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        const canvas = renderer.domElement;
        if (canvas && canvas.parentElement) {
            canvas.parentElement.removeChild(canvas);
        }
    }
    
    orbitControls?.dispose();
    pointerLockControls?.dispose();
    
    scene?.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach(material => material.dispose());
            } else {
                object.material.dispose();
            }
        }
    });

    renderer = null;
    scene = null;
    camera = null;
    orbitControls = null;
    pointerLockControls = null;

    objects.length = 0;
    collidables.length = 0;
    roomGroups.length = 0;
}

function loadAssets() {
  const textureLoader = new THREE.TextureLoader();
  for (const key in textureUrls) {
    textureCache[key] = textureLoader.load(textureUrls[key], (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    });
  }
  addButtonTexture = generateButtonTexture('+', 'rgba(34, 197, 94, 0.8)');
  deleteButtonTexture = generateButtonTexture('X', 'rgba(239, 68, 68, 0.8)');
}

function setup3DEventListeners() {
    viewerOverlay.addEventListener('click', () => {
        pointerLockControls.lock();
        if (backgroundAudio.src && backgroundAudio.paused) {
            backgroundAudio.play().catch(e => console.log("Autoplay blocked"));
            updateMusicButtonIcon(false);
        }
    });
    pointerLockControls.addEventListener('lock', () => {
        viewerOverlay.style.display = 'none';
        document.getElementById('instructions').classList.remove('hidden');
    });
    pointerLockControls.addEventListener('unlock', () => {
        if (!isViewerMode) switchToEditMode();
        else viewerOverlay.style.display = 'flex';
        document.getElementById('instructions').classList.add('hidden');
    });
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', (e) => {
        keysPressed[e.code] = true;
        if (e.code === 'Escape' && pointerLockControls.isLocked) pointerLockControls.unlock();
        if (e.code === 'Space' || e.code === 'Escape') {
            UI.hideFocusView();
            isInteractingWithUI = false;
            if(!isEditMode) pointerLockControls.lock();
        }
    });
    document.addEventListener('keyup', (e) => { keysPressed[e.code] = false; });
    document.getElementById('preview-btn').addEventListener('click', switchToPreviewMode);
    renderer.domElement.addEventListener('mousedown', onCanvasMouseDown);
    window.addEventListener('mousemove', onDocumentMouseMove);
    window.addEventListener('mouseup', onDocumentMouseUp);
}


function onCanvasMouseDown(event) {
    if (isInteractingWithUI) return;

    if (isEditMode) {
        const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const draggableObjects = objects.filter(o => o.userData.isInfoText || o.userData.isPainting);
        const dragIntersects = raycaster.intersectObjects(draggableObjects, true);
        if (dragIntersects.length > 0) {
            let clickedObject = dragIntersects[0].object;
            while(clickedObject.parent && !clickedObject.userData.isPainting && !clickedObject.userData.isInfoText) clickedObject = clickedObject.parent;
            draggedObject = clickedObject;
            orbitControls.enabled = false;
            
            const paintingForNormal = draggedObject.userData.isPainting ? draggedObject : draggedObject.userData.paintingGroup;
            const wallNormal = new THREE.Vector3(0, 0, -1).applyQuaternion(paintingForNormal.quaternion);

            dragPlane.setFromNormalAndCoplanarPoint(wallNormal, dragIntersects[0].point);
            return;
        }
        const controlIntersects = raycaster.intersectObjects(roomControlsGroup.children);
        if (controlIntersects.length > 0) {
             const { room, side, action } = controlIntersects[0].object.userData;
             if (action === 'add') {
                const roomSize = 20; let newPos = room.position.clone(); let opSide;
                if (side === 'north') { newPos.z -= roomSize; opSide = 'south'; } if (side === 'south') { newPos.z += roomSize; opSide = 'north'; }
                if (side === 'east') { newPos.x += roomSize; opSide = 'west'; } if (side === 'west') { newPos.x -= roomSize; opSide = 'east'; }
                const wallToRemove = room.userData.walls[side];
                if(wallToRemove) {
                    collidables.splice(collidables.indexOf(wallToRemove), 1);
                    objects.splice(objects.indexOf(wallToRemove), 1);
                    wallToRemove.removeFromParent();
                }
                const wallDataMap = {
                    north:  { s: [room.userData.width, room.userData.height, 0.5], p: [0, 0, -room.userData.depth / 2], rotY: 0 },
                    south:  { s: [room.userData.width, room.userData.height, 0.5], p: [0, 0,  room.userData.depth / 2], rotY: 0 },
                    west:   { s: [room.userData.depth, room.userData.height, 0.5], p: [-room.userData.width / 2, 0, 0], rotY: Math.PI / 2 },
                    east:   { s: [room.userData.depth, room.userData.height, 0.5], p: [ room.userData.width / 2, 0, 0], rotY: Math.PI / 2 }
                };
                const newWall = createWallWithOpening(wallDataMap[side]);
                newWall.userData.side = side;
                room.add(newWall);
                room.userData.walls[side] = newWall;
                newWall.children.forEach(part => { collidables.push(part); objects.push(part); });
                room.userData.openings.push(side);
                addRoom(roomSize, roomSize, 10, newPos, [opSide]);
             } else if (action === 'delete') {
                deleteRoom(room);
             }
        }
    } else if (pointerLockControls.isLocked) {
        raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        const intersects = raycaster.intersectObjects(objects, true);
        const paintingIntersect = intersects.find(i => (i.object.parent && i.object.parent.userData.isPainting) || (i.object.userData.paintingGroup));
        if (paintingIntersect) {
            const paintingGroup = paintingIntersect.object.parent.userData.isPainting ? paintingIntersect.object.parent : paintingIntersect.object.userData.paintingGroup;
            if (isViewerMode) {
                isInteractingWithUI = true;
                UI.showFocusView(paintingGroup, FB.getImageDataUrl, isViewerMode);
            } else { // Editor in preview mode
                isInteractingWithUI = true;
                pointerLockControls.unlock();
                currentEditingPainting = paintingGroup;
                document.getElementById('info-text').value = currentEditingPainting.userData.infoText || '';
                UI.showModal('edit-painting-modal');
            }
            return;
        }
        if (!isViewerMode) {
            const wallIntersect = intersects.find(i => i.object.isWall);
            if (wallIntersect) {
                isInteractingWithUI = true;
                pointerLockControls.unlock();
                activePaintingIntersect = wallIntersect;
                UI.showModal('painting-modal');
            }
        }
    }
}
function generateButtonTexture(text, color) { const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 128, 128); context.fillStyle = 'white'; context.font = 'bold 96px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 64, 64); return new THREE.CanvasTexture(canvas); }
function goBackToDashboard() { 
    if (museumDataListener) museumDataListener(); 
    currentMuseumId = null; 
    isDataLoaded = false; 
    cleanup3D(); 
    UI.showView('dashboard'); 
}
async function publishMuseum() {
    await saveMuseumToDB();
    if (!currentMuseumId) return;
    await FB.publishMuseum(currentMuseumId);
    const url = `${window.location.origin}${window.location.pathname}?view=${currentMuseumId}`;
    document.getElementById('publish-url').value = url;
    UI.showModal('publish-modal');
}
function clearMuseum() { isDataLoaded = false; while(objects.length > 0) objects.pop().removeFromParent(); while(roomGroups.length > 0) roomGroups.pop().removeFromParent(); collidables.length = 0; if (roomControlsGroup) roomControlsGroup.clear(); }
function createRoom(w, d, h, pos, openings = []) { const t = 0.5; const rG = new THREE.Group(); rG.position.copy(pos); rG.userData = { id: THREE.MathUtils.generateUUID(), walls: {}, openings, width: w, depth: d, height: h, artworks: [] }; const qM = new THREE.MeshStandardMaterial({ map: textureCache[currentFloorTextureName], side: THREE.DoubleSide }); const fG = new THREE.PlaneGeometry(w, d); const f = new THREE.Mesh(fG, qM.clone()); f.rotation.x = -Math.PI / 2; f.position.y = -h / 2; f.receiveShadow = true; f.isFloor = true; rG.add(f); const cG = new THREE.PlaneGeometry(w, d); const c = new THREE.Mesh(cG, qM.clone()); c.rotation.x = Math.PI / 2; c.position.y = h / 2; c.isCeiling = true; rG.add(c); const wD = [{ s: 'north', p: [0, 0, -d / 2], r: 0, l: w}, { s: 'south', p: [0, 0, d / 2], r: 0, l: w}, { s: 'west', p: [-w / 2, 0, 0], r: Math.PI / 2, l: d}, { s: 'east', p: [w / 2, 0, 0], r: Math.PI / 2, l: d}]; wD.forEach(d => { let wall; const data = {s:[d.l, h, t], p:d.p, rotY:d.r}; if (openings.includes(d.s)) wall = createWallWithOpening(data); else wall = createWall(data); wall.userData.side = d.s; rG.add(wall); rG.userData.walls[d.s] = wall; }); const light = new THREE.PointLight(0xffeedd, 1, 30); light.position.set(0, h / 2 - 1, 0); light.castShadow = true; light.shadow.mapSize.width = 1024; light.shadow.mapSize.height = 1024; light.shadow.camera.near = 0.5; light.shadow.camera.far = 25; rG.add(light); rG.updateWorldMatrix(true, true); return rG; }
function createWall(data) { const wM = new THREE.MeshStandardMaterial({ map: textureCache[currentWallTextureName] }); const wG = new THREE.BoxGeometry(...data.s); const w = new THREE.Mesh(wG, wM); w.position.set(...data.p); if (data.rotY) w.rotation.y = data.rotY; w.castShadow = true; w.receiveShadow = true; w.isWall = true; return w; }
function createWallWithOpening(data, dW = 4, dH = 8) { const wG = new THREE.Group(); const wM = new THREE.MeshStandardMaterial({ map: textureCache[currentWallTextureName] }); const tW = data.s[0], tH = data.s[1], t = data.s[2]; const sW = (tW - dW) / 2, lH = tH - dH; if (sW > 0.01) { const lGeo = new THREE.BoxGeometry(sW, tH, t); const lW = new THREE.Mesh(lGeo, wM.clone()); lW.position.x = -(dW / 2 + sW / 2); wG.add(lW); const rGeo = new THREE.BoxGeometry(sW, tH, t); const rW = new THREE.Mesh(rGeo, wM.clone()); rW.position.x = (dW / 2 + sW / 2); wG.add(rW); } if (lH > 0.01) { const lGeo = new THREE.BoxGeometry(dW, lH, t); const l = new THREE.Mesh(lGeo, wM.clone()); l.position.y = dH + lH / 2 - tH / 2; wG.add(l); } wG.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; c.isWall = true; }); wG.position.set(...data.p); if (data.rotY) wG.rotation.y = data.rotY; wG.isWallContainer = true; return wG; }
function placePainting(url, intersect, restoreData) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(url, (texture) => {
            const maxDim = 4.0;
            const aspect = texture.image ? (texture.image.naturalWidth / texture.image.naturalHeight) : 1;
            const width = aspect >= 1 ? maxDim : maxDim * aspect;
            const height = aspect >= 1 ? maxDim / aspect : maxDim;
            const frameThickness = 0.2;
            const paintingGroup = new THREE.Group();
            paintingGroup.castShadow = true;
            const frameGeo = new THREE.BoxGeometry(width + frameThickness, height + frameThickness, frameThickness);
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.6, metalness: 0.4 });
            const frame = new THREE.Mesh(frameGeo, frameMat);
            frame.castShadow = true;
            frame.receiveShadow = true;
            paintingGroup.add(frame);
            const canvasGeo = new THREE.PlaneGeometry(width, height);
            const canvasMat = new THREE.MeshLambertMaterial({ map: texture });
            const canvas = new THREE.Mesh(canvasGeo, canvasMat);
            canvas.position.z = frameThickness / 2 + 0.01;
            canvas.receiveShadow = true;
            paintingGroup.add(canvas);
            paintingGroup.uuid = restoreData.uuid || THREE.MathUtils.generateUUID();
            paintingGroup.userData = { isPainting: true, infoText: "", imageId: restoreData.imageId, originalWidth: width, originalHeight: height };
            frame.userData.paintingGroup = paintingGroup;
            canvas.userData.paintingGroup = paintingGroup;
            
            if (intersect) {
                const worldNormal = new THREE.Vector3().copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
                paintingGroup.position.copy(intersect.point);
                paintingGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
                paintingGroup.position.addScaledVector(worldNormal, frameThickness / 2 + 0.01);
            } else {
                paintingGroup.position.copy(restoreData.position);
                paintingGroup.quaternion.copy(restoreData.quaternion);
                paintingGroup.scale.copy(restoreData.scale);
                paintingGroup.userData.infoText = restoreData.infoTextContent || "";
                updateInfoText(paintingGroup, restoreData.infoTextPosition);
            }
            scene.add(paintingGroup);
            objects.push(paintingGroup);
            resolve(paintingGroup);
        }, undefined, () => {
            UI.showMessage("Error al cargar la imagen del cuadro.", 'error');
            reject(new Error("Failed to load painting texture"));
        });
    });
}
function addRoom(w, d, h, pos, openings = [], fromLoad = false) { 
    const roomGroup = createRoom(w, d, h, pos, openings); 
    scene.add(roomGroup); 
    roomGroups.push(roomGroup); 
    roomGroup.children.forEach(child => { 
        if (child.isWallContainer) { 
            child.children.forEach(part => { 
                collidables.push(part); 
                objects.push(part); 
            }); 
        } else { 
            collidables.push(child); 
            if(child.isWall) objects.push(child); 
        }
    }); 
    updateRoomControls(); 
    if(!fromLoad) saveMuseumToDB();
    return roomGroup;
}
function onDocumentMouseMove(event) { 
    if (draggedObject) { 
        const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1); 
        raycaster.setFromCamera(mouse, camera); 
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersection)) {
            if (draggedObject.userData.isInfoText) {
                // For text, convert world intersection point to painting's local space
                const paintingGroup = draggedObject.userData.paintingGroup;
                const localPosition = paintingGroup.worldToLocal(dragIntersection.clone());
                // Keep Z the same to prevent it from going through the wall
                draggedObject.position.set(localPosition.x, localPosition.y, draggedObject.position.z);
            } else {
                // For paintings, update world position. Text will follow.
                draggedObject.position.copy(dragIntersection); 
            }
        }
        return; 
    } 
    if (!isResizing || !currentResizeHandle) return; 
    const pG = currentResizeHandle.parent.parent; 
    const sF = (event.movementX - event.movementY) * 0.005; 
    let nS = pG.scale.x + sF; 
    nS = Math.max(0.2, Math.min(nS, 5)); 
    pG.scale.set(nS, nS, nS); 
}
function onDocumentMouseUp() { 
    if (draggedObject) { 
        draggedObject = null; 
        orbitControls.enabled = true; 
        saveMuseumToDB();
    } 
    if (isResizing) { 
        isResizing = false; 
        currentResizeHandle = null; 
        saveMuseumToDB();
    } 
}
function updateRoomControls() {
    roomControlsGroup.clear();
    const addMat = new THREE.MeshBasicMaterial({ map: addButtonTexture, transparent: true });
    const deleteMat = new THREE.MeshBasicMaterial({ map: deleteButtonTexture, transparent: true });
    for (const room of roomGroups) {
        const deleteGeo = new THREE.PlaneGeometry(2, 2);
        const deleteButton = new THREE.Mesh(deleteGeo, deleteMat);
        deleteButton.position.copy(room.position);
        deleteButton.position.y = 0.1;
        deleteButton.rotation.x = -Math.PI / 2;
        deleteButton.userData = { room, action: 'delete' };
        roomControlsGroup.add(deleteButton);
        const roomDims = { x: room.userData.width, z: room.userData.depth };
        for (const side of ['north', 'south', 'east', 'west']) {
            if (room.userData.walls[side] && !room.userData.openings.includes(side)) {
                const buttonGeo = new THREE.PlaneGeometry(3, 3);
                const button = new THREE.Mesh(buttonGeo, addMat);
                button.userData = { room, side, action: 'add' };
                let offset = new THREE.Vector3();
                if (side === 'north') offset.z = -roomDims.z / 2 - 2.5;
                if (side === 'south') offset.z = roomDims.z / 2 + 2.5;
                if (side === 'east') offset.x = roomDims.x / 2 + 2.5;
                if (side === 'west') offset.x = -roomDims.x / 2 - 2.5;
                const buttonPos = room.position.clone().add(offset);
                let isOccupied = roomGroups.some(otherRoom => {
                    if (otherRoom === room) return false;
                    const otherBBox = new THREE.Box3().setFromObject(otherRoom);
                    return otherBBox.containsPoint(buttonPos);
                });
                if (!isOccupied) {
                    button.position.copy(room.position).add(offset);
                    button.position.y = 0.1;
                    button.rotation.x = -Math.PI / 2;
                    roomControlsGroup.add(button);
                }
            }
        }
    }
}
function updateInfoText(paintingGroup, restorePosition = null) {
    if (paintingGroup.userData.infoTextMesh) {
        const textMesh = paintingGroup.userData.infoTextMesh;
        const textObjectIndex = objects.indexOf(textMesh);
        if (textObjectIndex > -1) objects.splice(textObjectIndex, 1);
        textMesh.removeFromParent();
        if (textMesh.geometry) textMesh.geometry.dispose();
        if (textMesh.material.map) textMesh.material.map.dispose();
        if (textMesh.material) textMesh.material.dispose();
    }
    const text = paintingGroup.userData.infoText;
    if (!text || text.trim() === '') {
        paintingGroup.userData.infoTextMesh = null;
        return;
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontSize = 32,
        font = `bold ${fontSize}px Inter, sans-serif`,
        maxWidth = 400,
        lineHeight = 40,
        padding = 10;
    context.font = font;
    const words = text.split(' ');
    let lines = [];
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = context.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    let maxLineWidth = 0;
    lines.forEach(line => {
        const lineWidth = context.measureText(line).width;
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
    });
    canvas.width = maxLineWidth + padding * 2;
    canvas.height = lines.length * lineHeight + padding * 2;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    lines.forEach((line, i) => {
        context.fillText(line, canvas.width / 2, (i * lineHeight) + (lineHeight / 2) + padding);
    });
    const texture = new THREE.CanvasTexture(canvas);
    const planeWidth = canvas.width / 200,
        planeHeight = canvas.height / 200;
    const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const planeMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const textMesh = new THREE.Mesh(planeGeo, planeMat);
    textMesh.userData = { isInfoText: true, paintingGroup: paintingGroup };

    if (restorePosition) {
        textMesh.position.copy(restorePosition);
    } else {
        const frame = paintingGroup.children.find(c => c.geometry.type === 'BoxGeometry');
        if (frame) {
            const frameWidth = frame.geometry.parameters.width;
            const frameThickness = frame.geometry.parameters.depth;
            const textGap = 0.2;
            const localX = (frameWidth / 2) + (planeWidth / 2) + textGap;
            const zOffset = frameThickness / 2 + 0.01;
            // Position is now local to the painting group with correct Z
            textMesh.position.set(localX, 0, zOffset);
        } else {
             // Fallback position if frame is not found
            const frameWidth = paintingGroup.userData.originalWidth || 4;
            const textGap = 0.2;
            const localX = (frameWidth / 2) + (planeWidth / 2) + textGap;
            textMesh.position.set(localX, 0, 0.11);
        }
    }
    
    // Add text mesh as a child of the painting
    paintingGroup.add(textMesh);
    objects.push(textMesh);
    paintingGroup.userData.infoTextMesh = textMesh;
}
function handleMovement(dT) { if (!pointerLockControls.isLocked) return; const mF=(Number(keysPressed['KeyW']||false)-Number(keysPressed['KeyS']||false)), mR=(Number(keysPressed['KeyD']||false)-Number(keysPressed['KeyA']||false)); const p=pointerLockControls.getObject(), oP=p.position.clone(); if(mF!==0)p.translateZ(-mF*moveSpeed*dT); if(mR!==0)p.translateX(mR*moveSpeed*dT); const nP=p.position.clone(); nP.y=oP.y; const mV=nP.clone().sub(oP); if(mV.lengthSq()>0){raycaster.set(oP,mV.normalize()); const wI=raycaster.intersectObjects(collidables.filter(o=>o.isWall),true); if(wI.length>0&&wI[0].distance<1.0)p.position.copy(oP);}}
function switchToEditMode() {
    isEditMode = true;
    roomControlsGroup.visible = true;
    orbitControls.enabled = true;
    scene.traverse(c => { if (c.isCeiling) c.visible = false; });
    lastPlayerPosition.copy(pointerLockControls.getObject().position);
    lastPlayerQuaternion.copy(camera.quaternion);
    camera.position.set(lastPlayerPosition.x, 80, lastPlayerPosition.z + 20);
    orbitControls.target.copy(lastPlayerPosition);
    document.getElementById('info-panel').classList.remove('hidden');
    if (viewerOverlay) viewerOverlay.style.display = 'none';
}
function switchToPreviewMode(force = false) {
    if (!isEditMode && !force) return;
    isEditMode = false;
    draggedObject = null;
    roomControlsGroup.visible = false;
    const player = pointerLockControls.getObject();
    if (!force) {
        lastPlayerPosition.copy(orbitControls.target);
    }
    player.position.copy(lastPlayerPosition);
    camera.position.copy(lastPlayerPosition);
    camera.quaternion.copy(lastPlayerQuaternion);
    scene.traverse(c => { if (c.isCeiling) c.visible = true; });
    orbitControls.enabled = false;
    document.getElementById('info-panel').classList.add('hidden');
    if (viewerOverlay) viewerOverlay.style.display = 'flex';
}
function deleteRoom(roomToDelete) {
    if (roomGroups.length <= 1) {
        UI.showMessage("No se puede eliminar la última habitación.", 'error');
        return;
    }

    const artworksToDelete = [...roomToDelete.userData.artworks];
    artworksToDelete.forEach(painting => {
        if (painting.userData.infoTextMesh) {
             const textMesh = painting.userData.infoTextMesh;
             const textObjectIndex = objects.indexOf(textMesh);
             if (textObjectIndex > -1) objects.splice(textObjectIndex, 1);
             textMesh.removeFromParent();
        }
        const paintingIndex = objects.indexOf(painting);
        if (paintingIndex > -1) objects.splice(paintingIndex, 1);
        painting.removeFromParent();

        if (painting.userData.imageId) {
            FB.deleteImage(painting.userData.imageId).catch(e => console.error("Failed to delete image on room delete:", e));
        }
    });

    roomToDelete.traverse(child => {
        const collidableIndex = collidables.indexOf(child);
        if (collidableIndex > -1) collidables.splice(collidableIndex, 1);
        const objectIndex = objects.indexOf(child);
        if (objectIndex > -1) objects.splice(objectIndex, 1);
    });

    const roomIndex = roomGroups.indexOf(roomToDelete);
    if (roomIndex > -1) roomGroups.splice(roomIndex, 1);

    roomToDelete.removeFromParent();
    updateRoomControls();
    saveMuseumToDB();
}
function animate() { 
    animationFrameId = requestAnimationFrame(animate);
    if (!renderer) return; 
    let dT = clock.getDelta(); 
    if (dT > 0.1) dT = 0.1; 
    if (isEditMode) {
        orbitControls.update(); 
    } else { 
        handleMovement(dT); 
        const p = pointerLockControls.getObject(); 
        const dR = new THREE.Raycaster(p.position, new THREE.Vector3(0, -1, 0)); 
        const fI = dR.intersectObjects(collidables.filter(c => c.isFloor), true); 
        const oG = fI.length > 0 && fI[0].distance < playerHeight + 0.1; 
        if (oG) { 
            playerVelocity.y = 0; 
            p.position.y = fI[0].point.y + playerHeight; 
        } else { 
            playerVelocity.y -= gravity * dT; 
            p.position.y += playerVelocity.y * dT; 
        } 
        if (p.position.y < -50) { 
            p.position.set(0, playerHeight, 0); 
            playerVelocity.set(0, 0, 0); 
        }
    } 
    renderer.render(scene, camera); 
}
function onWindowResize() { if(camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); } }

// --- AUTH EVENT LISTENERS ---
let museumToDelete = null;
FB.onAuthStateChanged(FB.auth, user => {
    if (user) {
        if (!isViewerMode) {
            UI.showView('dashboard');
            FB.listenToUserMuseums((snapshot) => {
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
                                      <button data-id="${museumId}" data-name="${museum.name}" class="delete-btn btn-secondary btn-sm">Eliminar</button>
                                      <button data-id="${museumId}" data-name="${museum.name}" class="edit-btn btn-primary btn-sm">Editar</button>`;
                    museumsList.appendChild(item);
                }
                museumsList.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', (e) => startEditor(e.target.dataset.id, e.target.dataset.name)));
                museumsList.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', (e) => {
                    museumToDelete = { id: e.target.dataset.id, name: e.target.dataset.name };
                    document.getElementById('deleting-museum-name').textContent = museumToDelete.name;
                    UI.showModal('delete-confirm-modal');
                }));
            });
        }
    } else {
        if (!isViewerMode) UI.showView('auth');
    }
});
document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value; const password = document.getElementById('password').value;
    FB.login(email, password).catch(err => document.getElementById('auth-error').textContent = err.message);
});
document.getElementById('signup-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value; const password = document.getElementById('password').value;
    FB.signup(email, password).catch(err => document.getElementById('auth-error').textContent = err.message);
});
document.getElementById('logout-btn').addEventListener('click', FB.logout);
document.getElementById('create-museum-btn').addEventListener('click', () => {
    document.getElementById('new-museum-name').value = '';
    UI.showModal('create-museum-modal');
});
document.getElementById('cancel-create-museum-btn').addEventListener('click', () => UI.hideModal('create-museum-modal'));
document.getElementById('confirm-create-museum-btn').addEventListener('click', async () => {
    const museumName = document.getElementById('new-museum-name').value;
    if (!museumName) return;
    UI.hideModal('create-museum-modal');
    const { museumId, name } = await FB.createNewMuseum(museumName);
    startEditor(museumId, name);
});
document.getElementById('cancel-delete-btn').addEventListener('click', () => UI.hideModal('delete-confirm-modal'));
document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
    if (!museumToDelete || !museumToDelete.id) return;
    await FB.deleteMuseum(museumToDelete.id);
    UI.hideModal('delete-confirm-modal');
});
document.getElementById('back-to-dashboard-btn').addEventListener('click', goBackToDashboard);
document.getElementById('publish-btn').addEventListener('click', publishMuseum);
document.getElementById('add-painting-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('image-file');
    const file = fileInput.files[0];
    if (!file || !activePaintingIntersect) {
        UI.showMessage("Por favor, selecciona una imagen.", 'error');
        return;
    }
    const addButton = document.getElementById('add-painting-btn');
    addButton.disabled = true;
    addButton.textContent = 'Procesando...';
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Data = e.target.result;
        try {
            const imageId = await FB.saveImage(base64Data);
            const paintingGroup = await placePainting(base64Data, activePaintingIntersect, { imageId });
            
            let parentRoom = null;
            let currentObject = activePaintingIntersect.object;
            while (currentObject) {
                if (roomGroups.includes(currentObject)) {
                    parentRoom = currentObject;
                    break;
                }
                currentObject = currentObject.parent;
            }

            if (parentRoom) {
                parentRoom.userData.artworks.push(paintingGroup);
                paintingGroup.userData.room = parentRoom;
            } else {
                console.warn("Could not find parent room for new painting.");
            }

            await saveMuseumToDB();
            UI.hideModal('painting-modal');
            isInteractingWithUI = false;
            fileInput.value = '';
        } catch (error) {
            console.error(error);
            UI.showMessage("Hubo un problema al guardar tu imagen.", 'error');
        } finally {
            addButton.disabled = false;
            addButton.textContent = 'Añadir';
        }
    };
    reader.readAsDataURL(file);
});
document.getElementById('save-painting-btn').addEventListener('click', async () => {
    if (currentEditingPainting) {
        currentEditingPainting.userData.infoText = document.getElementById('info-text').value;
        updateInfoText(currentEditingPainting);
        await saveMuseumToDB();
        UI.hideModal('edit-painting-modal');
        isInteractingWithUI = false;
    }
});
document.getElementById('delete-painting-btn').addEventListener('click', async () => {
    if (currentEditingPainting) {
        if (currentEditingPainting.userData.infoTextMesh) {
            const textMesh = currentEditingPainting.userData.infoTextMesh;
            const textObjectIndex = objects.indexOf(textMesh);
            if (textObjectIndex > -1) objects.splice(textObjectIndex, 1);
            textMesh.removeFromParent();
        }
        
        const parentRoom = currentEditingPainting.userData.room;
        if (parentRoom && parentRoom.userData.artworks) {
            const index = parentRoom.userData.artworks.indexOf(currentEditingPainting);
            if (index > -1) {
                parentRoom.userData.artworks.splice(index, 1);
            }
        }

        if(currentEditingPainting.userData.imageId) {
            try {
                await FB.deleteImage(currentEditingPainting.userData.imageId);
            } catch(e) {
                console.error("Failed to delete image from DB", e);
                UI.showMessage("Error al eliminar la imagen de la base de datos.", 'error');
            }
        }
        
        const objectIndex = objects.indexOf(currentEditingPainting);
        if (objectIndex > -1) objects.splice(objectIndex, 1);
        currentEditingPainting.removeFromParent();
        
        currentEditingPainting = null;
        
        UI.hideModal('edit-painting-modal');
        isInteractingWithUI = false;
        await saveMuseumToDB();
    }
});
document.getElementById('cancel-painting-btn').addEventListener('click', () => { UI.hideModal('painting-modal'); isInteractingWithUI = false; });
document.getElementById('cancel-edit-btn').addEventListener('click', () => { UI.hideModal('edit-painting-modal'); isInteractingWithUI = false; });
document.getElementById('close-publish-modal-btn').addEventListener('click', () => UI.hideModal('publish-modal'));
document.getElementById('copy-url-btn').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('publish-url').value); UI.showMessage("Enlace copiado!"); });
UI.setupTextureSelectors(textureUrls, textureNames, (key, type) => {
    if (type === 'floor') {
        currentFloorTextureName = key;
        updateFloorTexture();
    } else {
        currentWallTextureName = key;
        updateWallTexture();
    }
    UI.updateTextureSelectorUI(currentFloorTextureName, currentWallTextureName);
    saveMuseumToDB();
});
function updateFloorTexture() {
    const newTexture = textureCache[currentFloorTextureName];
    scene.traverse(child => {
        if (child.isMesh && (child.isFloor || child.isCeiling)) {
            child.material.map = newTexture;
            child.material.needsUpdate = true;
        }
    });
}
function updateWallTexture() {
    const newTexture = textureCache[currentWallTextureName];
    scene.traverse(child => {
        if (child.isMesh && child.isWall) {
            child.material.map = newTexture;
            child.material.needsUpdate = true;
        }
    });
}
UI.setupMusicSelector(musicList,
    (key, button) => { // onPreview
        const playIcon = button.querySelector('.play-icon');
        const pauseIcon = button.querySelector('.pause-icon');

        if (currentPreview.key === key && !previewAudio.paused) {
            previewAudio.pause();
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            currentPreview.key = null;
            currentPreview.button = null;
        } else {
            if (currentPreview.button && currentPreview.button !== button) {
                currentPreview.button.querySelector('.play-icon').classList.remove('hidden');
                currentPreview.button.querySelector('.pause-icon').classList.add('hidden');
            }

            previewAudio.src = musicList[key].url;
            previewAudio.play();
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            currentPreview.key = key;
            currentPreview.button = button;
        }
    },
    (key) => { // onSelect
        currentMusicKey = key;
        UI.updateMusicSelectorUI(key);
        saveMuseumToDB();
    }
);
document.getElementById('music-toggle-btn').addEventListener('click', () => {
    if (backgroundAudio.paused) {
        backgroundAudio.play();
        updateMusicButtonIcon(false);
    } else {
        backgroundAudio.pause();
        updateMusicButtonIcon(true);
    }
});
function updateMusicButtonIcon(isMuted) {
    const btn = document.getElementById('music-toggle-btn');
    btn.innerHTML = isMuted ? 
        `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .89-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l-4-4m0 4l4-4"></path></svg>` : 
        `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .89-1.077 1.337-1.707.707L5.586 15z"></path></svg>`;
}

// --- INITIALIZE APP ---
checkViewerMode();

