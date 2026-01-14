// Исправление ошибки "File is not defined"
const { File } = require('node:buffer');
global.File = File;
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');
const google = require('googlethis');

let mainWindow;
let torrentClient = null;
let runningGames = {}; // { gameId: { startTime, processName } }

// Версия приложения
const APP_VERSION = app.getVersion();
const GITHUB_OWNER = 'timasulc08';
const GITHUB_REPO = 'game-launcher';

// Пути
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const themesPath = path.join(app.getPath('userData'), 'themes.json');
const tempPath = path.join(app.getPath('temp'), 'GameLauncher');
const sourcesPath = path.join(__dirname, 'sources');
const gamesNamesPath = path.join(__dirname, 'games-names.json');

// Чтение настроек
function readSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('readSettings error:', e);
  }
  return {};
}

function writeSettings(s) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('writeSettings error:', e);
  }
}

let settings = readSettings();
let gamesPath = settings.gamesPath || 'C:\\Games';

// Создаём папки
if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });
if (!fs.existsSync(gamesPath)) fs.mkdirSync(gamesPath, { recursive: true });

// Ленивая загрузка WebTorrent
async function getTorrentClient() {
    if (!torrentClient) {
        const WebTorrent = (await import('webtorrent')).default;
        torrentClient = new WebTorrent();
    }
    return torrentClient;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        frame: false,
        backgroundColor: '#1a1a2e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets/icon.ico')
    });

    mainWindow.loadFile('index.html');

    // Проверка обновлений
    setTimeout(() => checkForUpdates(), 5000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (torrentClient) torrentClient.destroy();
    if (process.platform !== 'darwin') app.quit();
});

// ========== API ==========

// Настройки
ipcMain.handle('get-settings', async () => readSettings());

ipcMain.handle('set-games-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите папку для игр',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const newPath = result.filePaths[0];
  settings = readSettings();
  settings.gamesPath = newPath;
  writeSettings(settings);

  gamesPath = newPath;
  if (!fs.existsSync(gamesPath)) fs.mkdirSync(gamesPath, { recursive: true });

  return gamesPath;
});

// Проверка файла
ipcMain.handle('fs-exists', async (event, filePath) => fs.existsSync(filePath));

ipcMain.handle('load-games-names', async () => {
    try {
        if (fs.existsSync(gamesNamesPath)) {
            return JSON.parse(fs.readFileSync(gamesNamesPath, 'utf8'));
        }
    } catch (e) {}
    return {};
});

// Поиск обложек
ipcMain.handle('search-game-cover', async (event, gameTitle) => {
    try {
        const options = { page: 0, safe: false };
        const images = await google.image(`${gameTitle} game box art cover vertical`, options);
        if (images && images.length > 0) return images[0].url;
    } catch (e) { return null; }
    return null;
});

// Темы
ipcMain.handle('load-themes', async () => {
    try {
        if (fs.existsSync(themesPath)) return JSON.parse(fs.readFileSync(themesPath, 'utf8'));
    } catch (e) {}
    return null;
});

ipcMain.handle('save-themes', async (event, data) => {
    try {
        fs.writeFileSync(themesPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) { return false; }
});

// Источники
ipcMain.handle('load-all-sources', async () => {
    const sources = [];
    try {
        if (!fs.existsSync(sourcesPath)) {
            fs.mkdirSync(sourcesPath, { recursive: true });
            return sources;
        }
        const files = fs.readdirSync(sourcesPath).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const data = fs.readFileSync(path.join(sourcesPath, file), 'utf8');
                const parsed = JSON.parse(data);
                sources.push({
                    id: file.replace('.json', ''),
                    name: parsed.name || file.replace('.json', ''),
                    fileName: file,
                    downloads: parsed.downloads || []
                });
            } catch (e) {}
        }
    } catch (e) {}
    return sources;
});

// Установка и запуск
ipcMain.handle('check-game-installed', async (event, gameFolderName, exeName) => {
    const gamePath = path.join(gamesPath, gameFolderName);
    const exePath = exeName ? path.join(gamePath, exeName) : findExeFile(gamePath);
    return {
        installed: exePath ? fs.existsSync(exePath) : fs.existsSync(gamePath),
        path: exePath,
        folder: gamePath
    };
});

ipcMain.on('launch-game', (event, data) => {
    const { command, gameId } = typeof data === 'string' ? { command: data, gameId: null } : data;
    const cleanPath = command.replace(/"/g, '');
    const gameDir = path.dirname(cleanPath);
    const exeName = path.basename(cleanPath);

    const startTime = Date.now();
    const process = exec(`"${exeName}"`, { cwd: gameDir }, (error) => {
        if (error) event.reply('game-error', error.message);
    });

    if (gameId) {
        runningGames[gameId] = { startTime, process };
        process.on('exit', () => {
            const playTime = Math.floor((Date.now() - startTime) / 60000);
            delete runningGames[gameId];
            event.reply('game-closed', { gameId, playTime });
        });
    }
});

ipcMain.on('stop-game', (event, gameId) => {
    const session = runningGames[gameId];
    if (session && session.process) {
        console.log(`Попытка остановки игры (PID: ${session.process.pid})...`);
        
        try {
            // Вариант 1: Жесткое убийство дерева процессов (Windows)
            exec(`taskkill /pid ${session.process.pid} /f /t`, (err) => {
                if (err) {
                    // Если не вышло (например, процесс уже умер), пробуем штатный метод
                    console.log('Taskkill не сработал, пробуем process.kill()');
                    session.process.kill(); 
                }
            });
        } catch (e) {
            console.error('Ошибка при остановке:', e);
            session.process.kill(); // Запасной вариант
        }
        
        // Сразу убираем из активных, чтобы интерфейс не тупил
        delete runningGames[gameId];
        event.reply('game-closed', { gameId, playTime: 0 }); // Отправляем сигнал закрытия
    }
});

ipcMain.on('set-download-limit', (event, bytes) => {
    // WebTorrent глобальный лимит
    if (torrentClient) {
        torrentClient.downloadSpeed = bytes === 0 ? -1 : bytes; // -1 = безлимит
    }
});

// Скачивание
let activeTorrents = {};

ipcMain.on('download-torrent', async (event, gameData) => {
    const { magnetUri, gameFolderName, gameId } = gameData;
    const downloadPath = path.join(gamesPath, gameFolderName);

    try {
        console.log(`Начинаем торрент: ${gameFolderName}`);
        const client = await getTorrentClient();

        if (activeTorrents[gameId]) {
            return event.reply('download-error', 'Уже скачивается');
        }

        // Сообщаем, что начали
        event.reply('download-progress', { gameId, progress: 0, status: 'connecting' });

        const torrent = client.add(magnetUri, { path: downloadPath }, (torrent) => {
            console.log('Торрент добавлен, качаем метаданные...');
        });

        activeTorrents[gameId] = torrent;

        // Когда получили инфо о файлах
        torrent.on('metadata', () => {
            console.log('Метаданные получены!');
            event.reply('download-progress', {
                gameId,
                progress: 0,
                status: 'downloading',
                downloadedMB: '0.0',
                totalMB: (torrent.length / 1024 / 1024).toFixed(1),
                speed: '0.0 MB/s'
            });
        });

        // Прогресс
        torrent.on('download', () => {
            event.reply('download-progress', {
                gameId,
                progress: torrent.progress * 100, // Убираем Math.round для плавности
                status: 'downloading',
                downloadedMB: (torrent.downloaded / 1024 / 1024).toFixed(1),
                totalMB: (torrent.length / 1024 / 1024).toFixed(1),
                speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
                peers: torrent.numPeers,
                eta: formatETA(torrent.timeRemaining)
            });
        });

        torrent.on('done', () => {
            console.log('Скачивание завершено!');
            delete activeTorrents[gameId];
            
            // Важно: Ищем exe
            const exePath = findExeFile(downloadPath);
            
            event.reply('download-complete', { 
                gameId, 
                success: true, 
                gamePath: downloadPath, 
                exePath: exePath 
            });
        });

        torrent.on('error', (err) => {
            console.error('Ошибка торрента:', err);
            delete activeTorrents[gameId];
            event.reply('download-error', err.message);
        });
        
    } catch (e) {
        console.error('Критическая ошибка:', e);
        event.reply('download-error', e.message);
    }
});

ipcMain.on('cancel-download', (event, gameId) => {
    if (activeTorrents[gameId]) {
        activeTorrents[gameId].destroy();
        delete activeTorrents[gameId];
        event.reply('download-cancelled', gameId);
    }
});

// Хранилище для данных о паузах
let pausedTorrents = {}; // { gameId: { magnetUri, downloadPath } }

// ПАУЗА (Полная остановка)
ipcMain.on('pause-download', (event, gameId) => {
    if (activeTorrents[gameId]) {
        console.log(`Ставим на паузу: ${gameId}`);
        
        // 1. Сохраняем данные, чтобы потом восстановить
        pausedTorrents[gameId] = {
            magnetUri: activeTorrents[gameId].magnetURI,
            downloadPath: activeTorrents[gameId].path,
            gameId: gameId // Для удобства
        };

        // 2. Уничтожаем торрент (останавливаем сеть)
        activeTorrents[gameId].destroy(() => {
            delete activeTorrents[gameId];
            console.log(`Торрент ${gameId} остановлен.`);
        });
    }
});

// ВОЗОБНОВЛЕНИЕ (Рестарт с проверкой файлов)
ipcMain.on('resume-download', async (event, gameId) => {
    const data = pausedTorrents[gameId];
    
    if (data) {
        console.log(`Возобновляем: ${gameId}`);
        
        // Удаляем из пауз
        delete pausedTorrents[gameId];

        // Запускаем заново (используем ту же логику, что и в download-torrent)
        // Но нам нужно вызвать её вручную
        
        try {
            const client = await getTorrentClient();
            
            event.reply('download-progress', { gameId, progress: 0, status: 'connecting', message: 'Проверка файлов...' });

            // Добавляем торрент в ТУ ЖЕ папку
            const torrent = client.add(data.magnetUri, { path: data.downloadPath }, (torrent) => {
                console.log('Торрент перезапущен, проверяем хеш...');
            });

            activeTorrents[gameId] = torrent;

            // Вешаем те же обработчики
            torrent.on('download', () => {
                event.reply('download-progress', {
                    gameId,
                    progress: Math.round(torrent.progress * 100),
                    status: 'downloading',
                    downloadedMB: (torrent.downloaded / 1024 / 1024).toFixed(1),
                    totalMB: (torrent.length / 1024 / 1024).toFixed(1),
                    speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
                    peers: torrent.numPeers,
                    eta: formatETA(torrent.timeRemaining)
                });
            });

            torrent.on('done', () => {
                delete activeTorrents[gameId];
                const exePath = findExeFile(data.downloadPath);
                event.reply('download-complete', { gameId, success: true, gamePath: data.downloadPath, exePath });
            });

            torrent.on('error', (err) => {
                delete activeTorrents[gameId];
                event.reply('download-error', err.message);
            });

        } catch (e) {
            console.error(e);
        }
    }
});

// HTTP Скачивание
ipcMain.on('download-game', (event, gameData) => {
    const { url, fileName, gameFolderName } = gameData;
    const zipPath = path.join(tempPath, fileName);
    const extractPath = path.join(gamesPath, gameFolderName);

    const downloadFile = (downloadUrl, destination) => {
        const protocol = downloadUrl.startsWith('https') ? https : http;
        const request = protocol.get(downloadUrl, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadFile(response.headers.location, destination);
            }
            if (response.statusCode !== 200) {
                return event.reply('download-error', `HTTP Error: ${response.statusCode}`);
            }

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            const file = fs.createWriteStream(destination);

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                const progress = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0;
                event.reply('download-progress', {
                    progress,
                    downloadedMB: (downloadedSize / 1024 / 1024).toFixed(1),
                    totalMB: totalSize ? (totalSize / 1024 / 1024).toFixed(1) : '???',
                    status: 'downloading'
                });
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                event.reply('download-progress', { progress: 100, status: 'extracting' });
                try {
                    if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath, { recursive: true });
                    const zip = new AdmZip(destination);
                    zip.extractAllTo(extractPath, true);
                    fs.unlinkSync(destination);
                    event.reply('download-complete', { success: true, gamePath: extractPath, exePath: findExeFile(extractPath) });
                } catch (e) {
                    event.reply('download-error', `Extract error: ${e.message}`);
                }
            });
        });
        request.on('error', (e) => event.reply('download-error', e.message));
    };
    downloadFile(url, zipPath);
});

ipcMain.handle('uninstall-game', async (event, p) => {
    try {
        if (fs.existsSync(p)) {
            fs.rmSync(p, { recursive: true, force: true });
            return { success: true };
        }
        return { success: false, error: 'Path not found' };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('select-game-exe', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'EXE', extensions: ['exe'] }] });
    return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('select-image', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'Images', extensions: ['jpg', 'png', 'webp'] }] });
    return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('get-app-version', () => APP_VERSION);

// Управление окном
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('close-window', () => mainWindow.close());
ipcMain.on('open-folder', (e, p) => shell.openPath(p));
ipcMain.on('open-download-link', (e, url) => shell.openExternal(url));
ipcMain.on('check-for-updates', () => checkForUpdates());

// Обновления
function checkForUpdates() {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    https.get(url, { headers: { 'User-Agent': 'GameLauncher' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const release = JSON.parse(data);
                const latest = (release.tag_name || '').replace(/^v/, '');
                if (latest && isNewerVersion(latest, APP_VERSION)) {
                    const exe = release.assets?.find(a => a.name.endsWith('.exe'));
                    mainWindow.webContents.send('update-available', {
                        currentVersion: APP_VERSION,
                        newVersion: latest,
                        downloadUrl: exe ? exe.browser_download_url : release.html_url
                    });
                }
            } catch (e) {}
        });
    });
}

function isNewerVersion(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        if ((l[i] || 0) > (c[i] || 0)) return true;
        if ((l[i] || 0) < (c[i] || 0)) return false;
    }
    return false;
}

function findExeFile(folderPath) {
    if (!fs.existsSync(folderPath)) return null;
    try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
            const fullPath = path.join(folderPath, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const found = findExeFile(fullPath);
                if (found) return found;
            } else if (file.endsWith('.exe') && !file.toLowerCase().includes('uninstall') && !file.toLowerCase().includes('dxsetup')) {
                return fullPath;
            }
        }
    } catch (e) {}
    return null;
}

function formatETA(ms) {
    if (!ms || ms === Infinity) return '∞';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}ч ${m % 60}м`;
    return `${m}м ${s % 60}с`;
}

// ========== ПОИСК СКРИНШОТОВ ==========
ipcMain.handle('get-game-screenshots', async (event, gameTitle) => {
    try {
        // Ищем картинки с запросом "gameplay"
        const results = await google.image(`${gameTitle} gameplay screenshot hd`, { 
            page: 0, 
            safe: false 
        });
        
        // Возвращаем первые 4 картинки
        if (results && results.length > 0) {
            return results.slice(0, 4).map(img => img.url);
        }
    } catch (error) {
        console.error('Ошибка поиска скриншотов:', error);
    }
    return [];
});

// Состояние загрузок (активные и паузы)
let activeDownloads = {}; // Просто пустой объект
// Структура: { gameId: { magnetUri, title, status: 'downloading' | 'paused', progress: 0 } }

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