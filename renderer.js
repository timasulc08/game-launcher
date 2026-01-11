const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// ========== КОНФИГУРАЦИЯ ==========
const GAMES_PER_PAGE = 20;
let currentPage = 1;
let allStoreGames = [];
let filteredGames = [];
let gamesSource = 'Xatab';

// ========== СИСТЕМА ТЕМ ==========

const defaultThemes = [
    {
        id: 'dark',
        name: 'Тёмная',
        isDefault: true,
        colors: {
            'bg-primary': '#0f0f1a',
            'bg-secondary': '#1a1a2e',
            'bg-tertiary': '#25253d',
            'accent': '#6c5ce7',
            'accent-hover': '#5b4cdb',
            'text-primary': '#ffffff',
            'text-secondary': '#a0a0b0',
            'text-muted': '#6c6c7c',
            'border': '#2d2d44',
            'success': '#00d26a',
            'danger': '#ff4757',
            'card-bg': '#1e1e32'
        }
    },
    {
        id: 'light',
        name: 'Светлая',
        isDefault: true,
        colors: {
            'bg-primary': '#f5f5f7',
            'bg-secondary': '#ffffff',
            'bg-tertiary': '#e8e8ed',
            'accent': '#6c5ce7',
            'accent-hover': '#5b4cdb',
            'text-primary': '#1a1a2e',
            'text-secondary': '#5c5c6c',
            'text-muted': '#9c9cac',
            'border': '#d5d5dd',
            'success': '#00b85c',
            'danger': '#e53e4f',
            'card-bg': '#ffffff'
        }
    },
    {
        id: 'purple',
        name: 'Фиолетовая',
        isDefault: true,
        colors: {
            'bg-primary': '#1a0a2e',
            'bg-secondary': '#2d1b4e',
            'bg-tertiary': '#3d2b5e',
            'accent': '#a855f7',
            'accent-hover': '#9333ea',
            'text-primary': '#ffffff',
            'text-secondary': '#c4b5d0',
            'text-muted': '#8b7a9e',
            'border': '#4d3b6e',
            'success': '#22c55e',
            'danger': '#ef4444',
            'card-bg': '#2d1b4e'
        }
    },
    {
        id: 'ocean',
        name: 'Океан',
        isDefault: true,
        colors: {
            'bg-primary': '#0a192f',
            'bg-secondary': '#112240',
            'bg-tertiary': '#1d3a5c',
            'accent': '#00d9ff',
            'accent-hover': '#00b8d9',
            'text-primary': '#e6f1ff',
            'text-secondary': '#8892b0',
            'text-muted': '#5c6b8a',
            'border': '#233554',
            'success': '#00d26a',
            'danger': '#ff6b6b',
            'card-bg': '#112240'
        }
    },
    {
        id: 'sunset',
        name: 'Закат',
        isDefault: true,
        colors: {
            'bg-primary': '#1f1135',
            'bg-secondary': '#2d1f47',
            'bg-tertiary': '#3d2d5a',
            'accent': '#ff6b6b',
            'accent-hover': '#ee5a5a',
            'text-primary': '#ffffff',
            'text-secondary': '#c9b8dc',
            'text-muted': '#8e7aa3',
            'border': '#4a3a66',
            'success': '#4ade80',
            'danger': '#f87171',
            'card-bg': '#2d1f47'
        }
    }
];

let customThemes = [];
let currentThemeId = 'dark';
let editingThemeId = null;

// ========== ИГРЫ ==========

// Резервные игры если нет JSON
const defaultStoreGames = [
    {
        id: 'standrise',
        title: "StandRise",
        cover: "https://cdn4.telesco.pe/file/h79xQH425QthKWAmbuy7ygmF4nbrz9R4Ptn_luLJnaBWtOL6NUa_Hf-6cjv0t-9EZp5VtE3tkVmy3YMhYVRGeP83ge9cfXK9HaakoZf_18xZUnY522W6n8c6v6nxG5z6HetW6G4F1ADMsdASBik40Kt5JR9MaZOW-2ewjEtC8qo581cF-VNYR80bDyNN5Mdd_v4zDA0PcLGfjGruT0PdfdOsaO8M1fRba1Fbmv5szZk8EMHM64gU7rLMDZjnI06ExcPXBnNtZb25areW41KqmErKmIUycBZ0_8E_0Ob7zjCKukwkHObgYBIy_n6NG6u06iR0WEEam0qznS4WDwQM_A.jpg",
        price: "Бесплатно",
        isFree: true,
        description: "StandRise — захватывающая многопользовательская игра",
        downloadUrl: "https://evolution.cdn.risegamings.net/pc/StandRise_1.6.0f2_PC.zip",
        fileName: "StandRise_1.6.0f2_PC.zip",
        folderName: "StandRise",
        exeName: "StandRise.exe",
        size: "~2 GB",
        isTorrent: false
    }
];

// Библиотека пользователя
let libraryGames = JSON.parse(localStorage.getItem('libraryGames')) || [];
let installedGames = JSON.parse(localStorage.getItem('installedGames')) || {};

// Текущая выбранная игра
let selectedGameId = null;
let currentDownloadGame = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========

document.addEventListener('DOMContentLoaded', async () => {
    await loadThemes();
    await loadGamesFromJson();
    await checkInstalledGames();
    renderLibraryGames();
    initEventListeners();
    initContextMenu();
    initGameSettingsModal();
    initThemeEditor();
    initDownloadModal();
    initGameDetailModal();
    initSearch();
    initAutoUpdater();  // 👈 Добавь эту строку
    updateStoreStats();
});

// ========== ЗАГРУЗКА ИГР ИЗ JSON ==========

async function loadGamesFromJson() {
    try {
        const data = await ipcRenderer.invoke('load-games-json');
        
        if (data && data.downloads && data.downloads.length > 0) {
            gamesSource = data.name || 'Unknown';
            
            allStoreGames = data.downloads.map((game, index) => {
                // Извлекаем название игры
                const titleMatch = game.title.match(/^(.+?)\s*v\./i) || 
                                   game.title.match(/^(.+?)\s*\[/i) ||
                                   [null, game.title.split(' (')[0]];
                const gameName = titleMatch[1].trim();
                
                // Извлекаем версию
                const versionMatch = game.title.match(/v\.?([\d.]+)/i);
                const version = versionMatch ? versionMatch[1] : '';
                
                // Создаём ID
                const gameId = gameName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + index;
                
                return {
                    id: gameId,
                    title: gameName,
                    fullTitle: game.title,
                    version: version,
                    cover: '',
                    price: 'Бесплатно',
                    isFree: true,
                    description: game.title,
                    size: game.fileSize,
                    magnetUri: game.uris.find(u => u.startsWith('magnet:')) || game.uris[0],
                    folderName: gameName.replace(/[<>:"/\\|?*]/g, ''),
                    uploadDate: game.uploadDate,
                    isTorrent: true
                };
            });
            
            filteredGames = [...allStoreGames];
        } else {
            // Используем дефолтные игры
            allStoreGames = [...defaultStoreGames];
            filteredGames = [...allStoreGames];
            gamesSource = 'Default';
        }
        
        updateStoreStats();
        renderStoreGames();
        renderPagination();
        
    } catch (error) {
        console.error('Ошибка загрузки игр:', error);
        allStoreGames = [...defaultStoreGames];
        filteredGames = [...allStoreGames];
        renderStoreGames();
    }
}

function updateStoreStats() {
    const totalEl = document.getElementById('total-games-count');
    const sourceEl = document.getElementById('games-source');
    const installedEl = document.getElementById('installed-games-count');
    
    if (totalEl) totalEl.textContent = allStoreGames.length;
    if (sourceEl) sourceEl.textContent = gamesSource;
    
    if (installedEl) {
        const installedCount = Object.values(installedGames).filter(g => g.installed).length;
        installedEl.textContent = installedCount;
    }
}

// ========== ПРОВЕРКА УСТАНОВЛЕННЫХ ИГР ==========

async function checkInstalledGames() {
    for (const game of allStoreGames) {
        const result = await ipcRenderer.invoke('check-game-installed', game.folderName, game.exeName || '');
        installedGames[game.id] = result;
    }
    localStorage.setItem('installedGames', JSON.stringify(installedGames));
}

// ========== ТЕМЫ ==========

async function loadThemes() {
    try {
        const savedData = await ipcRenderer.invoke('load-themes');
        
        if (savedData) {
            customThemes = savedData.customThemes || [];
            currentThemeId = savedData.currentThemeId || 'dark';
        }

        applyTheme(currentThemeId);
        renderThemesGrid();
    } catch (error) {
        console.error('Ошибка загрузки тем:', error);
        applyTheme('dark');
    }
}

async function saveThemesToFile() {
    try {
        await ipcRenderer.invoke('save-themes', {
            customThemes,
            currentThemeId
        });
    } catch (error) {
        console.error('Ошибка сохранения тем:', error);
    }
}

function applyTheme(themeId) {
    const allThemes = [...defaultThemes, ...customThemes];
    const theme = allThemes.find(t => t.id === themeId);
    
    if (!theme) return;

    currentThemeId = themeId;
    const root = document.documentElement;

    Object.entries(theme.colors).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
    });

    root.style.setProperty('--accent-glow', `${theme.colors['accent']}4d`);

    saveThemesToFile();
    renderThemesGrid();
}

function renderThemesGrid() {
    const container = document.getElementById('themes-grid');
    if (!container) return;

    const allThemes = [...defaultThemes, ...customThemes];

    container.innerHTML = allThemes.map(theme => `
        <div class="theme-card ${currentThemeId === theme.id ? 'active' : ''}" 
             data-theme-id="${theme.id}">
            <div class="theme-preview-mini" style="background: ${theme.colors['bg-primary']}">
                <div class="theme-preview-sidebar-mini" style="background: ${theme.colors['bg-secondary']}">
                    <div style="width: 20px; height: 20px; border-radius: 50%; background: ${theme.colors['accent']}"></div>
                    <div style="height: 10px; border-radius: 4px; background: ${theme.colors['accent']}"></div>
                    <div style="height: 10px; border-radius: 4px; background: ${theme.colors['bg-tertiary']}"></div>
                </div>
                <div class="theme-preview-content-mini">
                    <div class="theme-preview-card-mini" style="background: ${theme.colors['card-bg']}; border: 1px solid ${theme.colors['border']}"></div>
                    <div class="theme-preview-card-mini" style="background: ${theme.colors['card-bg']}; border: 1px solid ${theme.colors['border']}"></div>
                </div>
            </div>
            <div class="theme-card-name">${theme.name}</div>
            <div class="theme-card-actions">
                <button class="theme-action-btn" data-action="edit" data-id="${theme.id}" title="Редактировать">
                    <i class="ri-edit-line"></i>
                </button>
                ${!theme.isDefault ? `
                    <button class="theme-action-btn danger" data-action="delete" data-id="${theme.id}" title="Удалить">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.theme-action-btn')) {
                applyTheme(card.dataset.themeId);
            }
        });
    });

    container.querySelectorAll('.theme-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            
            if (action === 'edit') editTheme(id);
            else if (action === 'delete') deleteTheme(id);
        });
    });
}

function openThemeEditor(theme = null) {
    const modal = document.getElementById('theme-editor-modal');
    const title = document.getElementById('theme-editor-title');
    const deleteBtn = document.getElementById('delete-theme-btn');

    if (theme) {
        title.textContent = 'Редактировать тему';
        editingThemeId = theme.id;
        deleteBtn.style.display = theme.isDefault ? 'none' : 'flex';
        
        document.getElementById('theme-name-input').value = theme.name;
        
        Object.entries(theme.colors).forEach(([key, value]) => {
            const colorInput = document.getElementById(`color-${key}`);
            const textInput = document.querySelector(`.color-text[data-for="color-${key}"]`);
            if (colorInput) colorInput.value = value;
            if (textInput) textInput.value = value;
        });
    } else {
        title.textContent = 'Создать тему';
        editingThemeId = null;
        deleteBtn.style.display = 'none';
        
        document.getElementById('theme-name-input').value = '';
        const defaultTheme = defaultThemes[0];
        Object.entries(defaultTheme.colors).forEach(([key, value]) => {
            const colorInput = document.getElementById(`color-${key}`);
            const textInput = document.querySelector(`.color-text[data-for="color-${key}"]`);
            if (colorInput) colorInput.value = value;
            if (textInput) textInput.value = value;
        });
    }

    updateThemePreview();
    modal.classList.add('active');
}

function editTheme(themeId) {
    const allThemes = [...defaultThemes, ...customThemes];
    const theme = allThemes.find(t => t.id === themeId);
    if (theme) openThemeEditor({...theme});
}

function deleteTheme(themeId) {
    if (confirm('Удалить эту тему?')) {
        customThemes = customThemes.filter(t => t.id !== themeId);
        if (currentThemeId === themeId) applyTheme('dark');
        saveThemesToFile();
        renderThemesGrid();
    }
}

function updateThemePreview() {
    const container = document.getElementById('theme-preview-container');
    if (!container) return;
    
    const colors = {
        'bg-primary': document.getElementById('color-bg-primary')?.value || '#0f0f1a',
        'bg-secondary': document.getElementById('color-bg-secondary')?.value || '#1a1a2e',
        'bg-tertiary': document.getElementById('color-bg-tertiary')?.value || '#25253d',
        'accent': document.getElementById('color-accent')?.value || '#6c5ce7',
        'text-primary': document.getElementById('color-text-primary')?.value || '#ffffff',
        'text-secondary': document.getElementById('color-text-secondary')?.value || '#a0a0b0',
        'border': document.getElementById('color-border')?.value || '#2d2d44',
        'card-bg': document.getElementById('color-card-bg')?.value || '#1e1e32'
    };

    container.style.background = colors['bg-primary'];
    
    const sidebar = container.querySelector('.preview-sidebar');
    if (sidebar) sidebar.style.background = colors['bg-secondary'];
    
    const avatar = container.querySelector('.preview-avatar');
    if (avatar) avatar.style.background = colors['accent'];
    
    container.querySelectorAll('.preview-menu-item').forEach((item, i) => {
        item.style.background = i === 0 ? colors['accent'] : colors['bg-tertiary'];
    });

    const content = container.querySelector('.preview-content');
    if (content) content.style.background = colors['bg-primary'];
    
    const header = container.querySelector('.preview-header');
    if (header) header.style.background = colors['bg-tertiary'];

    container.querySelectorAll('.preview-card').forEach(card => {
        card.style.background = colors['card-bg'];
        card.style.border = `1px solid ${colors['border']}`;
        
        const img = card.querySelector('.preview-card-img');
        if (img) img.style.background = colors['bg-tertiary'];
        
        const cardTitle = card.querySelector('.preview-card-title');
        if (cardTitle) cardTitle.style.background = colors['text-secondary'];
        
        const btn = card.querySelector('.preview-card-btn');
        if (btn) btn.style.background = colors['accent'];
    });
}

function saveTheme() {
    const name = document.getElementById('theme-name-input').value.trim();
    
    if (!name) {
        alert('Введите название темы!');
        return;
    }

    const colors = {
        'bg-primary': document.getElementById('color-bg-primary').value,
        'bg-secondary': document.getElementById('color-bg-secondary').value,
        'bg-tertiary': document.getElementById('color-bg-tertiary').value,
        'accent': document.getElementById('color-accent').value,
        'accent-hover': document.getElementById('color-accent-hover').value,
        'text-primary': document.getElementById('color-text-primary').value,
        'text-secondary': document.getElementById('color-text-secondary').value,
        'text-muted': document.getElementById('color-text-muted').value,
        'border': document.getElementById('color-border').value,
        'success': document.getElementById('color-success').value,
        'danger': document.getElementById('color-danger').value,
        'card-bg': document.getElementById('color-card-bg').value
    };

    if (editingThemeId) {
        const defaultTheme = defaultThemes.find(t => t.id === editingThemeId);
        
        if (defaultTheme) {
            const newTheme = {
                id: `custom-${Date.now()}`,
                name: name,
                isDefault: false,
                colors: colors
            };
            customThemes.push(newTheme);
            applyTheme(newTheme.id);
        } else {
            const themeIndex = customThemes.findIndex(t => t.id === editingThemeId);
            if (themeIndex !== -1) {
                customThemes[themeIndex] = { ...customThemes[themeIndex], name, colors };
                applyTheme(editingThemeId);
            }
        }
    } else {
        const newTheme = {
            id: `custom-${Date.now()}`,
            name: name,
            isDefault: false,
            colors: colors
        };
        customThemes.push(newTheme);
        applyTheme(newTheme.id);
    }

    saveThemesToFile();
    renderThemesGrid();
    closeThemeEditor();
}

function closeThemeEditor() {
    document.getElementById('theme-editor-modal').classList.remove('active');
    editingThemeId = null;
}

async function exportCurrentTheme() {
    const colors = {
        'bg-primary': document.getElementById('color-bg-primary').value,
        'bg-secondary': document.getElementById('color-bg-secondary').value,
        'bg-tertiary': document.getElementById('color-bg-tertiary').value,
        'accent': document.getElementById('color-accent').value,
        'accent-hover': document.getElementById('color-accent-hover').value,
        'text-primary': document.getElementById('color-text-primary').value,
        'text-secondary': document.getElementById('color-text-secondary').value,
        'text-muted': document.getElementById('color-text-muted').value,
        'border': document.getElementById('color-border').value,
        'success': document.getElementById('color-success').value,
        'danger': document.getElementById('color-danger').value,
        'card-bg': document.getElementById('color-card-bg').value
    };

    const theme = {
        name: document.getElementById('theme-name-input').value || 'Моя тема',
        colors: colors
    };

    const result = await ipcRenderer.invoke('export-theme', theme);
    if (result) alert('Тема экспортирована!');
}

async function importTheme() {
    const theme = await ipcRenderer.invoke('import-theme');
    
    if (theme && theme.colors) {
        const newTheme = {
            id: `custom-${Date.now()}`,
            name: theme.name || 'Импортированная тема',
            isDefault: false,
            colors: theme.colors
        };
        
        customThemes.push(newTheme);
        saveThemesToFile();
        applyTheme(newTheme.id);
        alert('Тема импортирована!');
    }
}

function initThemeEditor() {
    document.getElementById('create-theme-btn')?.addEventListener('click', () => openThemeEditor(null));
    document.getElementById('theme-editor-close')?.addEventListener('click', closeThemeEditor);
    document.getElementById('cancel-theme-btn')?.addEventListener('click', closeThemeEditor);
    
    document.getElementById('theme-editor-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'theme-editor-modal') closeThemeEditor();
    });

    document.getElementById('save-theme-btn')?.addEventListener('click', saveTheme);
    document.getElementById('delete-theme-btn')?.addEventListener('click', () => {
        if (editingThemeId && confirm('Удалить эту тему?')) {
            deleteTheme(editingThemeId);
            closeThemeEditor();
        }
    });

    document.getElementById('export-theme-btn')?.addEventListener('click', exportCurrentTheme);
    document.getElementById('import-theme-btn')?.addEventListener('click', importTheme);

    document.querySelectorAll('.color-input-wrapper input[type="color"]').forEach(colorInput => {
        colorInput.addEventListener('input', () => {
            const textInput = document.querySelector(`.color-text[data-for="${colorInput.id}"]`);
            if (textInput) textInput.value = colorInput.value;
            updateThemePreview();
        });
    });

    document.querySelectorAll('.color-text').forEach(textInput => {
        textInput.addEventListener('input', () => {
            const colorInput = document.getElementById(textInput.dataset.for);
            if (colorInput && /^#[0-9A-Fa-f]{6}$/.test(textInput.value)) {
                colorInput.value = textInput.value;
                updateThemePreview();
            }
        });
    });

    document.getElementById('reset-settings-btn')?.addEventListener('click', () => {
        if (confirm('Сбросить все настройки?')) {
            customThemes = [];
            currentThemeId = 'dark';
            localStorage.clear();
            saveThemesToFile();
            applyTheme('dark');
            libraryGames = [];
            installedGames = {};
            renderLibraryGames();
            renderStoreGames();
            alert('Настройки сброшены!');
        }
    });
}

// ========== МАГАЗИН ==========

function renderStoreGames() {
    const container = document.getElementById('store-games');
    if (!container) return;

    const startIndex = (currentPage - 1) * GAMES_PER_PAGE;
    const endIndex = startIndex + GAMES_PER_PAGE;
    const gamesToShow = filteredGames.slice(startIndex, endIndex);

    if (gamesToShow.length === 0) {
        container.innerHTML = `
            <div class="loading-games">
                <i class="ri-search-line" style="font-size: 40px;"></i>
                <span>Игры не найдены</span>
            </div>
        `;
        return;
    }

    // Простая заглушка без текста
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 250'%3E%3Crect fill='%2325253d' width='200' height='250'/%3E%3Ctext fill='%234a4a5a' font-size='50' x='100' y='140' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";

    container.innerHTML = gamesToShow.map(game => {
        const isInstalled = installedGames[game.id]?.installed;
        
        return `
            <div class="game-card store-game" data-game-id="${game.id}">
                ${isInstalled ? '<span class="game-status installed">Установлено</span>' : ''}
                ${game.isFree && !isInstalled ? '<span class="game-status free">FREE</span>' : ''}
                <img class="game-cover" src="${game.cover || placeholder}" alt="${game.title}" 
                     onerror="this.onerror=null; this.src='${placeholder}';">
                <div class="game-info">
                    <div class="game-title">${game.title}</div>
                    <div class="game-size">${game.size || ''}</div>
                    <div class="game-meta">
                        <span class="game-price ${game.isFree ? 'free' : ''}">${game.price}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.store-game').forEach(card => {
        card.addEventListener('click', () => openGameDetail(card.dataset.gameId));
    });
}

function renderPagination() {
    const container = document.getElementById('pagination');
    if (!container) return;

    const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `
        <button class="page-btn" id="page-first" ${currentPage === 1 ? 'disabled' : ''}>
            <i class="ri-arrow-left-double-line"></i>
        </button>
        <button class="page-btn" id="page-prev" ${currentPage === 1 ? 'disabled' : ''}>
            <i class="ri-arrow-left-s-line"></i>
        </button>
    `;

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    startPage = Math.max(1, endPage - 4);

    for (let i = startPage; i <= endPage; i++) {
        html += `
            <button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">
                ${i}
            </button>
        `;
    }

    html += `
        <span class="page-info">${currentPage} из ${totalPages}</span>
        <button class="page-btn" id="page-next" ${currentPage === totalPages ? 'disabled' : ''}>
            <i class="ri-arrow-right-s-line"></i>
        </button>
        <button class="page-btn" id="page-last" ${currentPage === totalPages ? 'disabled' : ''}>
            <i class="ri-arrow-right-double-line"></i>
        </button>
    `;

    container.innerHTML = html;

    // Обработчики
    document.getElementById('page-first')?.addEventListener('click', () => changePage(1));
    document.getElementById('page-prev')?.addEventListener('click', () => changePage(currentPage - 1));
    document.getElementById('page-next')?.addEventListener('click', () => changePage(currentPage + 1));
    document.getElementById('page-last')?.addEventListener('click', () => changePage(totalPages));
    
    container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => changePage(parseInt(btn.dataset.page)));
    });
}

function changePage(page) {
    const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderStoreGames();
    renderPagination();
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========== ПОИСК ==========

// ========== ПОИСК ==========

// ========== ПОИСК ==========

function initSearch() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    if (!searchInput) return;

    // Убираем старые обработчики (клонируем элемент)
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);

    const doSearch = (query) => {
        query = query.toLowerCase().trim();
        
        if (query === '') {
            filteredGames = [...allStoreGames];
        } else {
            filteredGames = allStoreGames.filter(game => {
                const title = (game.title || '').toLowerCase();
                const fullTitle = (game.fullTitle || '').toLowerCase();
                return title.includes(query) || fullTitle.includes(query);
            });
        }
        
        currentPage = 1;
        renderStoreGames();
        renderPagination();
        
        // Обновляем счётчик
        const totalEl = document.getElementById('total-games-count');
        if (totalEl) {
            if (query === '') {
                totalEl.textContent = allStoreGames.length;
            } else {
                totalEl.textContent = `${filteredGames.length} / ${allStoreGames.length}`;
            }
        }

        // Показываем/скрываем кнопку очистки
        const clearButton = document.getElementById('search-clear');
        if (clearButton) {
            clearButton.style.display = query ? 'flex' : 'none';
        }
    };

    // Обработчик ввода
    newSearchInput.addEventListener('input', function(e) {
        doSearch(this.value);
    });

    // Очистка по Escape
    newSearchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            this.value = '';
            doSearch('');
            this.blur();
        }
    });

    // Кнопка очистки
    if (clearBtn) {
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        
        newClearBtn.addEventListener('click', function() {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = '';
                doSearch('');
                input.focus();
            }
        });
    }
}

// ========== ДЕТАЛИ ИГРЫ ==========

function initGameDetailModal() {
    document.getElementById('game-detail-close')?.addEventListener('click', closeGameDetail);
    
    document.getElementById('game-detail-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'game-detail-modal') closeGameDetail();
    });

    // Установить игру
    document.getElementById('detail-install-btn')?.addEventListener('click', () => {
        const game = allStoreGames.find(g => g.id === selectedGameId);
        if (game) {
            closeGameDetail();
            if (game.isTorrent) {
                startTorrentDownload(game);
            } else {
                startDownload(game);
            }
        }
    });

    // Добавить в библиотеку без установки
    document.getElementById('detail-add-library-btn')?.addEventListener('click', () => {
        const game = allStoreGames.find(g => g.id === selectedGameId);
        if (game) {
            addToLibraryWithoutInstall(game);
        }
    });

    // Играть
    document.getElementById('detail-play-btn')?.addEventListener('click', () => {
        const gameInfo = installedGames[selectedGameId];
        if (gameInfo?.path) {
            ipcRenderer.send('launch-game', `"${gameInfo.path}"`);
        }
    });

    // Удалить
    document.getElementById('detail-uninstall-btn')?.addEventListener('click', async () => {
        if (confirm('Удалить игру? Все файлы будут удалены.')) {
            const gameInfo = installedGames[selectedGameId];
            if (gameInfo?.folder) {
                const result = await ipcRenderer.invoke('uninstall-game', gameInfo.folder);
                if (result.success) {
                    installedGames[selectedGameId] = { installed: false };
                    localStorage.setItem('installedGames', JSON.stringify(installedGames));
                    renderStoreGames();
                    updateGameDetailButtons();
                    updateStoreStats();
                    
                    // Обновляем путь в библиотеке
                    const libGame = libraryGames.find(g => g.storeId === selectedGameId);
                    if (libGame) {
                        libGame.path = '';
                        libGame.installed = false;
                        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
                        renderLibraryGames();
                    }
                } else {
                    alert('Ошибка удаления: ' + result.error);
                }
            }
        }
    });
}

// Добавить в библиотеку без установки
function addToLibraryWithoutInstall(game) {
    // Проверяем, нет ли уже в библиотеке
    const exists = libraryGames.find(g => g.storeId === game.id);
    
    if (exists) {
        alert('Игра уже в библиотеке!');
        return;
    }

    const libraryGame = {
        id: Date.now(),
        storeId: game.id,
        title: game.title,
        path: '', // Путь пустой — игра не установлена
        cover: game.cover || '',
        addedDate: Date.now(),
        playtime: 0,
        lastPlayed: null,
        launchParams: '',
        installed: false, // Флаг что не установлена
        size: game.size,
        magnetUri: game.magnetUri,
        isTorrent: game.isTorrent,
        downloadUrl: game.downloadUrl,
        fileName: game.fileName,
        folderName: game.folderName
    };

    libraryGames.push(libraryGame);
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
    
    renderLibraryGames();
    closeGameDetail();
    
    // Показываем уведомление
    showNotification(`${game.title} добавлена в библиотеку`);
}

// Простое уведомление
function showNotification(message) {
    // Удаляем старое уведомление если есть
    document.getElementById('notification')?.remove();

    const notification = document.createElement('div');
    notification.id = 'notification';
    notification.className = 'notification';
    notification.innerHTML = `
        <i class="ri-checkbox-circle-fill"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(notification);

    // Показываем
    setTimeout(() => notification.classList.add('show'), 10);

    // Скрываем через 3 секунды
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function openGameDetail(gameId) {
    const game = allStoreGames.find(g => g.id === gameId);
    if (!game) return;

    selectedGameId = gameId;

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 280'%3E%3Crect fill='%231a1a2e' width='600' height='280'/%3E%3Ctext fill='%234a4a5a' font-size='80' x='300' y='160' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";
    
    const coverImg = document.getElementById('detail-game-cover');
    coverImg.src = game.cover || placeholder;
    coverImg.onerror = function() { 
        this.onerror = null; 
        this.src = placeholder; 
    };
    
    document.getElementById('detail-game-title').textContent = game.title;
    document.getElementById('detail-game-price').textContent = game.price;
    document.getElementById('detail-game-description').innerHTML = `
        <strong>Размер:</strong> ${game.size || 'Неизвестно'}<br>
        ${game.version ? `<strong>Версия:</strong> ${game.version}<br>` : ''}
        ${game.isTorrent ? '<strong>Тип:</strong> Торрент 🧲' : ''}
    `;

    updateGameDetailButtons();
    document.getElementById('game-detail-modal').classList.add('active');
}

function updateGameDetailButtons() {
    const isInstalled = installedGames[selectedGameId]?.installed;
    const inLibrary = libraryGames.find(g => g.storeId === selectedGameId);
    
    const installBtn = document.getElementById('detail-install-btn');
    const addLibraryBtn = document.getElementById('detail-add-library-btn');
    const playBtn = document.getElementById('detail-play-btn');
    const uninstallBtn = document.getElementById('detail-uninstall-btn');

    if (isInstalled) {
        if (installBtn) installBtn.style.display = 'none';
        if (addLibraryBtn) addLibraryBtn.style.display = 'none';
        if (playBtn) playBtn.style.display = 'inline-flex';
        if (uninstallBtn) uninstallBtn.style.display = 'inline-flex';
    } else {
        if (installBtn) installBtn.style.display = 'inline-flex';
        if (addLibraryBtn) {
            addLibraryBtn.style.display = inLibrary ? 'none' : 'inline-flex';
            if (inLibrary) {
                // Показываем что уже в библиотеке
                addLibraryBtn.innerHTML = '<i class="ri-bookmark-fill"></i> В библиотеке';
                addLibraryBtn.disabled = true;
                addLibraryBtn.style.display = 'inline-flex';
            } else {
                addLibraryBtn.innerHTML = '<i class="ri-bookmark-line"></i> В библиотеку';
                addLibraryBtn.disabled = false;
            }
        }
        if (playBtn) playBtn.style.display = 'none';
        if (uninstallBtn) uninstallBtn.style.display = 'none';
    }
}

function closeGameDetail() {
    document.getElementById('game-detail-modal').classList.remove('active');
}

// ========== СКАЧИВАНИЕ ==========

function initDownloadModal() {
    document.getElementById('cancel-download-btn')?.addEventListener('click', () => {
        if (confirm('Отменить скачивание?')) {
            if (currentDownloadGame) {
                ipcRenderer.send('cancel-download', currentDownloadGame.id);
            }
            closeDownloadModal();
        }
    });

    ipcRenderer.on('download-progress', (event, data) => {
        updateDownloadProgress(data);
    });

    ipcRenderer.on('download-complete', (event, data) => {
        handleDownloadComplete(data);
    });

    ipcRenderer.on('download-error', (event, error) => {
        handleDownloadError(error);
    });

    ipcRenderer.on('download-cancelled', (event, gameId) => {
        closeDownloadModal();
    });
}

function startDownload(game) {
    currentDownloadGame = game;
    
    document.getElementById('download-game-image').src = game.cover || '';
    document.getElementById('download-game-title').textContent = game.title;
    document.getElementById('download-status').textContent = 'Подключение...';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-size').textContent = `0 MB / ${game.size || '???'}`;
    
    removeTorrentInfo();
    document.getElementById('download-modal').classList.add('active');

    ipcRenderer.send('download-game', {
        url: game.downloadUrl,
        fileName: game.fileName,
        gameFolderName: game.folderName
    });
}

function startTorrentDownload(game) {
    currentDownloadGame = game;
    
    document.getElementById('download-game-image').src = game.cover || '';
    document.getElementById('download-game-title').textContent = game.title;
    document.getElementById('download-status').innerHTML = `
        <span class="loading-spinner"></span> Подключение к пирам...
    `;
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-size').textContent = `0 MB / ${game.size || '???'}`;
    
    removeTorrentInfo();
    document.getElementById('download-modal').classList.add('active');

    ipcRenderer.send('download-torrent', {
        magnetUri: game.magnetUri,
        gameFolderName: game.folderName,
        gameId: game.id
    });
}

function updateDownloadProgress(data) {
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressSize = document.getElementById('progress-size');
    const status = document.getElementById('download-status');

    if (data.status === 'connecting') {
        status.innerHTML = `<span class="loading-spinner"></span> ${data.message || 'Подключение...'}`;
    } else if (data.status === 'downloading') {
        progressFill.style.width = `${data.progress}%`;
        progressPercent.textContent = `${data.progress}%`;
        progressSize.textContent = `${data.downloadedMB} MB / ${data.totalMB} MB`;
        status.textContent = 'Скачивание...';
        
        // Торрент инфо
        if (data.speed) {
            let torrentInfo = document.getElementById('torrent-info');
            if (!torrentInfo) {
                torrentInfo = document.createElement('div');
                torrentInfo.id = 'torrent-info';
                torrentInfo.className = 'download-torrent-info';
                document.querySelector('.download-info')?.appendChild(torrentInfo);
            }
            
            torrentInfo.innerHTML = `
                <div class="torrent-stat">
                    <i class="ri-speed-line"></i>
                    <span>Скорость: <span class="value">${data.speed}</span></span>
                </div>
                <div class="torrent-stat">
                    <i class="ri-group-line"></i>
                    <span>Пиры: <span class="value">${data.peers || 0}</span></span>
                </div>
                <div class="torrent-stat">
                    <i class="ri-time-line"></i>
                    <span>Осталось: <span class="value">${data.eta || '∞'}</span></span>
                </div>
            `;
        }
    } else if (data.status === 'extracting') {
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        status.innerHTML = '<span class="loading-spinner"></span> Распаковка...';
    }
}

function handleDownloadComplete(data) {
    if (data.success && currentDownloadGame) {
        installedGames[currentDownloadGame.id] = {
            installed: true,
            path: data.exePath,
            folder: data.gamePath
        };
        localStorage.setItem('installedGames', JSON.stringify(installedGames));

        const libraryGame = {
            id: Date.now(),
            storeId: currentDownloadGame.id,
            title: currentDownloadGame.title,
            path: data.exePath,
            cover: currentDownloadGame.cover,
            addedDate: Date.now(),
            playtime: 0,
            lastPlayed: null,
            launchParams: ''
        };
        
        if (!libraryGames.find(g => g.storeId === currentDownloadGame.id)) {
            libraryGames.push(libraryGame);
            localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        }

        closeDownloadModal();
        renderStoreGames();
        renderLibraryGames();
        updateStoreStats();

        alert(`${currentDownloadGame.title} успешно установлена!`);
    }
}

function handleDownloadError(error) {
    document.getElementById('download-status').innerHTML = `
        <span style="color: var(--danger);">
            <i class="ri-error-warning-line"></i> Ошибка: ${error}
        </span>
    `;
    
    setTimeout(() => closeDownloadModal(), 3000);
}

function closeDownloadModal() {
    document.getElementById('download-modal').classList.remove('active');
    removeTorrentInfo();
    currentDownloadGame = null;
}

function removeTorrentInfo() {
    document.getElementById('torrent-info')?.remove();
}

// ========== БИБЛИОТЕКА ==========

function renderLibraryGames() {
    const container = document.getElementById('library-games');
    const emptyState = document.getElementById('empty-library');
    if (!container) return;

    // Простая заглушка
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 250'%3E%3Crect fill='%2325253d' width='200' height='250'/%3E%3Ctext fill='%234a4a5a' font-size='50' x='100' y='140' text-anchor='middle'%3E🎮%3C/text%3E%3C/svg%3E";

    let html = `
        <div class="game-card add-game-card" id="add-game-card">
            <div class="add-game-content">
                <i class="ri-add-line"></i>
                <span>Добавить игру</span>
            </div>
        </div>
    `;

    if (libraryGames.length === 0) {
        container.innerHTML = html;
        if (emptyState) emptyState.style.display = 'none';
    } else {
        if (emptyState) emptyState.style.display = 'none';
        
        html += libraryGames.map(game => {
            const playtime = game.playtime || 0;
            const playtimeText = formatPlaytimeShort(playtime);
            const playtimeClass = getPlaytimeClass(playtime);
            const isInstalled = game.path && game.path.length > 0;
            
            return `
                <div class="game-card library-game ${!isInstalled ? 'not-installed' : ''}" data-id="${game.id}">
                    <div class="game-playtime ${playtimeClass}">
                        <i class="ri-time-line"></i>
                        <span>${playtimeText}</span>
                    </div>
                    ${!isInstalled ? '<span class="game-status not-installed-badge">Не установлено</span>' : ''}
                    <img class="game-cover" src="${game.cover || placeholder}" alt="${game.title}"
                         onerror="this.onerror=null; this.src='${placeholder}';">
                    <div class="game-info">
                        <div class="game-title">${game.title}</div>
                        <div class="game-meta">
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
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
    }

    document.getElementById('add-game-card')?.addEventListener('click', quickAddGame);

    container.querySelectorAll('.play-btn:not(.install-btn)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            launchGame(parseInt(btn.dataset.gameId));
        });
    });

    container.querySelectorAll('.install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            installFromLibrary(parseInt(btn.dataset.gameId));
        });
    });

    document.querySelectorAll('.library-game').forEach(card => {
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, parseInt(card.dataset.id));
        });
    });
}

// Установка игры из библиотеки
function installFromLibrary(gameId) {
    const game = libraryGames.find(g => g.id === gameId);
    if (!game) return;

    // Создаём объект игры для скачивания
    const downloadGame = {
        id: game.storeId || game.id,
        title: game.title,
        cover: game.cover,
        size: game.size,
        magnetUri: game.magnetUri,
        isTorrent: game.isTorrent,
        downloadUrl: game.downloadUrl,
        fileName: game.fileName,
        folderName: game.folderName || game.title.replace(/[<>:"/\\|?*]/g, '')
    };

    if (downloadGame.isTorrent && downloadGame.magnetUri) {
        startTorrentDownload(downloadGame);
    } else if (downloadGame.downloadUrl) {
        startDownload(downloadGame);
    } else {
        alert('Нет ссылки для скачивания. Укажите путь к игре вручную через настройки.');
    }
}

function formatPlaytimeShort(minutes) {
    if (minutes === 0) return 'Не играли';
    if (minutes < 60) return `${minutes} мин`;
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours < 100) {
        return mins > 0 ? `${hours}ч ${mins}м` : `${hours} ч`;
    }
    
    return `${hours} ч`;
}

function getPlaytimeClass(minutes) {
    if (minutes === 0) return 'no-time';
    if (minutes < 60) return 'low-time';
    if (minutes < 600) return 'medium-time';
    if (minutes < 6000) return 'high-time';
    return 'ultra-time';
}

async function quickAddGame() {
    try {
        const filePath = await ipcRenderer.invoke('select-game-exe');
        if (!filePath) return;

        const fileName = path.basename(filePath, '.exe');
        const gameName = formatGameName(fileName);

        const newGame = {
            id: Date.now(),
            title: gameName,
            path: filePath,
            cover: '',
            addedDate: Date.now(),
            playtime: 0,
            lastPlayed: null,
            launchParams: ''
        };

        libraryGames.push(newGame);
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();

    } catch (error) {
        console.error('Ошибка при добавлении игры:', error);
    }
}

function formatGameName(fileName) {
    return fileName
        .replace(/([A-Z])/g, ' $1')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function deleteGame(gameId) {
    if (confirm('Удалить игру из библиотеки?')) {
        libraryGames = libraryGames.filter(game => game.id !== gameId);
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
    }
}

function launchGame(gameId) {
    const game = libraryGames.find(g => g.id === gameId);
    if (!game) return;

    game.lastPlayed = Date.now();
    localStorage.setItem('libraryGames', JSON.stringify(libraryGames));

    const command = game.launchParams 
        ? `"${game.path}" ${game.launchParams}`
        : `"${game.path}"`;

    ipcRenderer.send('launch-game', command);
}

// ========== КОНТЕКСТНОЕ МЕНЮ ==========

function initContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    document.addEventListener('click', () => hideContextMenu());
    document.addEventListener('scroll', () => hideContextMenu());

    document.getElementById('ctx-play')?.addEventListener('click', () => {
        if (selectedGameId) launchGame(selectedGameId);
        hideContextMenu();
    });

    document.getElementById('ctx-settings')?.addEventListener('click', () => {
        if (selectedGameId) openGameSettings(selectedGameId);
        hideContextMenu();
    });

    document.getElementById('ctx-open-folder')?.addEventListener('click', () => {
        if (selectedGameId) openGameFolder(selectedGameId);
        hideContextMenu();
    });

    document.getElementById('ctx-delete')?.addEventListener('click', () => {
        if (selectedGameId) deleteGame(selectedGameId);
        hideContextMenu();
    });
}

function showContextMenu(e, gameId) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    selectedGameId = gameId;
    
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.classList.add('active');

    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideContextMenu() {
    document.getElementById('context-menu')?.classList.remove('active');
}

function openGameFolder(gameId) {
    const game = libraryGames.find(g => g.id === gameId);
    if (game?.path) {
        const folder = path.dirname(game.path);
        ipcRenderer.send('open-folder', folder);
    }
}

// ========== НАСТРОЙКИ ИГРЫ ==========

function initGameSettingsModal() {
    const modal = document.getElementById('game-settings-modal');

    document.getElementById('settings-modal-close')?.addEventListener('click', closeGameSettings);
    document.getElementById('cancel-settings-btn')?.addEventListener('click', closeGameSettings);
    
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeGameSettings();
    });

    document.getElementById('save-settings-btn')?.addEventListener('click', saveGameSettings);

    document.getElementById('delete-game-btn')?.addEventListener('click', () => {
        if (selectedGameId) {
            deleteGame(selectedGameId);
            closeGameSettings();
        }
    });

    document.getElementById('edit-browse-btn')?.addEventListener('click', async () => {
        const filePath = await ipcRenderer.invoke('select-game-exe');
        if (filePath) {
            document.getElementById('edit-game-path').value = filePath;
            updateSettingsPreview();
        }
    });

    document.getElementById('edit-cover-browse-btn')?.addEventListener('click', async () => {
        const filePath = await ipcRenderer.invoke('select-image');
        if (filePath) {
            document.getElementById('edit-game-cover').value = filePath;
            updateSettingsPreview();
        }
    });

    document.getElementById('edit-game-name')?.addEventListener('input', updateSettingsPreview);
    document.getElementById('edit-game-cover')?.addEventListener('input', updateSettingsPreview);
}

function openGameSettings(gameId) {
    const game = libraryGames.find(g => g.id === gameId);
    if (!game) return;

    selectedGameId = gameId;

    document.getElementById('edit-game-name').value = game.title;
    document.getElementById('edit-game-path').value = game.path;
    document.getElementById('edit-game-cover').value = game.cover || '';
    document.getElementById('edit-launch-params').value = game.launchParams || '';

    document.getElementById('stat-playtime').textContent = formatPlaytime(game.playtime || 0);
    document.getElementById('stat-added').textContent = game.addedDate ? formatDate(game.addedDate) : '—';
    document.getElementById('stat-last-played').textContent = game.lastPlayed ? formatDate(game.lastPlayed) : 'Никогда';

    updateSettingsPreview();
    document.getElementById('game-settings-modal').classList.add('active');
}

function updateSettingsPreview() {
    const name = document.getElementById('edit-game-name')?.value;
    const gamePath = document.getElementById('edit-game-path')?.value;
    const cover = document.getElementById('edit-game-cover')?.value;

    const previewName = document.getElementById('preview-game-name');
    const previewPath = document.getElementById('preview-game-path');
    const previewImg = document.getElementById('preview-cover-img');
    const previewCover = document.getElementById('preview-cover');

    if (previewName) previewName.textContent = name || 'Название игры';
    if (previewPath) previewPath.textContent = gamePath || 'Путь не указан';

    if (cover && previewImg) {
        previewImg.src = cover;
        previewCover?.classList.add('has-image');
    } else if (previewImg) {
        previewImg.src = '';
        previewCover?.classList.remove('has-image');
    }
}

function saveGameSettings() {
    const name = document.getElementById('edit-game-name').value;
    const gamePath = document.getElementById('edit-game-path').value;
    const cover = document.getElementById('edit-game-cover').value;
    const launchParams = document.getElementById('edit-launch-params').value;

    if (!name || !gamePath) {
        alert('Заполните название и путь к игре!');
        return;
    }

    const gameIndex = libraryGames.findIndex(g => g.id === selectedGameId);
    if (gameIndex !== -1) {
        libraryGames[gameIndex] = {
            ...libraryGames[gameIndex],
            title: name,
            path: gamePath,
            cover: cover,
            launchParams: launchParams
        };

        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        closeGameSettings();
    }
}

function closeGameSettings() {
    document.getElementById('game-settings-modal')?.classList.remove('active');
    selectedGameId = null;
}

function formatPlaytime(minutes) {
    if (minutes === 0) return '0 мин';
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// ========== ОСНОВНЫЕ ОБРАБОТЧИКИ ==========

function initEventListeners() {
    // Управление окном
    document.getElementById('minimize-btn')?.addEventListener('click', () => {
        ipcRenderer.send('minimize-window');
    });

    document.getElementById('maximize-btn')?.addEventListener('click', () => {
        ipcRenderer.send('maximize-window');
    });

    document.getElementById('close-btn')?.addEventListener('click', () => {
        ipcRenderer.send('close-window');
    });

    // Навигация
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;

            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.content-section').forEach(sec => {
                sec.classList.remove('active');
                if (sec.id === section) sec.classList.add('active');
            });
        });
    });

    // Модальное окно добавления игры
    const modal = document.getElementById('add-game-modal');
    
    document.getElementById('add-game-btn')?.addEventListener('click', () => {
        modal?.classList.add('active');
    });

    document.getElementById('modal-close')?.addEventListener('click', closeAddGameModal);
    document.getElementById('cancel-btn')?.addEventListener('click', closeAddGameModal);

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeAddGameModal();
    });

    document.getElementById('browse-btn')?.addEventListener('click', async () => {
        const filePath = await ipcRenderer.invoke('select-game-exe');
        if (filePath) {
            document.getElementById('game-path').value = filePath;

            const nameInput = document.getElementById('game-name');
            if (nameInput && !nameInput.value) {
                const fileName = path.basename(filePath, '.exe');
                nameInput.value = formatGameName(fileName);
            }
        }
    });

    document.getElementById('save-game-btn')?.addEventListener('click', () => {
        const name = document.getElementById('game-name').value;
        const gamePath = document.getElementById('game-path').value;
        const cover = document.getElementById('game-cover').value;

        if (!name || !gamePath) {
            alert('Заполните название и путь к игре!');
            return;
        }

        const newGame = {
            id: Date.now(),
            title: name,
            path: gamePath,
            cover: cover || '',
            addedDate: Date.now(),
            playtime: 0,
            lastPlayed: null,
            launchParams: ''
        };

        libraryGames.push(newGame);
        localStorage.setItem('libraryGames', JSON.stringify(libraryGames));
        renderLibraryGames();
        closeAddGameModal();
        clearAddGameInputs();
    });
}

function closeAddGameModal() {
    document.getElementById('add-game-modal')?.classList.remove('active');
}

function clearAddGameInputs() {
    const name = document.getElementById('game-name');
    const gamePath = document.getElementById('game-path');
    const cover = document.getElementById('game-cover');
    
    if (name) name.value = '';
    if (gamePath) gamePath.value = '';
    if (cover) cover.value = '';
}

// Обработка ошибок
ipcRenderer.on('game-error', (event, error) => {
    alert('Ошибка запуска игры: ' + error);
});

// ========== АВТООБНОВЛЕНИЕ ==========

// ========== ПРОСТАЯ ПРОВЕРКА ОБНОВЛЕНИЙ ==========

function initAutoUpdater() {
    const notification = document.getElementById('update-notification');
    const downloadBtn = document.getElementById('update-download');
    const installBtn = document.getElementById('update-install');
    const laterBtn = document.getElementById('update-later');
    const versionSpan = document.getElementById('update-version');
    const titleEl = document.getElementById('update-title');
    const messageEl = document.getElementById('update-message');
    const progressContainer = document.getElementById('update-progress');

    // Скрываем кнопку установки (не нужна в простом режиме)
    if (installBtn) installBtn.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';

    // Показать текущую версию в настройках
    ipcRenderer.invoke('get-app-version').then(version => {
        const versionEl = document.getElementById('current-version');
        if (versionEl) versionEl.textContent = version;
    });

    // Обновление доступно
    ipcRenderer.on('update-available', (event, info) => {
        if (versionSpan) versionSpan.textContent = info.newVersion;
        if (titleEl) titleEl.textContent = 'Доступно обновление!';
        if (messageEl) messageEl.innerHTML = `
            Версия <strong>${info.newVersion}</strong> доступна для скачивания.<br>
            <small style="color: var(--text-muted);">Текущая: ${info.currentVersion}</small>
        `;
        
        // Сохраняем URL для скачивания
        if (downloadBtn) {
            downloadBtn.dataset.url = info.downloadUrl;
            downloadBtn.innerHTML = '<i class="ri-download-line"></i> Скачать';
            downloadBtn.style.display = 'inline-flex';
        }
        
        if (notification) notification.classList.add('show');
    });

    // Кнопка "Скачать" — открывает ссылку в браузере
    downloadBtn?.addEventListener('click', () => {
        const url = downloadBtn.dataset.url;
        if (url) {
            ipcRenderer.send('open-download-link', url);
            showNotification('Открываю страницу загрузки...');
            
            // Скрываем уведомление
            setTimeout(() => {
                if (notification) notification.classList.remove('show');
            }, 1000);
        }
    });

    // Кнопка "Позже"
    laterBtn?.addEventListener('click', () => {
        if (notification) notification.classList.remove('show');
    });

    // Кнопка проверки в настройках
    document.getElementById('check-updates-btn')?.addEventListener('click', () => {
        ipcRenderer.send('check-for-updates');
        showNotification('Проверка обновлений...');
    });
}

// Добавь вызов в инициализацию