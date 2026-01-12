const { ipcRenderer } = require('electron');
const path = require('path');

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
let customThemes = [];
let currentThemeId = 'dark';
let editingThemeId = null;

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
    
    initEventListeners();
    initContextMenu();
    initGameSettingsModal();
    initDownloadModal(); // Теперь эта функция точно есть ниже!
    initGameDetailModal();
    initSearch();
    initFilters();
    initAutoUpdater();
    initHistory();
    initThemeEditor();
    
    updateStoreStats();
    
    // Запуск поиска обложек
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
    console.log(`Запуск поиска обложек. В очереди: ${coverQueue.length}`);
    
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

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect fill='%2325253d' width='80' height='80'/%3E%3Ctext fill='%234a4a5a' font-size='30' x='40' y='50' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";

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

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect fill='%2325253d' width='80' height='80'/%3E%3Ctext fill='%234a4a5a' font-size='30' x='40' y='50' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";

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
                    <img class="game-cover" src="${game.cover || placeholder}" onerror="this.onerror=null;this.src='${placeholder}'" alt="${game.title}">
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
                        <button class="play-btn ${!isInstalled ? 'install-btn' : ''}" data-game-id="${game.id}">
                            ${!isInstalled ? '<i class="ri-download-line"></i>' : '<i class="ri-play-fill"></i>'}
                        </button>
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
            const id = parseInt(btn.dataset.gameId);
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

    ipcRenderer.on('download-progress', (e, d) => {
        document.getElementById('progress-fill').style.width = d.progress + '%';
        document.getElementById('progress-percent').textContent = d.progress + '%';
        if(d.status === 'extracting') document.getElementById('download-status').textContent = 'Распаковка...';
    });

    ipcRenderer.on('download-complete', (e, d) => handleDownloadComplete(d));
    ipcRenderer.on('download-error', (e, err) => alert('Ошибка скачивания: ' + err));
}

function startDownload(game) {
    currentDownloadGame = game;
    openDownloadModal(game);
    ipcRenderer.send('download-game', { url: game.downloadUrl, fileName: game.fileName, gameFolderName: game.folderName });
}

function startTorrentDownload(game) {
    currentDownloadGame = game;
    openDownloadModal(game);
    ipcRenderer.send('download-torrent', { magnetUri: game.magnetUri, gameFolderName: game.folderName, gameId: game.id });
}

function openDownloadModal(game) {
    document.getElementById('download-game-title').textContent = game.title;
    document.getElementById('download-status').textContent = 'Подключение...';
    document.getElementById('download-modal').classList.add('active');
}

function closeDownloadModal() {
    document.getElementById('download-modal').classList.remove('active');
    currentDownloadGame = null;
}

function handleDownloadComplete(data) {
    if (!data.success) return;
    
    let title = "Игра";
    let storeId = null;
    let cover = "";
    
    if (currentDownloadGame) {
        title = currentDownloadGame.title;
        storeId = currentDownloadGame.id;
        cover = currentDownloadGame.cover;
    }
    
    const libGame = {
        id: Date.now(),
        storeId: storeId,
        title: title,
        path: data.exePath,
        folder: data.gamePath,
        cover: cover,
        installed: true
    };
    
    const existing = libraryGames.find(g => g.storeId === storeId);
    if (existing) {
        existing.path = data.exePath;
        existing.installed = true;
    } else {
        libraryGames.push(libGame);
    }
    
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    renderLibraryGames();
    
    addDownloadHistory({ title, date: Date.now() });
    renderAchievements();
    renderDownloadHistory();
    
    closeDownloadModal();
    alert(`${title} установлена!`);
}

// ========== ДЕТАЛИ ИГРЫ ==========

function openGameDetail(gameId) {
    const game = allStoreGames.find(g => g.id === gameId);
    if (!game) return;

    selectedGameId = gameId;
    selectedSourceIndex = 0;

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 280'%3E%3Crect fill='%231a1a2e' width='600' height='280'/%3E%3Ctext fill='%234a4a5a' font-size='80' x='300' y='160' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";
    const coverImg = document.getElementById('detail-game-cover');
    coverImg.src = game.cover || placeholder;
    coverImg.onerror = function() { this.onerror = null; this.src = placeholder; };
    
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
    document.getElementById('game-detail-modal').classList.add('active');
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

function initGameDetailModal() {
    document.getElementById('game-detail-close')?.addEventListener('click', () => document.getElementById('game-detail-modal').classList.remove('active'));
    
    document.getElementById('detail-install-btn')?.addEventListener('click', () => {
        const game = allStoreGames.find(g => g.id === selectedGameId);
        if (!game) return;
        const src = game.sources ? game.sources[selectedSourceIndex] : game;
        document.getElementById('game-detail-modal').classList.remove('active');
        const dlGame = { ...game, ...src };
        if (dlGame.isTorrent) startTorrentDownload(dlGame);
        else startDownload(dlGame);
    });
    
    document.getElementById('detail-add-library-btn')?.addEventListener('click', () => {
        const game = allStoreGames.find(g => g.id === selectedGameId);
        const src = game.sources ? game.sources[selectedSourceIndex] : game;
        addToLibraryWithoutInstall(game, src);
    });
    
    document.getElementById('detail-play-btn')?.addEventListener('click', () => {
        const info = installedGames[selectedGameId];
        if (info?.path) ipcRenderer.send('launch-game', `"${info.path}"`);
    });
    
    document.getElementById('detail-uninstall-btn')?.addEventListener('click', async () => {
        if(confirm('Удалить игру?')) {
            const info = installedGames[selectedGameId];
            if(info?.folder) await ipcRenderer.invoke('uninstall-game', info.folder);
            installedGames[selectedGameId] = { installed: false };
            localStorage.setItem('installedGames', JSON.stringify(installedGames));
            renderStoreGames();
            renderLibraryGames();
            document.getElementById('game-detail-modal').classList.remove('active');
        }
    });
}

function addToLibraryWithoutInstall(game, src) {
    const exists = libraryGames.find(g => g.storeId === game.id);
    if (exists) return showNotification('Уже в библиотеке');
    libraryGames.push({
        id: Date.now(),
        storeId: game.id,
        title: game.title,
        path: '',
        cover: game.cover,
        installed: false,
        size: src.size,
        magnetUri: src.magnetUri,
        isTorrent: src.isTorrent,
        folderName: src.folderName || game.folderName
    });
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    renderLibraryGames();
    document.getElementById('game-detail-modal').classList.remove('active');
    showNotification('Добавлено в библиотеку');
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
    if (cover) img.src = cover; else img.src = '';
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

function initEventListeners() {
    document.getElementById('minimize-btn')?.addEventListener('click', () => ipcRenderer.send('minimize-window'));
    document.getElementById('maximize-btn')?.addEventListener('click', () => ipcRenderer.send('maximize-window'));
    document.getElementById('close-btn')?.addEventListener('click', () => ipcRenderer.send('close-window'));

    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            sections.forEach(s => {
                s.classList.remove('active');
                if (s.id === item.dataset.section) s.classList.add('active');
            });
        });
    });
    
    const addModal = document.getElementById('add-game-modal');
    document.getElementById('add-game-btn')?.addEventListener('click', () => addModal.classList.add('active'));
    document.getElementById('modal-close')?.addEventListener('click', () => addModal.classList.remove('active'));
    
    document.getElementById('browse-btn')?.addEventListener('click', async () => {
        const p = await ipcRenderer.invoke('select-game-exe');
        if(p) document.getElementById('game-path').value = p;
    });
    
    document.getElementById('save-game-btn')?.addEventListener('click', () => {
        const name = document.getElementById('game-name').value;
        const p = document.getElementById('game-path').value;
        if(!name || !p) return alert('Заполните поля');
        libraryGames.push({ id: Date.now(), title: name, path: p, installed: true });
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        addModal.classList.remove('active');
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
    const g = libraryGames.find(x => x.id === id);
    if(g && g.path) ipcRenderer.send('launch-game', { command: `"${g.path}"`, gameId: id });
}

function quickAddGame() {
    document.getElementById('add-game-modal')?.classList.add('active');
}

function formatPlaytimeShort(m) { return m < 60 ? (m + ' мин') : (Math.floor(m/60) + ' ч'); }
function getPlaytimeClass(m) { return m < 60 ? 'low-time' : 'high-time'; }
function formatGameName(f) { return f.replace('.exe', ''); }

async function checkInstalledGames() {
    for (const game of libraryGames) {
        if (game.path) game.installed = await ipcRenderer.invoke('fs-exists', game.path);
    }
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    
    for (const game of allStoreGames) {
        const libGame = libraryGames.find(g => g.storeId === game.id);
        if (libGame && libGame.installed) installedGames[game.id] = { installed: true };
    }
}

function updateStoreStats() {
    const el = document.getElementById('total-games-count');
    if (el) el.textContent = allStoreGames.length;
}

function renderDownloadHistory() {
    const el = document.getElementById('download-history');
    if (!el) return;
    if (!downloadHistory.length) { el.innerHTML = '<div class="setting-desc">Пусто</div>'; return; }
    el.innerHTML = downloadHistory.map(h => `<div style="padding:8px 0; border-bottom:1px solid var(--border);"><div style="font-weight:600; font-size:13px">${h.title}</div><div class="setting-desc">${new Date(h.date).toLocaleDateString()}</div></div>`).join('');
}

function renderAchievements() {
    const el = document.getElementById('achievements');
    if (!el) return;
    const dlCount = downloadHistory.length;
    el.innerHTML = `<div class="setting-desc" style="margin-bottom:10px">Скачиваний: <b>${dlCount}</b></div><div style="display:flex; flex-direction:column; gap:8px"><div style="padding:10px; background:var(--bg-tertiary); border-radius:8px; display:flex; justify-content:space-between"><span>Первая игра</span><span>${dlCount>=1 ? '✅' : '🔒'}</span></div></div>`;
}

function initHistory() {
    document.getElementById('clear-history-btn')?.addEventListener('click', () => {
        downloadHistory = [];
        localStorage.setItem('downloadHistory', '[]');
        renderDownloadHistory();
        renderAchievements();
    });
}

function showNotification(msg) {
    const div = document.createElement('div');
    div.className = 'notification show';
    div.innerHTML = `<span>${msg}</span>`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// IPC LISTENERS
ipcRenderer.on('game-error', (e, err) => alert('Ошибка: ' + err));
ipcRenderer.on('game-closed', (e, d) => {
    const game = libraryGames.find(g => g.id === d.gameId);
    if(game) {
        game.playtime = (game.playtime || 0) + d.playTime;
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        showNotification(`Время в игре: +${d.playTime} мин`);
    }
});

// Блокировка кнопки "Мне повезёт"
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const btn = document.getElementById('random-game-btn');
        
        if (btn) {
            // 1. Клонируем кнопку (чтобы удалить старые обработчики)
            const newBtn = btn.cloneNode(true);
            
            // 2. Меняем вид НОВОЙ кнопки
            newBtn.style.opacity = '0.5';
            newBtn.style.cursor = 'not-allowed'; // Курсор "запрещено"
            
            // 3. Заменяем старую кнопку на новую
            btn.parentNode.replaceChild(newBtn, btn);
            
            // 4. Вешаем заглушку
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showNotification('🛠️ Функция в разработке');
            });
            
            console.log('Кнопка "Мне повезёт" заблокирована');
        }
    }, 0); // Небольшая задержка, чтобы интерфейс точно прогрузился
});