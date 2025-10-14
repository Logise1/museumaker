const views = {
    auth: document.getElementById('auth-container'),
    dashboard: document.getElementById('dashboard-container'),
    app: document.getElementById('app-container')
};

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
    }
}

function showModal(modalId) { document.getElementById(modalId).classList.remove('hidden'); }
function hideModal(modalId) { document.getElementById(modalId).classList.add('hidden'); }

function showMessage(message, type = 'success') {
    const box = document.createElement('div');
    box.textContent = message;
    box.className = `fixed top-5 left-1/2 -translate-x-1/2 p-3 px-5 rounded-lg text-white shadow-lg z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
}

function createTextureItem(key, name, url, type, onClick) {
    const item = document.createElement('div');
    item.className = 'cursor-pointer p-1 border-2 border-transparent rounded-md';
    item.dataset.textureName = key;
    item.dataset.type = type;
    const preview = document.createElement('div');
    preview.className = 'w-full h-12 rounded bg-cover bg-center';
    preview.style.backgroundImage = `url(${url})`;
    const label = document.createElement('p');
    label.className = 'text-xs text-center text-slate-600 mt-1 truncate';
    label.textContent = name;
    item.appendChild(preview);
    item.appendChild(label);
    item.addEventListener('click', () => onClick(key, type));
    return item;
}

function setupTextureSelectors(textureUrls, textureNames, onSelect) {
    const floorSelector = document.getElementById('floor-texture-selector');
    const wallSelector = document.getElementById('wall-texture-selector');
    floorSelector.innerHTML = '';
    wallSelector.innerHTML = '';
    for (const key in textureUrls) {
        floorSelector.appendChild(createTextureItem(key, textureNames[key], textureUrls[key], 'floor', onSelect));
        wallSelector.appendChild(createTextureItem(key, textureNames[key], textureUrls[key], 'wall', onSelect));
    }
}

function updateTextureSelectorUI(floorTexture, wallTexture) {
    document.querySelectorAll('#floor-texture-selector > div').forEach(el => {
        el.classList.toggle('border-indigo-500', el.dataset.textureName === floorTexture);
    });
    document.querySelectorAll('#wall-texture-selector > div').forEach(el => {
        el.classList.toggle('border-indigo-500', el.dataset.textureName === wallTexture);
    });
}

function setupMusicSelector(musicList, onPreview, onSelect) {
    const container = document.getElementById('music-selector');
    container.innerHTML = '';
    for (const key in musicList) {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2 rounded-md hover:bg-gray-100';
        item.innerHTML = `
            <div class="flex items-center gap-3">
                <button data-key="${key}" class="play-preview-btn flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200">
                    <svg class="play-icon w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"></path></svg>
                    <svg class="pause-icon w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z"></path></svg>
                </button>
                <span data-key="${key}" class="select-music-btn cursor-pointer font-medium text-sm text-slate-700">${musicList[key].name}</span>
            </div>
        `;
        container.appendChild(item);
    }
    container.querySelectorAll('.play-preview-btn').forEach(btn => btn.addEventListener('click', (e) => onPreview(e.currentTarget.dataset.key, e.currentTarget)));
    container.querySelectorAll('.select-music-btn').forEach(span => span.addEventListener('click', (e) => onSelect(e.currentTarget.dataset.key)));
}


function updateMusicSelectorUI(musicKey) {
    document.querySelectorAll('#music-selector .select-music-btn').forEach(el => {
        el.classList.toggle('text-indigo-600', el.dataset.key === musicKey);
        el.classList.toggle('font-bold', el.dataset.key === musicKey);
    });
}


async function showFocusView(paintingGroup, getImageFunc, isViewer) {
    const imageEl = document.getElementById('focus-image');
    const textEl = document.getElementById('focus-text');
    const infoPanel = document.getElementById('focus-info');

    imageEl.src = 'https://placehold.co/800x600/f1f5f9/94a3b8?text=Cargando...';
    textEl.textContent = paintingGroup.userData.infoText || "No hay información disponible para esta obra.";

    infoPanel.classList.toggle('hidden', !isViewer);

    showModal('focus-view-modal');

    const imageUrl = await getImageFunc(paintingGroup.userData.imageId);
    if (imageUrl) {
        imageEl.src = imageUrl;
    } else {
        imageEl.src = 'https://placehold.co/800x600/fee2e2/ef4444?text=Error+al+cargar';
    }
}

function hideFocusView() {
    hideModal('focus-view-modal');
}

export {
    showView,
    showModal,
    hideModal,
    showMessage,
    setupTextureSelectors,
    updateTextureSelectorUI,
    setupMusicSelector,
    updateMusicSelectorUI,
    showFocusView,
    hideFocusView
};
