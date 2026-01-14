const { ipcRenderer } = require('electron');
const path = require('path');

// Импорт Firebase
const { 
    auth, db, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile, 
    onAuthStateChanged,
    doc, setDoc, getDoc, updateDoc, arrayUnion, collection, query, orderBy, limit, getDocs, where,
    addDoc, deleteDoc
} = require('./firebase');

// ========== КОНФИГУРАЦИЯ ==========
const GAMES_PER_PAGE = 20;
let currentPage = 1;
let allStoreGames = [];
let filteredGames = [];
let gamesByName = {};
let allSources = [];
let selectedSourceIndex = 0;
let selectedGameId = null;
let currentDownloadGame = null;

// ========== ДАННЫЕ (LOCAL STORAGE) ==========
let gameTags = JSON.parse(localStorage.getItem('gameTags')) || {};
let favoriteGames = JSON.parse(localStorage.getItem('favoriteGames')) || [];
let libraryGames = JSON.parse(localStorage.getItem('libraryGames')) || [];
let installedGames = JSON.parse(localStorage.getItem('installedGames')) || {};
let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory')) || [];
// ВАЖНО: Эта переменная была пропущена
let activeDownloads = JSON.parse(localStorage.getItem('activeDownloads')) || {}; 
let customThemes = [];
let currentThemeId = 'dark';
let editingThemeId = null;
let activeProcesses = {}; 

// ========== ФИЛЬТРЫ ==========
let currentSort = 'name-asc';
let currentSourceFilter = 'all';
let currentStatusFilter = 'all';
let isGridView = localStorage.getItem('isGridView') === 'true';

// ========== СИСТЕМА ТЕМ (ДЕФОЛТНЫЕ) ==========
const defaultThemes = [
    { id: 'dark', name: 'Тёмная', isDefault: true, colors: { 'bg-primary': '#0f0f1a', 'bg-secondary': '#1a1a2e', 'bg-tertiary': '#25253d', 'accent': '#6c5ce7', 'text-primary': '#ffffff', 'text-secondary': '#a0a0b0', 'border': '#2d2d44', 'card-bg': '#1e1e32' } },
    { id: 'light', name: 'Светлая', isDefault: true, colors: { 'bg-primary': '#f5f5f7', 'bg-secondary': '#ffffff', 'bg-tertiary': '#e8e8ed', 'accent': '#6c5ce7', 'text-primary': '#1a1a2e', 'text-secondary': '#5c5c6c', 'border': '#d5d5dd', 'card-bg': '#ffffff' } }
];

// Тестовые данные
const defaultStoreGames = [
    {
        id: 'standrise',
        title: "StandRise",
        price: "Бесплатно",
        isFree: true,
        description: "StandRise — захватывающая многопользовательская игра",
        size: "~2 GB",
        cover: "", 
        isTorrent: false
    }
];

// ========== ИНИЦИАЛИЗАЦИЯ ==========

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Запуск инициализации...');

    await loadThemes();
    await loadGamesFromJson();
    await checkInstalledGames();
    await initGamesPathSettings();
    
    renderLibraryGames();
    renderAchievements();
    renderDownloadHistory();
    
    // Восстановление загрузок
    restoreDownloads();
    
    initEventListeners();
    initContextMenu();
    initGameSettingsModal();
    initDownloadModal();
    initGameDetailModal();
    initSearch();
    initFilters();
    initAutoUpdater();
    initHistory();
    initThemeEditor();
    initAuth();
    
    updateStoreStats();
    
    setTimeout(() => processCoverQueue(), 2000);
    
    console.log('Инициализация завершена!');
});

// ========== ФУНКЦИИ ДАННЫХ ==========

function addDownloadHistory(entry) {
    downloadHistory.unshift(entry);
    downloadHistory = downloadHistory.slice(0, 200);
    localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
}

function getTagsForGame(gameKey) {
    return gameTags[gameKey] || [];
}

function setTagsForGame(gameKey, tags) {
    gameTags[gameKey] = tags;
    localStorage.setItem('gameTags', JSON.stringify(gameTags));
}

function toggleFavorite(gameId) {
    const index = favoriteGames.indexOf(gameId);
    if (index === -1) {
        favoriteGames.push(gameId);
        showNotification('Добавлено в избранное ⭐');
    } else {
        favoriteGames.splice(index, 1);
        showNotification('Удалено из избранного');
    }
    localStorage.setItem('favoriteGames', JSON.stringify(favoriteGames));
    renderStoreGames();
}

function isFavorite(gameId) {
    return favoriteGames.includes(gameId);
}

function saveDownloadState(game, status) {
    if (status === 'finished') {
        delete activeDownloads[game.id];
    } else {
        activeDownloads[game.id] = {
            ...game,
            status: status || 'downloading',
            progress: activeDownloads[game.id]?.progress || 0
        };
    }
    localStorage.setItem('activeDownloads', JSON.stringify(activeDownloads));
}

// ========== ЗАГРУЗКА ИГР ==========

let coverQueue = [];
let isCoverSearchRunning = false;

async function loadGamesFromJson() {
    try {
        const container = document.getElementById('store-games');
        if (container) container.innerHTML = '<div class="loading-games"><div class="loading-spinner"></div><span>Загрузка игр...</span></div>';
        
        const namesDB = await ipcRenderer.invoke('load-games-names') || {};
        allSources = await ipcRenderer.invoke('load-all-sources');
        
        if (!allSources || allSources.length === 0) {
            allSources = [{ id: 'default', name: 'Default', downloads: [] }];
            allStoreGames = [...defaultStoreGames];
            filteredGames = [...allStoreGames];
            if (container) container.innerHTML = '';
            renderStoreGames();
            return;
        }
        
        gamesByName = {};
        
        for (const source of allSources) {
            if (!source.downloads) continue;
            for (const game of source.downloads) {
                const rawTitle = extractGameName(game.title);
                const normName = rawTitle.toLowerCase().trim();
                const versionMatch = game.title.match(/v\.?([\d.]+[a-z]?\d*)/i);
                const version = versionMatch ? versionMatch[1] : '';
                
                const savedInfo = namesDB[rawTitle];
                const cover = savedInfo ? savedInfo.cover : '';

                const gameObj = {
                    sourceId: source.id,
                    sourceName: source.name,
                    title: rawTitle,
                    fullTitle: game.title,
                    version: version,
                    cover: cover,
                    price: 'Бесплатно',
                    isFree: true,
                    size: game.fileSize,
                    magnetUri: game.uris?.find(u => u.startsWith('magnet:')) || game.uris?.[0],
                    folderName: rawTitle.replace(/[<>:"/\\|?*]/g, ''),
                    isTorrent: true
                };

                if (!cover && !coverQueue.includes(rawTitle)) {
                    coverQueue.push(rawTitle);
                }

                if (!gameObj.magnetUri && game.uris?.[0] && game.uris[0].startsWith('http')) {
                    gameObj.isTorrent = false;
                    gameObj.downloadUrl = game.uris[0];
                    gameObj.fileName = `${gameObj.folderName}.zip`;
                }
                
                if (!gamesByName[normName]) gamesByName[normName] = { name: rawTitle, sources: [] };
                if (!gamesByName[normName].sources.find(s => s.sourceId === source.id)) {
                    gamesByName[normName].sources.push(gameObj);
                }
            }
        }
        
        let idx = 0;
        allStoreGames = Object.values(gamesByName).map(group => {
            const first = group.sources[0];
            return {
                id: `game-${idx++}`,
                title: group.name,
                cover: first.cover,
                price: 'Бесплатно',
                isFree: true,
                size: first.size,
                isTorrent: first.isTorrent,
                sources: group.sources,
                sourceCount: group.sources.length
            };
        });
        
        allStoreGames.sort((a, b) => a.title.localeCompare(b.title));
        filteredGames = [...allStoreGames];
        
        if (container) container.innerHTML = '';
        renderStoreGames();
        renderPagination();
        updateStoreStats();
        fillSourceOptions();
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
    }
}

function extractGameName(title) {
    return title.replace(/\s*v\.?[\d.]+[a-z]?\d*/gi, '')
                .replace(/\s*\[.*?\]/g, '')
                .replace(/\s*\(.*?\)/g, '')
                .replace(/\s*-\s*$/, '')
                .trim() || title.split(' ')[0];
}

async function processCoverQueue() {
    if (isCoverSearchRunning) return;
    isCoverSearchRunning = true;
    
    while (coverQueue.length > 0) {
        const title = coverQueue.shift();
        try {
            const url = await ipcRenderer.invoke('search-game-cover', title);
            if (url) {
                const imgs = document.querySelectorAll(`img[alt="${title}"]`);
                imgs.forEach(img => {
                    img.src = url;
                    img.onerror = null;
                });
                const game = allStoreGames.find(g => g.title === title);
                if (game) game.cover = url;
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1500));
    }
    isCoverSearchRunning = false;
}

// ========== РЕНДЕР (МАГАЗИН) ==========

function renderStoreGames() {
    const container = document.getElementById('store-games');
    if (!container) return;

    const start = (currentPage - 1) * GAMES_PER_PAGE;
    const end = start + GAMES_PER_PAGE;
    const games = filteredGames.slice(start, end);

    if (games.length === 0) {
        container.innerHTML = '<div class="loading-games"><span>Игры не найдены</span></div>';
        return;
    }

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'%3E%3Crect width='300' height='400' fill='%232a2a2a'/%3E%3C/svg%3E";

    container.innerHTML = games.map(game => {
        const isInstalled = installedGames[game.id]?.installed;
        const hasMultiple = game.sourceCount > 1;
        const sourceName = game.sources?.[0]?.sourceName || 'Unknown';
        const tooltip = hasMultiple ? `${game.sourceCount} источника` : `Источник: ${sourceName}`;
        
        return `
            <div class="game-card store-game" data-game-id="${game.id}" title="${tooltip}">
                <button class="favorite-btn ${isFavorite(game.id) ? 'active' : ''}" data-game-id="${game.id}">
                    <i class="${isFavorite(game.id) ? 'ri-star-fill' : 'ri-star-line'}"></i>
                </button>
                <img class="game-cover" src="${game.cover || placeholder}" onerror="this.onerror=null;this.src='${placeholder}'" alt="${game.title}">
                <div class="game-info">
                    <div class="game-title">${game.title}</div>
                    <div class="game-meta">
                        <span class="game-size">${game.size || ''}</span>
                        <span class="game-source"><i class="ri-database-2-line"></i> ${hasMultiple ? `${game.sourceCount} ист.` : sourceName}</span>
                    </div>
                </div>
                <div class="game-card-right">
                    ${isInstalled ? '<span class="game-status installed">Установлено</span>' : ''}
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.store-game').forEach(card => {
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.favorite-btn')) openGameDetail(card.dataset.gameId);
        });
    });

    container.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(btn.dataset.gameId);
        });
    });
}

function renderPagination() {
    const container = document.getElementById('pagination');
    if (!container) return;
    const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `
        <button class="page-btn" onclick="changePage(1)" ${currentPage===1?'disabled':''}><i class="ri-arrow-left-double-line"></i></button>
        <button class="page-btn" onclick="changePage(${currentPage-1})" ${currentPage===1?'disabled':''}><i class="ri-arrow-left-s-line"></i></button>
        <span class="page-info">${currentPage} из ${totalPages}</span>
        <button class="page-btn" onclick="changePage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}><i class="ri-arrow-right-s-line"></i></button>
        <button class="page-btn" onclick="changePage(${totalPages})" ${currentPage===totalPages?'disabled':''}><i class="ri-arrow-right-double-line"></i></button>
    `;
    container.innerHTML = html;
    
    const btns = container.querySelectorAll('.page-btn');
    if (btns[0]) btns[0].onclick = () => changePage(1);
    if (btns[1]) btns[1].onclick = () => changePage(currentPage - 1);
    if (btns[2]) btns[2].onclick = () => changePage(currentPage + 1);
    if (btns[3]) btns[3].onclick = () => changePage(totalPages);
}

function changePage(page) {
    const total = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
    if (page < 1 || page > total) return;
    currentPage = page;
    renderStoreGames();
    renderPagination();
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========== БИБЛИОТЕКА ==========

function renderLibraryGames() {
    const container = document.getElementById('library-games');
    const emptyState = document.getElementById('empty-library');
    if (!container) return;

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'%3E%3Crect width='300' height='400' fill='%232a2a2a'/%3E%3C/svg%3E";

    let html = `<div class="game-card add-game-card" id="add-game-card"><div class="add-game-content"><i class="ri-add-line"></i><span>Добавить</span></div></div>`;

    if (libraryGames.length > 0) {
        if (emptyState) emptyState.style.display = 'none';
        html += libraryGames.map(game => {
            const playtime = Math.floor((game.playtime || 0) / 60) + 'ч';
            const isInstalled = game.installed !== false;
            
            const tags = getTagsForGame(String(game.storeId || game.id));
            const tagsHtml = tags.length ? `<div class="tags-row">${tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>` : '';

            return `
                <div class="game-card library-game ${!isInstalled ? 'not-installed' : ''}" data-id="${game.id}">
                    <div class="game-cover-wrapper">
                        <img class="game-cover" src="${game.cover || placeholder}" onerror="this.onerror=null;this.src='${placeholder}'" alt="${game.title}">
                    </div>
                    <div class="game-info">
                        <div class="game-title">${game.title}</div>
                        ${tagsHtml}
                        <div class="game-meta">
                            ${game.sourceName ? `<span class="game-source"><i class="ri-database-2-line"></i> ${game.sourceName}</span>` : ''}
                            <div class="game-playtime"><i class="ri-time-line"></i> ${playtime}</div>
                        </div>
                    </div>
                    <div class="game-card-right">
                        ${!isInstalled ? '<span class="game-status not-installed-badge">Не установлено</span>' : ''}
                        
                        ${isInstalled ? `
                            <button class="play-btn" data-game-id="${game.id}">
                                <i class="ri-play-fill"></i> Играть
                            </button>
                        ` : `
                            <button class="play-btn install-btn" data-game-id="${game.id}">
                                <i class="ri-download-line"></i> Установить
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        if (emptyState) emptyState.style.display = 'flex';
    }
    
    container.innerHTML = html;
    
    document.getElementById('add-game-card')?.addEventListener('click', quickAddGame);
    
    container.querySelectorAll('.play-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            let id = btn.dataset.gameId;
            const numId = Number(id);
            if (libraryGames.some(g => g.id === numId)) {
                id = numId;
            }

            if (btn.classList.contains('install-btn')) installFromLibrary(id);
            else launchGame(id);
        });
    });

    container.querySelectorAll('.library-game').forEach(card => {
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, parseInt(card.dataset.id));
        });
    });
    
    restoreActiveButtons();
}

// ========== ФИЛЬТРЫ ==========

function initFilters() {
    initCustomSelect('sort-dropdown', (value) => { currentSort = value; applyFiltersAndSort(); });
    initCustomSelect('source-dropdown', (value) => { currentSourceFilter = value; applyFiltersAndSort(); });
    initCustomSelect('status-dropdown', (value) => { currentStatusFilter = value; applyFiltersAndSort(); });
    fillSourceOptions();

    const viewList = document.getElementById('view-list');
    const viewGrid = document.getElementById('view-grid');
    const gamesGrid = document.getElementById('store-games');

    function setView(isGrid) {
        isGridView = isGrid;
        localStorage.setItem('isGridView', isGrid);
        if (isGrid) {
            viewGrid?.classList.add('active');
            viewList?.classList.remove('active');
            gamesGrid?.classList.add('grid-view');
        } else {
            viewList?.classList.add('active');
            viewGrid?.classList.remove('active');
            gamesGrid?.classList.remove('grid-view');
        }
    }

    viewList?.addEventListener('click', () => setView(false));
    viewGrid?.addEventListener('click', () => setView(true));
    setView(isGridView);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select')) document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });
}

function initCustomSelect(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    const trigger = el.querySelector('.custom-select-trigger');
    const options = el.querySelectorAll('.custom-option');

    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-select.open').forEach(s => { if (s !== el) s.classList.remove('open'); });
        el.classList.toggle('open');
    });

    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            const span = trigger.querySelector('span');
            if (span) span.textContent = opt.textContent.trim();
            el.classList.remove('open');
            if (onChange) onChange(opt.dataset.value);
        });
    });
}

function fillSourceOptions() {
    const c = document.getElementById('source-options');
    if (!c || !allSources.length) return;
    c.innerHTML = `<div class="custom-option active" data-value="all"><i class="ri-apps-line"></i> Все источники</div>${allSources.map(s => `<div class="custom-option" data-value="${s.id}"><i class="ri-server-line"></i> ${s.name}</div>`).join('')}`;
    
    const select = document.getElementById('source-dropdown');
    const trigger = select.querySelector('.custom-select-trigger');
    c.querySelectorAll('.custom-option').forEach(opt => {
        opt.addEventListener('click', () => {
            c.querySelectorAll('.custom-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            if (trigger.querySelector('span')) trigger.querySelector('span').textContent = opt.textContent.trim();
            select.classList.remove('open');
            currentSourceFilter = opt.dataset.value;
            applyFiltersAndSort();
        });
    });
}

function applyFiltersAndSort() {
    let games = [...allStoreGames];
    if (currentSourceFilter !== 'all') games = games.filter(g => g.sources.some(s => s.sourceId === currentSourceFilter));
    if (currentStatusFilter === 'installed') games = games.filter(g => installedGames[g.id]?.installed);
    else if (currentStatusFilter === 'not-installed') games = games.filter(g => !installedGames[g.id]?.installed);
    else if (currentStatusFilter === 'favorites') games = games.filter(g => isFavorite(g.id));

    const query = document.getElementById('search-input')?.value.toLowerCase().trim();
    if (query) games = games.filter(g => g.title.toLowerCase().includes(query));

    games.sort((a, b) => {
        switch (currentSort) {
            case 'name-asc': return a.title.localeCompare(b.title);
            case 'name-desc': return b.title.localeCompare(a.title);
            case 'size-asc': return parseSize(a.size) - parseSize(b.size);
            case 'size-desc': return parseSize(b.size) - parseSize(a.size);
            case 'sources-desc': return (b.sourceCount || 1) - (a.sourceCount || 1);
            default: return 0;
        }
    });

    filteredGames = games;
    currentPage = 1;
    renderStoreGames();
    renderPagination();
    const total = document.getElementById('total-games-count');
    if (total) total.textContent = filteredGames.length === allStoreGames.length ? allStoreGames.length : `${filteredGames.length} / ${allStoreGames.length}`;
}

function parseSize(s) {
    if (!s) return 0;
    const m = s.match(/([\d.]+)\s*(GB|MB|TB)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = m[2].toUpperCase();
    if (u === 'TB') return n * 1024 * 1024;
    if (u === 'GB') return n * 1024;
    return n;
}

// ========== СКАЧИВАНИЕ И УСТАНОВКА ==========

function initDownloadModal() {
    document.getElementById('cancel-download-btn')?.addEventListener('click', () => {
        if (confirm('Отменить скачивание?')) {
            if (currentDownloadGame) ipcRenderer.send('cancel-download', currentDownloadGame.id);
            closeDownloadModal();
        }
    });

    ipcRenderer.on('download-progress', (e, data) => {
        // Обновляем модальное окно (если открыто)
        const fill = document.getElementById('progress-fill');
        const percent = document.getElementById('progress-percent');
        const status = document.getElementById('download-status');
        
        if (fill) fill.style.width = data.progress + '%';
        if (percent) percent.textContent = Math.round(data.progress) + '%';
        if (status && data.status === 'extracting') status.textContent = 'Распаковка архива...';

        // Обновляем карточку во вкладке "Загрузки"
        const barItem = document.getElementById(`dl-bar-${data.gameId}`);
        const percentItem = document.getElementById(`dl-percent-${data.gameId}`);
        const infoItem = document.getElementById(`dl-info-${data.gameId}`);
        
        if (barItem) barItem.style.width = data.progress + '%';
        if (percentItem) percentItem.textContent = Math.round(data.progress) + '%';
        if (infoItem && data.speed) infoItem.textContent = `${data.speed} • ${data.downloadedMB} / ${data.totalMB} MB`;

        if (activeDownloads[data.gameId] && Math.random() > 0.9) {
            activeDownloads[data.gameId].progress = data.progress;
            localStorage.setItem('activeDownloads', JSON.stringify(activeDownloads));
        }
    });

    ipcRenderer.on('download-complete', (e, d) => handleDownloadComplete(d));
    ipcRenderer.on('download-error', (e, err) => alert('Ошибка скачивания: ' + err));
}

function startDownload(game) {
    currentDownloadGame = game;
    saveDownloadState(game, 'downloading');
    renderDownloadItem(game, 'Подготовка...');
    switchToTab('downloads');
    ipcRenderer.send('download-game', { url: game.downloadUrl, fileName: game.fileName, gameFolderName: game.folderName });
}

function startTorrentDownload(game) {
    currentDownloadGame = game;
    saveDownloadState(game, 'downloading');
    renderDownloadItem(game, 'Подключение к пирам...');
    switchToTab('downloads');
    ipcRenderer.send('download-torrent', { magnetUri: game.magnetUri, gameFolderName: game.folderName, gameId: game.id });
}

function renderDownloadItem(game, statusText) {
    const list = document.getElementById('downloads-list');
    if (list.querySelector('.empty-state')) list.innerHTML = '';
    let item = document.getElementById(`dl-item-${game.id}`);
    if (item) return;

    const html = `
        <div class="download-item" id="dl-item-${game.id}">
            <div class="download-header">
                <span class="download-title">${game.title}</span>
                <span class="download-status" id="dl-status-${game.id}">${statusText}</span>
            </div>
            <div class="download-progress-track">
                <div class="download-progress-bar" id="dl-bar-${game.id}" style="width: 0%"></div>
            </div>
            <div class="download-meta">
                <span id="dl-percent-${game.id}">0%</span>
                <span id="dl-info-${game.id}">-- MB/s</span>
            </div>
            <div class="dl-controls">
                <button class="btn btn-sm btn-pause" onclick="toggleDownloadState('${game.id}', 'pause')"><i class="ri-pause-line"></i></button>
                <button class="btn btn-sm btn-resume" onclick="toggleDownloadState('${game.id}', 'resume')"><i class="ri-play-line"></i></button>
                <button class="btn btn-sm btn-secondary" onclick="cancelDownload('${game.id}')"><i class="ri-close-line"></i></button>
            </div>
        </div>
    `;
    list.insertAdjacentHTML('afterbegin', html);
    document.getElementById('nav-download-badge').style.display = 'inline-block';
}

function toggleDownloadState(id, action) {
    const item = document.getElementById(`dl-item-${id}`);
    const statusEl = document.getElementById(`dl-status-${id}`);
    const gameData = activeDownloads[id];
    if (!gameData) return;

    if (action === 'pause') {
        ipcRenderer.send('pause-download', id);
        item.classList.add('paused');
        if (statusEl) statusEl.textContent = 'Пауза';
        saveDownloadState(gameData, 'paused');
    } else if (action === 'resume') {
        ipcRenderer.send('resume-download', id);
        item.classList.remove('paused');
        if (statusEl) statusEl.textContent = 'Возобновление...';
        saveDownloadState(gameData, 'downloading');
    }
}

function cancelDownload(id) {
    if (confirm('Отменить загрузку?')) {
        ipcRenderer.send('cancel-download', id);
        const item = document.getElementById(`dl-item-${id}`);
        if(item) item.remove();
        
        saveDownloadState({id}, 'finished'); // Удаляем из стораджа
        if (Object.keys(activeDownloads).length === 0) {
            document.getElementById('downloads-list').innerHTML = '<div class="empty-state">Нет активных загрузок</div>';
            document.getElementById('nav-download-badge').style.display = 'none';
        }
    }
}

function openDownloadModal(game) {
    // В новой версии используем вкладку "Загрузки", но можно оставить модалку
    // document.getElementById('download-game-title').textContent = game.title;
    // document.getElementById('download-modal').classList.add('active');
}

function closeDownloadModal() {
    document.getElementById('download-modal').classList.remove('active');
    currentDownloadGame = null;
}

function handleDownloadComplete(data) {
    if (!data.success) return;
    
    // Пытаемся найти игру в активных загрузках
    let game = activeDownloads[data.gameId];
    if (!game) game = currentDownloadGame || {};
    
    // Формируем объект для библиотеки
    const libGame = {
        id: Date.now(),
        storeId: game.id || data.gameId,
        title: game.title || path.basename(data.gamePath),
        path: data.exePath,
        cover: game.cover,
        installed: true
    };
    
    const existing = libraryGames.find(g => g.storeId === libGame.storeId);
    if (existing) {
        existing.path = data.exePath;
        existing.installed = true;
    } else {
        libraryGames.push(libGame);
    }
    
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    renderLibraryGames();
    
    addDownloadHistory({ title: libGame.title, date: Date.now() });
    renderAchievements();
    renderDownloadHistory();
    
    // Удаляем из активных загрузок
    saveDownloadState({id: data.gameId}, 'finished');
    const item = document.getElementById(`dl-item-${data.gameId}`);
    if(item) item.remove();
    
    showNotification(`${libGame.title} установлена!`);
}

// ========== ДЕТАЛИ ИГРЫ ==========

function openGameDetail(gameId) {
    const game = allStoreGames.find(g => g.id === gameId);
    if (!game) return;

    selectedGameId = gameId;
    selectedSourceIndex = 0;

    const modal = document.getElementById('game-detail-modal');
    modal.style.display = 'flex'; // Хард ресет для открытия
    
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 280'%3E%3Crect fill='%231a1a2e' width='600' height='280'/%3E%3Ctext fill='%234a4a5a' font-size='80' x='300' y='160' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";
    const coverImg = document.getElementById('detail-game-cover');
    // Безопасная установка src
    if (coverImg) {
        coverImg.src = game.cover || placeholder;
        coverImg.onerror = function() { this.onerror = null; this.src = placeholder; };
    }
    
    document.getElementById('detail-game-title').textContent = game.title;
    
    // Источники
    let sourcesHTML = '';
    if (game.sources && game.sources.length > 1) {
        sourcesHTML = `<div class="source-selector"><label><i class="ri-database-2-line"></i> Источник:</label><div class="source-options">
            ${game.sources.map((s, i) => `<div class="source-option ${i===0?'active':''}" data-index="${i}"><div class="source-option-header"><span class="source-name">${s.sourceName}</span><span class="source-size">${s.size || '?'}</span></div></div>`).join('')}
        </div></div>`;
    }
    
    const src = game.sources ? game.sources[0] : game;
    document.getElementById('detail-game-description').innerHTML = `${sourcesHTML}
        <div class="game-details-info">
            <div class="detail-row"><span class="detail-label">Размер:</span><span class="detail-value" id="detail-size">${src.size || '?'}</span></div>
            <div class="detail-row"><span class="detail-label">Тип:</span><span class="detail-value">Торрент 🧲</span></div>
        </div>
        <div id="screenshots-container" class="screenshots-grid"><div style="text-align:center;color:#666">Загрузка скриншотов...</div></div>`;

    setTimeout(() => {
        document.querySelectorAll('.source-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.source-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                selectedSourceIndex = parseInt(opt.dataset.index);
                const s = game.sources[selectedSourceIndex];
                document.getElementById('detail-size').textContent = s.size || '?';
                updateInstallButtonSource(s.sourceName);
            });
        });
    }, 50);

    loadScreenshots(game.title);
    updateInstallButtonSource(src.sourceName);
    updateGameDetailButtons();
    setTimeout(() => modal.classList.add('active'), 10);
}

async function loadScreenshots(title) {
    const cleanTitle = extractGameName(title);
    const images = await ipcRenderer.invoke('get-game-screenshots', cleanTitle);
    const container = document.getElementById('screenshots-container');
    if (!container) return;
    if (images && images.length > 0) {
        container.innerHTML = images.map(url => `<img src="${url}" class="screenshot-item" onclick="window.open('${url}', '_blank')">`).join('');
    } else {
        container.innerHTML = '<div style="text-align:center;color:#666">Скриншоты не найдены</div>';
    }
}

function updateInstallButtonSource(name) {
    const btn = document.getElementById('detail-install-btn');
    if (btn) btn.innerHTML = `<i class="ri-download-line"></i> Установить <span class="btn-source">из ${name}</span>`;
}

function updateGameDetailButtons() {
    const isInstalled = installedGames[selectedGameId]?.installed;
    const btnInstall = document.getElementById('detail-install-btn');
    const btnPlay = document.getElementById('detail-play-btn');
    if (isInstalled) {
        btnInstall.style.display = 'none';
        btnPlay.style.display = 'inline-flex';
    } else {
        btnInstall.style.display = 'inline-flex';
        btnPlay.style.display = 'none';
    }
}

// ========== ЛОГИКА ОКНА "ПОДРОБНЕЕ" ==========

function initGameDetailModal() {
    const modal = document.getElementById('game-detail-modal');
    const closeBtn = document.getElementById('game-detail-close');

    if (closeBtn) closeBtn.onclick = () => closeGameDetail();
    
    // Кнопка "Установить"
    const installBtn = document.getElementById('detail-install-btn');
    if (installBtn) {
        installBtn.onclick = () => {
            const game = allStoreGames.find(g => g.id === selectedGameId);
            if (!game) return;
            const src = game.sources ? game.sources[selectedSourceIndex] : game;
            closeGameDetail();
            const dlGame = { ...game, ...src };
            if (dlGame.isTorrent) startTorrentDownload(dlGame);
            else startDownload(dlGame);
        };
    }
    
    // Кнопка "В библиотеку"
    const libBtn = document.getElementById('detail-add-library-btn');
    if (libBtn) {
        libBtn.onclick = () => {
            const game = allStoreGames.find(g => g.id === selectedGameId);
            const src = game.sources ? game.sources[selectedSourceIndex] : game;
            addToLibraryWithoutInstall(game, src);
        };
    }
    
    // Кнопка "Играть"
    const playBtn = document.getElementById('detail-play-btn');
    if (playBtn) {
        playBtn.onclick = () => {
            const info = installedGames[selectedGameId];
            if (info?.path) launchGame(selectedGameId); 
        };
    }
    
    // Кнопка "Удалить"
    const uninstallBtn = document.getElementById('detail-uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.onclick = async () => {
            if(confirm('Удалить игру с диска?')) {
                const info = installedGames[selectedGameId];
                if(info?.folder) await ipcRenderer.invoke('uninstall-game', info.folder);
                installedGames[selectedGameId] = { installed: false };
                localStorage.setItem('installedGames', JSON.stringify(installedGames));
                const libGame = libraryGames.find(g => g.storeId === selectedGameId);
                if(libGame) { libGame.installed = false; libGame.path = ''; }
                localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
                renderStoreGames();
                renderLibraryGames();
                closeGameDetail();
                showNotification('Игра удалена');
            }
        };
    }
}

function closeGameDetail() {
    const modal = document.getElementById('game-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
    selectedGameId = null;
    const container = document.getElementById('screenshots-container');
    if(container) container.innerHTML = ''; 
}

// ========== НАСТРОЙКИ (ПУТЬ И ПРОЧЕЕ) ==========

function initGameSettingsModal() {
    const modal = document.getElementById('game-settings-modal');
    document.getElementById('settings-modal-close')?.addEventListener('click', closeGameSettings);
    document.getElementById('cancel-settings-btn')?.addEventListener('click', closeGameSettings);
    document.getElementById('save-settings-btn')?.addEventListener('click', saveGameSettings);
    document.getElementById('delete-game-btn')?.addEventListener('click', () => deleteGame(selectedGameId));
    
    document.getElementById('edit-browse-btn')?.addEventListener('click', async () => {
        const p = await ipcRenderer.invoke('select-game-exe');
        if(p) { document.getElementById('edit-game-path').value = p; updateSettingsPreview(); }
    });
    
    document.getElementById('edit-cover-browse-btn')?.addEventListener('click', async () => {
        const p = await ipcRenderer.invoke('select-image');
        if(p) { document.getElementById('edit-game-cover').value = p; updateSettingsPreview(); }
    });
    
    document.getElementById('edit-game-name')?.addEventListener('input', updateSettingsPreview);
    document.getElementById('edit-game-cover')?.addEventListener('input', updateSettingsPreview);
}

function saveGameSettings() {
    const name = document.getElementById('edit-game-name').value;
    const gamePath = document.getElementById('edit-game-path').value;
    const cover = document.getElementById('edit-game-cover').value;
    const launchParams = document.getElementById('edit-launch-params').value;
    
    const tagsRaw = document.getElementById('edit-game-tags').value || '';
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
    setTagsForGame(String(selectedGameId), tags);

    if (!name) return alert('Укажите название!');

    const idx = libraryGames.findIndex(g => g.id === selectedGameId);
    if (idx !== -1) {
        libraryGames[idx] = { ...libraryGames[idx], title: name, path: gamePath, cover, launchParams };
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        closeGameSettings();
    }
}

function closeGameSettings() {
    document.getElementById('game-settings-modal').classList.remove('active');
    selectedGameId = null;
}

function deleteGame(gameId) {
    if (confirm('Удалить из библиотеки?')) {
        libraryGames = libraryGames.filter(g => g.id !== gameId);
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        closeGameSettings();
    }
}

function updateSettingsPreview() {
    document.getElementById('preview-game-name').textContent = document.getElementById('edit-game-name').value || 'Название';
    const cover = document.getElementById('edit-game-cover').value;
    const img = document.getElementById('preview-cover-img');
    if (cover) { img.src = cover; img.parentElement.classList.add('has-image'); }
    else { img.src = ''; img.parentElement.classList.remove('has-image'); }
}

async function initGamesPathSettings() {
    const s = await ipcRenderer.invoke('get-settings');
    const el = document.getElementById('games-path');
    if (el) el.textContent = s?.gamesPath || 'C:\\Games';
    
    const btn = document.getElementById('change-path-btn');
    if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            const newPath = await ipcRenderer.invoke('set-games-path');
            if (newPath) { el.textContent = newPath; showNotification('Папка обновлена'); }
        });
    }
}

// ========== ОСТАЛЬНОЕ ==========

function switchToTab(sectionId) {
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
    });

    const btn = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (btn) btn.classList.add('active');

    const activeSection = document.getElementById(sectionId);
    if (activeSection) {
        activeSection.style.display = 'block';
        activeSection.classList.add('active');
        
        // Меняем заголовок
        const titleEl = document.querySelector('.page-title');
        if (titleEl && btn) {
            titleEl.textContent = btn.querySelector('span').textContent;
        }
    }
}

function initEventListeners() {
    document.getElementById('minimize-btn')?.addEventListener('click', () => ipcRenderer.send('minimize-window'));
    document.getElementById('maximize-btn')?.addEventListener('click', () => ipcRenderer.send('maximize-window'));
    document.getElementById('close-btn')?.addEventListener('click', () => ipcRenderer.send('close-window'));

    // ========== НАВИГАЦИЯ (ИСПРАВЛЕННАЯ) ==========
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('.content-section');
    const pageTitle = document.querySelector('.page-title'); // <--- Находим заголовок

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // 1. Убираем active у всех
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            // 2. Ставим active нажатой
            item.classList.add('active');

            const sectionId = item.dataset.section;
            
            // 3. Меняем заголовок сверху (БЕЗОПАСНО)
            if (pageTitle) {
                // Ищем текст внутри кнопки (любой текст, не только span)
                // Или берем свой текст для каждой секции
                const textSpan = item.querySelector('span');
                if (textSpan) {
                    pageTitle.textContent = textSpan.textContent;
                } else {
                    // Если span нет (например, кнопка "Мне повезёт"), берем весь текст
                    pageTitle.textContent = item.innerText.trim();
                }
            }

            // 4. Переключаем секции
            sections.forEach(sec => {
                sec.style.display = 'none';
                sec.classList.remove('active');
            });

            const activeSection = document.getElementById(sectionId);
            if (activeSection) {
                activeSection.style.display = 'block';
                activeSection.classList.add('active');
                
                // Специфичные обновления
                if (sectionId === 'store' && typeof updateHeroBanner === 'function') updateHeroBanner();
                if (sectionId === 'community' && typeof loadLeaderboard === 'function') {
                    loadLeaderboard();
                    loadFriends();
                }
            }
        });
    });
    
    // ========== КНОПКА "МНЕ ПОВЕЗЁТ" ==========
    const randomBtn = document.getElementById('random-game-btn');
    if (randomBtn) {
        // Клонируем, чтобы удалить старые обработчики (если были)
        const newBtn = randomBtn.cloneNode(true);
        if (randomBtn.parentNode) {
            randomBtn.parentNode.replaceChild(newBtn, randomBtn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Если игры не загрузились
                if (!allStoreGames || allStoreGames.length === 0) {
                    return showNotification('Игры еще не загружены');
                }

                const randomGame = allStoreGames[Math.floor(Math.random() * allStoreGames.length)];
                showNotification(`🎲 ${randomGame.title}...`);
                
                // Открываем игру
                if (typeof openGameDetail === 'function') {
                    openGameDetail(randomGame.id);
                }
            });
        }
    }
    
    // ========== РУЧНОЕ ДОБАВЛЕНИЕ ==========
    const addModal = document.getElementById('add-game-modal');
    document.getElementById('add-game-btn')?.addEventListener('click', () => addModal?.classList.add('active'));
    document.getElementById('modal-close')?.addEventListener('click', () => addModal?.classList.remove('active'));
    document.getElementById('cancel-btn')?.addEventListener('click', () => addModal?.classList.remove('active'));
    
    // Выбор файла
    document.getElementById('browse-btn')?.addEventListener('click', async () => {
        const p = await ipcRenderer.invoke('select-game-exe');
        if(p) {
            const pathInput = document.getElementById('game-path');
            const nameInput = document.getElementById('game-name');
            if (pathInput) pathInput.value = p;
            if (nameInput && !nameInput.value) {
                nameInput.value = path.basename(p, '.exe');
            }
        }
    });
    
    // Сохранение
    document.getElementById('save-game-btn')?.addEventListener('click', () => {
        const name = document.getElementById('game-name').value;
        const p = document.getElementById('game-path').value;
        const cover = document.getElementById('game-cover')?.value || '';

        if(!name || !p) return alert('Заполните поля');
        
        libraryGames.push({ 
            id: Date.now(), 
            title: name, 
            path: p, 
            cover: cover,
            installed: true 
        });
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        addModal?.classList.remove('active');
        showNotification('Игра добавлена!');
    });
    
    // ========== АВТОРИЗАЦИЯ ==========
    document.getElementById('add-friend-btn')?.addEventListener('click', () => {
        if (typeof sendFriendRequest === 'function') sendFriendRequest();
        else addFriend(); // Старая версия
    });
}

function initSearch() {
    const input = document.getElementById('search-input');
    input?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        filteredGames = allStoreGames.filter(g => g.title.toLowerCase().includes(q));
        renderStoreGames();
    });
}

function initContextMenu() {
    document.addEventListener('click', () => document.getElementById('context-menu').classList.remove('active'));
    document.getElementById('ctx-play')?.addEventListener('click', () => launchGame(selectedGameId));
    document.getElementById('ctx-settings')?.addEventListener('click', () => openGameSettings(selectedGameId));
    document.getElementById('ctx-delete')?.addEventListener('click', () => deleteGame(selectedGameId));
}

function showContextMenu(e, id) {
    selectedGameId = id;
    const menu = document.getElementById('context-menu');
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.classList.add('active');
}

function initAutoUpdater() {
    document.getElementById('check-updates-btn')?.addEventListener('click', () => {
        ipcRenderer.send('check-for-updates');
        showNotification('Проверка обновлений...');
    });
    ipcRenderer.on('update-available', () => document.getElementById('update-notification').classList.add('show'));
}

async function loadThemes() {
    const data = await ipcRenderer.invoke('load-themes');
    if(data) { customThemes = data.customThemes || []; currentThemeId = data.currentThemeId || 'dark'; }
    applyTheme(currentThemeId);
}

function applyTheme(id) {
    const t = defaultThemes.find(x => x.id === id) || customThemes.find(x => x.id === id) || defaultThemes[0];
    const root = document.documentElement;
    Object.entries(t.colors).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
    currentThemeId = id;
    ipcRenderer.invoke('save-themes', { customThemes, currentThemeId });
}

function initThemeEditor() { /* Редактор тем */ }

function launchGame(id) {
    const game = libraryGames.find(x => x.id == id); // Нестрогое сравнение
    
    if (activeProcesses[id]) {
        if (confirm(`Остановить игру ${game?.title || ''}?`)) {
            ipcRenderer.send('stop-game', id);
        }
        return;
    }

    if (!game) return console.error('Игра не найдена:', id);
    if (!game.path) return alert('Путь к игре не найден. Проверьте настройки игры.');
    
    setGameButtonState(id, 'stop');
    activeProcesses[id] = true;

    game.lastPlayed = Date.now();
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    
    ipcRenderer.send('launch-game', { command: `"${game.path}"`, gameId: game.id });
    showNotification(`Запуск ${game.title}...`);
}

function setGameButtonState(gameId, state) {
    const btns = document.querySelectorAll(`.play-btn[data-game-id="${gameId}"]`);
    btns.forEach(btn => {
        if (!btn) return;
        if (state === 'stop') {
            btn.classList.add('stop-btn');
            btn.innerHTML = '<i class="ri-stop-fill"></i>';
            btn.title = 'Остановить игру';
        } else {
            btn.classList.remove('stop-btn');
            btn.innerHTML = '<i class="ri-play-fill"></i> Играть';
            btn.title = '';
        }
    });
}

function quickAddGame() {
    document.getElementById('add-game-modal')?.classList.add('active');
}

function formatPlaytimeShort(m) { return m < 60 ? (m + ' мин') : (Math.floor(m/60) + ' ч'); }
function getPlaytimeClass(m) { return m < 60 ? 'low-time' : 'high-time'; }
function formatDate(ts) { return new Date(ts).toLocaleDateString(); }
function formatGameName(f) { return f.replace('.exe', ''); }

// ========== АВТОРИЗАЦИЯ И ОНЛАЙН ==========

// ========== СИСТЕМА ДРУЗЕЙ (ЗАПРОСЫ) ==========

// 1. Отправка запроса
async function sendFriendRequest() {
    if (!auth.currentUser) return alert('Войдите в аккаунт!');
    const nickname = document.getElementById('friend-name-input').value.trim();
    if (!nickname) return;

    try {
        // Ищем пользователя
        const q = query(collection(db, "users"), where("name", "==", nickname));
        const snapshot = await getDocs(q);

        if (snapshot.empty) return showNotification('Игрок не найден ❌');

        let targetUserId = null;
        snapshot.forEach(doc => targetUserId = doc.id);

        if (targetUserId === auth.currentUser.uid) return showNotification('Нельзя добавить себя');

        // Проверяем, не друзья ли уже
        // (Тут можно добавить проверку, но для простоты пропустим)

        // Создаем запрос в коллекции "requests"
        await addDoc(collection(db, "friend_requests"), {
            fromId: auth.currentUser.uid,
            fromName: auth.currentUser.displayName,
            toId: targetUserId,
            status: "pending",
            timestamp: Date.now()
        });

        showNotification(`Запрос отправлен ${nickname}! 📩`);
        document.getElementById('friend-name-input').value = '';

    } catch (e) {
        console.error(e);
        showNotification('Ошибка отправки');
    }
}

// 2. Загрузка входящих запросов
async function loadFriendRequests() {
    if (!auth.currentUser) return;
    const container = document.getElementById('friend-requests-container');
    const list = document.getElementById('friend-requests-list');

    try {
        // Ищем запросы, где "toId" == наш ID
        const q = query(collection(db, "friend_requests"), where("toId", "==", auth.currentUser.uid));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        list.innerHTML = '';

        snapshot.forEach(docSnap => {
            const req = docSnap.data();
            const div = document.createElement('div');
            div.className = 'request-item';
            div.innerHTML = `
                <div class="request-info">
                    <div class="user-avatar-small">${req.fromName[0]}</div>
                    <span>${req.fromName}</span>
                </div>
                <div class="request-actions">
                    <button class="req-btn req-accept" title="Принять"><i class="ri-check-line"></i></button>
                    <button class="req-btn req-reject" title="Отклонить"><i class="ri-close-line"></i></button>
                </div>
            `;
            
            // Обработчики кнопок
            div.querySelector('.req-accept').onclick = () => acceptFriendRequest(docSnap.id, req);
            div.querySelector('.req-reject').onclick = () => rejectFriendRequest(docSnap.id);
            
            list.appendChild(div);
        });

    } catch (e) { console.error(e); }
}

// 3. Принятие запроса
async function acceptFriendRequest(requestId, reqData) {
    try {
        const myId = auth.currentUser.uid;
        const myName = auth.currentUser.displayName || "Игрок"; // Важно имя!
        
        const friendId = reqData.fromId;
        const friendName = reqData.fromName;

        console.log(`Принимаем дружбу: ${myName} <-> ${friendName}`);

        // 1. Добавляем друга МНЕ (в мой список)
        const myRef = doc(db, "users", myId);
        await updateDoc(myRef, {
            friends: arrayUnion({ uid: friendId, name: friendName })
        });

        // 2. Добавляем МЕНЯ другу (в его список)
        const friendRef = doc(db, "users", friendId);
        await updateDoc(friendRef, {
            friends: arrayUnion({ uid: myId, name: myName })
        });

        // 3. Удаляем запрос
        await deleteDoc(doc(db, "friend_requests", requestId));

        showNotification(`Вы и ${friendName} теперь друзья! 🤝`);
        
        loadFriendRequests();
        loadFriends(); // Обновить мой список

    } catch (e) { 
        console.error("Ошибка принятия дружбы:", e);
        showNotification('Ошибка при добавлении');
    }
}

async function rejectFriendRequest(requestId) {
    try {
        await deleteDoc(doc(db, "friend_requests", requestId));
        loadFriendRequests();
        showNotification('Запрос отклонен');
    } catch (e) {}
}

function initAuth() {
    const loginBtn = document.getElementById('login-btn');
    const modal = document.getElementById('auth-modal');
    const closeBtn = document.getElementById('auth-close');
    const switchBtn = document.getElementById('auth-switch-btn');
    const submitBtn = document.getElementById('auth-submit-btn');
    let isRegistering = false;

    loginBtn?.addEventListener('click', () => {
        if (auth.currentUser) signOut(auth).then(() => showNotification('Вы вышли'));
        else modal.classList.add('active');
    });

    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));

    switchBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        isRegistering = !isRegistering;
        document.getElementById('auth-title').textContent = isRegistering ? 'Регистрация' : 'Вход';
        submitBtn.textContent = isRegistering ? 'Создать аккаунт' : 'Войти';
        document.getElementById('auth-name-group').style.display = isRegistering ? 'block' : 'none';
    });

    submitBtn?.addEventListener('click', async () => {
        const email = document.getElementById('auth-email').value;
        const pass = document.getElementById('auth-password').value;
        const name = document.getElementById('auth-name').value;
        if(!email || !pass) return alert('Заполните поля');
        try {
            if(isRegistering) {
                const res = await createUserWithEmailAndPassword(auth, email, pass);
                await updateProfile(res.user, { displayName: name });
                showNotification(`Добро пожаловать, ${name}!`);
            } else {
                const res = await signInWithEmailAndPassword(auth, email, pass);
                showNotification(`С возвращением, ${res.user.displayName}!`);
            }
            modal.classList.remove('active');
        } catch(e) { alert('Ошибка: ' + e.message); }
    });

    auth.onAuthStateChanged((user) => {
        const nameEl = document.getElementById('user-name');
        const avaEl = document.getElementById('user-avatar');
        if(user) {
            nameEl.textContent = user.displayName || 'Игрок';
            const url = `https://ui-avatars.com/api/?name=${nameEl.textContent}&background=6c5ce7&color=fff`;
            avaEl.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%">`;
            loginBtn.textContent = "Выйти";
            // Синхронизация при входе
            syncUserStats();
        } else {
            nameEl.textContent = "Гость";
            avaEl.innerHTML = `<i class="ri-user-fill"></i>`;
            loginBtn.textContent = "Войти";
        }

        loginBtn.textContent = "Выйти";
    
        // ЗАГРУЖАЕМ ЗАПРОСЫ
        loadFriendRequests();
        loadFriends();
        
        // Можно поставить интервал (раз в 10 сек проверять запросы)
        setInterval(loadFriendRequests, 10000);
    });
}

// Синхронизация статистики
async function syncUserStats() {
    if (!auth.currentUser) return;
    const totalMinutes = libraryGames.reduce((acc, g) => acc + (g.playtime || 0), 0);
    const userRef = doc(db, "users", auth.currentUser.uid);
    try {
        await setDoc(userRef, {
            name: auth.currentUser.displayName || "Игрок",
            email: auth.currentUser.email,
            playtime: totalMinutes,
            lastActive: Date.now()
        }, { merge: true });
    } catch (e) { console.error(e); }
}

// Лидерборд
async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    try {
        const q = query(collection(db, "users"), orderBy("playtime", "desc"), limit(20));
        const querySnapshot = await getDocs(q);
        let html = '';
        let rank = 1;
        querySnapshot.forEach((doc) => {
            const user = doc.data();
            const hours = Math.floor(user.playtime / 60);
            html += `<div class="leaderboard-item"><div class="rank top-${rank}">${rank}</div><div class="user-info"><div class="user-avatar-small">${user.name[0].toUpperCase()}</div><span>${user.name}</span></div><div class="playtime-badge">${hours} ч.</div></div>`;
            rank++;
        });
        list.innerHTML = html || 'Список пуст';
    } catch (e) { list.innerHTML = 'Ошибка загрузки'; }
}

async function addFriend() {
    if (!auth.currentUser) return alert('Войдите в аккаунт!');
    const email = document.getElementById('friend-email-input').value.trim();
    if (!email) return;
    try {
        const q = query(collection(db, "users"), where("email", "==", email));
        const snap = await getDocs(q);
        if (snap.empty) return showNotification('Не найден ❌');
        
        let friendId, friendName;
        snap.forEach(d => { friendId = d.id; friendName = d.data().name; });
        if (friendId === auth.currentUser.uid) return showNotification('Это вы!');
        
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            friends: arrayUnion({ uid: friendId, name: friendName, email: email })
        });
        showNotification(`Друг ${friendName} добавлен!`);
        loadFriends();
        document.getElementById('friend-email-input').value = '';
    } catch (e) { showNotification('Ошибка'); }
}

async function loadFriends() {
    if (!auth.currentUser) return;
    const list = document.getElementById('friends-list');
    try {
        const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (snap.exists()) {
            const friends = snap.data().friends || [];
            list.innerHTML = friends.map(f => `<div class="friend-item"><div class="user-avatar-small">${f.name[0]}</div><span class="friend-name">${f.name}</span></div>`).join('');
        }
    } catch (e) {}
}

// IPC LISTENERS
ipcRenderer.on('game-error', (e, err) => alert('Ошибка: ' + err));
ipcRenderer.on('game-closed', (e, d) => {
    // Восстанавливаем кнопки
    delete activeProcesses[d.gameId];
    setGameButtonState(d.gameId, 'play');
    
    const game = libraryGames.find(g => g.id === d.gameId);
    if(game) {
        game.playtime = (game.playtime || 0) + d.playTime;
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        showNotification(`Время в игре: +${d.playTime} мин`);
        syncUserStats(); // Синхронизация с облаком
    }
    
    // Восстанавливаем кнопки других запущенных игр
    restoreActiveButtons();
});

function restoreActiveButtons() {
    Object.keys(activeProcesses).forEach(id => {
        setGameButtonState(id, 'stop');
    });
}

function restoreDownloads() {
    const list = document.getElementById('downloads-list');
    const downloads = Object.values(activeDownloads);
    
    if (downloads.length === 0) {
        list.innerHTML = '<div class="empty-state">Нет активных загрузок</div>';
        return;
    }
    
    list.innerHTML = ''; // Очищаем заглушку

    downloads.forEach(game => {
        // Рендерим карточку
        renderDownloadItem(game, game.status === 'paused' ? 'Пауза' : 'Восстановление...');
        
        const item = document.getElementById(`dl-item-${game.id}`);
        const bar = document.getElementById(`dl-bar-${game.id}`);
        
        // Восстанавливаем прогресс визуально
        if (bar) bar.style.width = (game.progress || 0) + '%';
        
        // Если была пауза - применяем стиль
        if (game.status === 'paused') {
            item.classList.add('paused');
            // Не запускаем торрент, просто показываем
        } else {
            // Если была активна - перезапускаем торрент
            ipcRenderer.send('resume-download', game.id);
        }
    });
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ПРОПУЩЕННЫЕ) ==========

function showNotification(msg) {
    // Удаляем старое, если есть
    const old = document.getElementById('notification');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = 'notification';
    div.className = 'notification show';
    div.innerHTML = `<i class="ri-information-fill"></i> <span>${msg}</span>`;
    
    document.body.appendChild(div);
    
    // Автоскрытие через 3 секунды
    setTimeout(() => {
        div.classList.remove('show');
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function updateStoreStats() {
    const totalEl = document.getElementById('total-games-count');
    const sourceEl = document.getElementById('games-source');
    const installedEl = document.getElementById('installed-games-count');
    
    if (totalEl) totalEl.textContent = allStoreGames.length;
    
    if (sourceEl) {
        const sourceNames = allSources.map(s => s.name).join(', ');
        sourceEl.textContent = allSources.length > 1 
            ? `${allSources.length} источника` 
            : (allSources[0]?.name || 'Нет источников');
        sourceEl.title = sourceNames;
    }
    
    if (installedEl) {
        const installedCount = Object.values(installedGames).filter(g => g.installed).length;
        installedEl.textContent = installedCount;
    }
}

async function checkInstalledGames() {
    // 1. Библиотека
    for (const game of libraryGames) {
        if (game.path) {
            game.installed = await ipcRenderer.invoke('fs-exists', game.path);
        } else {
            game.installed = false;
        }
    }
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));

    // 2. Магазин
    for (const game of allStoreGames) {
        const libGame = libraryGames.find(g => g.storeId === game.id);
        
        if (libGame && libGame.installed) {
            installedGames[game.id] = { installed: true };
        } else {
            // ВАЖНО: Проверяем, есть ли folderName
            if (game.folderName) {
                const res = await ipcRenderer.invoke('check-game-installed', game.folderName, game.exeName || '');
                installedGames[game.id] = res;
            } else {
                installedGames[game.id] = { installed: false };
            }
        }
    }
    localStorage.setItem('installedGames', JSON.stringify(installedGames));
}

// ========== ИСТОРИЯ И ДОСТИЖЕНИЯ (Вставь в конец renderer.js) ==========

function renderDownloadHistory() {
    const el = document.getElementById('download-history');
    if (!el) return;

    if (!downloadHistory || !downloadHistory.length) {
        el.innerHTML = '<div class="setting-desc">История пуста</div>';
        return;
    }

    el.innerHTML = downloadHistory.map(h => `
        <div style="padding:10px; border-bottom:1px solid var(--border);">
            <div style="font-weight:600; font-size:13px; color: var(--text-primary);">${h.title}</div>
            <div class="setting-desc" style="font-size:11px;">
                ${h.sourceName ? `Источник: ${h.sourceName} • ` : ''}
                ${new Date(h.date).toLocaleDateString()}
            </div>
        </div>
    `).join('');
}

function calcAchievements() {
    const totalDownloads = downloadHistory.length;
    // Безопасный подсчет времени
    const totalMinutes = libraryGames.reduce((acc, g) => acc + (Number(g.playtime) || 0), 0);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalLibrary = libraryGames.length;

    const list = [
        { id: 'dl1',  name: 'Первая игра', ok: totalDownloads >= 1,  desc: 'Скачать 1 игру' },
        { id: 'dl10', name: 'Коллекционер', ok: totalDownloads >= 10, desc: 'Скачать 10 игр' },
        { id: 'lib5', name: 'Библиотекарь', ok: totalLibrary >= 5, desc: '5 игр в библиотеке' },
        { id: 'h10',  name: 'Геймер',       ok: totalHours >= 10,     desc: '10 часов в игре' },
        { id: 'h100', name: 'Легенда',       ok: totalHours >= 100,    desc: '100 часов в игре' }
    ];

    return { totalDownloads, totalHours, list };
}

function renderAchievements() {
    const el = document.getElementById('achievements');
    if (!el) return;

    const a = calcAchievements();

    el.innerHTML = `
        <div class="setting-desc" style="margin-bottom:15px">
            Скачиваний: <b>${a.totalDownloads}</b> • Часов: <b>${a.totalHours}</b>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px">
            ${a.list.map(x => `
                <div style="padding:12px; background:var(--bg-tertiary); border-radius:8px; display:flex; justify-content:space-between; align-items:center; border: 1px solid var(--border);">
                    <div>
                        <div style="font-weight:600; font-size:13px; color: ${x.ok ? 'var(--text-primary)' : 'var(--text-muted)'}">${x.name}</div>
                        <div style="font-size:11px; color:var(--text-muted)">${x.desc}</div>
                    </div>
                    <div style="font-weight:bold; font-size:16px;">
                        ${x.ok ? '✅' : '🔒'}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function initHistory() {
    document.getElementById('clear-history-btn')?.addEventListener('click', () => {
        if(confirm('Очистить историю?')) {
            downloadHistory = [];
            localStorage.setItem('downloadHistory', '[]');
            renderDownloadHistory();
            renderAchievements();
        }
    });
}