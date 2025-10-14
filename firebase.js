import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, serverTimestamp, get } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

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
let currentUser = null;

onAuthStateChanged(auth, user => {
    currentUser = user;
});

const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password);
const logout = () => signOut(auth);

const createNewMuseum = async (name) => {
    if (!currentUser) return null;
    const newMuseumRef = push(ref(db, `museums`));
    const museumId = newMuseumRef.key;
    const initialData = {
        owner: currentUser.uid,
        name: name,
        createdAt: serverTimestamp(),
        isPublic: false,
        data: {
            rooms: [{
                position: { x: 0, y: 0, z: 0 },
                openings: [],
                width: 20,
                depth: 20,
                height: 10,
                artworks: []
            }],
            settings: {
                floorTexture: 'marble',
                wallTexture: 'wood',
                musicUrl: null
            }
        }
    };
    await set(newMuseumRef, initialData);
    await set(ref(db, `users/${currentUser.uid}/museums/${museumId}`), { name });
    return { museumId, name };
};

const deleteMuseum = async (id) => {
    if (!currentUser) return;

    const museumRef = ref(db, `museums/${id}`);
    const snapshot = await get(museumRef);
    if (snapshot.exists()) {
        const museumData = snapshot.val().data;
        if (museumData && museumData.rooms) {
            const imageDeletionPromises = [];
            for (const room of museumData.rooms) {
                if (room.artworks) {
                    for (const artwork of room.artworks) {
                        if (artwork.imageId) {
                            imageDeletionPromises.push(remove(ref(db, `images/${artwork.imageId}`)));
                        }
                    }
                }
            }
            await Promise.all(imageDeletionPromises);
        }
    }

    await remove(ref(db, `museums/${id}`));
    await remove(ref(db, `users/${currentUser.uid}/museums/${id}`));
};

const publishMuseum = async (id) => {
    if (!id) return;
    await set(ref(db, `museums/${id}/isPublic`), true);
};

const saveMuseumData = (id, data) => {
    if (!id) return;
    return set(ref(db, `museums/${id}/data`), data);
};

const listenToMuseumData = (id, callback) => {
    const museumRef = ref(db, `museums/${id}`);
    return onValue(museumRef, callback);
};

const listenToUserMuseums = (callback) => {
    if (!currentUser) return () => {};
    const museumsRef = ref(db, `users/${currentUser.uid}/museums`);
    return onValue(museumsRef, callback);
};

const getImageDataUrl = async (imageId) => {
    if (!imageId) return null;
    try {
        const imageRef = ref(db, `images/${imageId}`);
        const snapshot = await get(imageRef);
        if (snapshot.exists()) {
            return snapshot.val();
        } else {
            console.warn(`Image with ID ${imageId} not found in database.`);
            return null;
        }
    } catch (error) {
        console.error(`Failed to fetch image ${imageId}:`, error);
        return null;
    }
};

const saveImage = async (base64Data) => {
    const newImageRef = push(ref(db, 'images'));
    const imageId = newImageRef.key;
    await set(newImageRef, base64Data);
    return imageId;
};

const deleteImage = async (imageId) => {
    if (!imageId) return;
    return remove(ref(db, `images/${imageId}`));
};


export {
    auth,
    onAuthStateChanged,
    login,
    signup,
    logout,
    createNewMuseum,
    deleteMuseum,
    publishMuseum,
    saveMuseumData,
    listenToMuseumData,
    listenToUserMuseums,
    getImageDataUrl,
    saveImage,
    deleteImage
};
