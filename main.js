const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');

let mainWindow;
let torrentClient = null;

// Версия приложения
const APP_VERSION = app.getVersion();

// GitHub репозиторий для проверки обновлений
const GITHUB_OWNER = 'timasulc08';
const GITHUB_REPO = 'game-launcher';

// Пути
const themesPath = path.join(app.getPath('userData'), 'themes.json');
const tempPath = path.join(app.getPath('temp'), 'GameLauncher');
const gamesPath = 'C:\\Games';
const gamesJsonPath = path.join(__dirname, 'games.json');

// Создаём папки
if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });
if (!fs.existsSync(gamesPath)) fs.mkdirSync(gamesPath, { recursive: true });

// Ленивая загрузка WebTorrent (ESM модуль)
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

    // Проверяем обновления через 5 секунд после запуска
    setTimeout(() => {
        checkForUpdates();
    }, 5000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (torrentClient) {
        torrentClient.destroy();
    }
    if (process.platform !== 'darwin') app.quit();
});

// ========== ПРОСТАЯ ПРОВЕРКА ОБНОВЛЕНИЙ ==========

function checkForUpdates() {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    
    const options = {
        headers: {
            'User-Agent': 'GameLauncher'
        }
    };

    https.get(url, options, (res) => {
        let data = '';
        
        res.on('data', chunk => data += chunk);
        
        res.on('end', () => {
            try {
                const release = JSON.parse(data);
                
                if (release.message) {
                    // Нет релизов или ошибка API
                    console.log('Нет доступных релизов или ошибка:', release.message);
                    return;
                }
                
                // Убираем "v" из версии если есть (v1.0.1 -> 1.0.1)
                const latestVersion = (release.tag_name || '').replace(/^v/, '');
                
                console.log(`Текущая версия: ${APP_VERSION}`);
                console.log(`Последняя версия: ${latestVersion}`);
                
                if (isNewerVersion(latestVersion, APP_VERSION)) {
                    // Ищем .exe файл в релизе
                    const exeAsset = release.assets?.find(a => a.name.endsWith('.exe'));
                    
                    mainWindow.webContents.send('update-available', {
                        currentVersion: APP_VERSION,
                        newVersion: latestVersion,
                        releaseNotes: release.body || 'Доступна новая версия!',
                        downloadUrl: exeAsset ? exeAsset.browser_download_url : release.html_url,
                        releasePage: release.html_url
                    });
                }
            } catch (error) {
                console.error('Ошибка парсинга ответа GitHub:', error);
            }
        });
    }).on('error', (error) => {
        console.error('Ошибка проверки обновлений:', error);
    });
}

// Сравнение версий (1.0.1 > 1.0.0)
function isNewerVersion(latest, current) {
    if (!latest || !current) return false;
    
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
        const l = latestParts[i] || 0;
        const c = currentParts[i] || 0;
        
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

// Ручная проверка обновлений
ipcMain.on('check-for-updates', () => {
    checkForUpdates();
});

// Открыть ссылку в браузере
ipcMain.on('open-download-link', (event, url) => {
    shell.openExternal(url);
});

// Получить текущую версию
ipcMain.handle('get-app-version', () => {
    return APP_VERSION;
});

// ========== УПРАВЛЕНИЕ ОКНОМ ==========

ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('close-window', () => mainWindow.close());

// ========== ЗАПУСК ИГРЫ ==========

ipcMain.on('launch-game', (event, command) => {
    exec(command, (error) => {
        if (error) {
            event.reply('game-error', error.message);
        }
    });
});

// Открыть папку
ipcMain.on('open-folder', (event, folderPath) => {
    shell.openPath(folderPath);
});

// ========== ВЫБОР ФАЙЛОВ ==========

ipcMain.handle('select-game-exe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите .exe файл игры',
        filters: [
            { name: 'Исполняемые файлы', extensions: ['exe'] },
            { name: 'Все файлы', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите изображение',
        filters: [
            { name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
        ],
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
});

// ========== ЗАГРУЗКА ИГР ИЗ JSON ==========

ipcMain.handle('load-games-json', async () => {
    try {
        if (fs.existsSync(gamesJsonPath)) {
            const data = fs.readFileSync(gamesJsonPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки games.json:', error);
    }
    return null;
});

// ========== ТЕМЫ ==========

ipcMain.handle('load-themes', async () => {
    try {
        if (fs.existsSync(themesPath)) {
            const data = fs.readFileSync(themesPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки тем:', error);
    }
    return null;
});

ipcMain.handle('save-themes', async (event, themesData) => {
    try {
        fs.writeFileSync(themesPath, JSON.stringify(themesData, null, 2), 'utf8');
        return true;
    } catch (error) {
        return false;
    }
});

ipcMain.handle('export-theme', async (event, theme) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспортировать тему',
        defaultPath: `${theme.name}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled) return false;
    try {
        fs.writeFileSync(result.filePath, JSON.stringify(theme, null, 2), 'utf8');
        return true;
    } catch (error) {
        return false;
    }
});

ipcMain.handle('import-theme', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Импортировать тему',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
    });
    if (result.canceled) return null;
    try {
        const data = fs.readFileSync(result.filePaths[0], 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
});

// ========== ПРОВЕРКА УСТАНОВКИ ==========

ipcMain.handle('get-games-path', async () => gamesPath);

ipcMain.handle('check-game-installed', async (event, gameFolderName, exeName) => {
    const gamePath = path.join(gamesPath, gameFolderName);
    const exePath = exeName ? path.join(gamePath, exeName) : findExeFile(gamePath);
    
    return {
        installed: exePath ? fs.existsSync(exePath) : fs.existsSync(gamePath),
        path: exePath,
        folder: gamePath
    };
});

// ========== СКАЧИВАНИЕ ТОРРЕНТОВ ==========

let activeTorrents = {};

ipcMain.on('download-torrent', async (event, gameData) => {
    const { magnetUri, gameFolderName, gameId } = gameData;
    const downloadPath = path.join(gamesPath, gameFolderName);

    try {
        const client = await getTorrentClient();

        if (activeTorrents[gameId]) {
            event.reply('download-error', 'Эта игра уже скачивается');
            return;
        }

        event.reply('download-progress', {
            gameId,
            progress: 0,
            status: 'connecting',
            message: 'Подключение к пирам...'
        });

        const torrent = client.add(magnetUri, { path: downloadPath }, (torrent) => {
            console.log('Торрент начал скачивание:', torrent.name);
        });

        activeTorrents[gameId] = torrent;

        torrent.on('metadata', () => {
            event.reply('download-progress', {
                gameId,
                progress: 0,
                status: 'downloading',
                message: 'Скачивание...',
                totalSize: (torrent.length / 1024 / 1024 / 1024).toFixed(2) + ' GB'
            });
        });

        torrent.on('download', () => {
            const progress = Math.round(torrent.progress * 100);
            const downloaded = (torrent.downloaded / 1024 / 1024).toFixed(1);
            const total = (torrent.length / 1024 / 1024).toFixed(1);
            const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
            const peers = torrent.numPeers;

            event.reply('download-progress', {
                gameId,
                progress,
                status: 'downloading',
                downloadedMB: downloaded,
                totalMB: total,
                speed: speed + ' MB/s',
                peers,
                eta: formatETA(torrent.timeRemaining)
            });
        });

        torrent.on('done', () => {
            delete activeTorrents[gameId];
            
            const exePath = findExeFile(downloadPath);
            
            event.reply('download-complete', {
                gameId,
                success: true,
                gamePath: downloadPath,
                exePath: exePath
            });
        });

        torrent.on('error', (err) => {
            delete activeTorrents[gameId];
            event.reply('download-error', err.message);
        });

    } catch (error) {
        event.reply('download-error', error.message);
    }
});

ipcMain.on('cancel-download', (event, gameId) => {
    if (activeTorrents[gameId]) {
        activeTorrents[gameId].destroy();
        delete activeTorrents[gameId];
        event.reply('download-cancelled', gameId);
    }
});

ipcMain.on('pause-download', (event, gameId) => {
    if (activeTorrents[gameId]) {
        activeTorrents[gameId].pause();
        event.reply('download-paused', gameId);
    }
});

ipcMain.on('resume-download', (event, gameId) => {
    if (activeTorrents[gameId]) {
        activeTorrents[gameId].resume();
        event.reply('download-resumed', gameId);
    }
});

// ========== HTTP СКАЧИВАНИЕ ==========

ipcMain.on('download-game', (event, gameData) => {
    const { url, fileName, gameFolderName } = gameData;
    const zipPath = path.join(tempPath, fileName);
    const extractPath = path.join(gamesPath, gameFolderName);

    const downloadFile = (downloadUrl, destination) => {
        const protocol = downloadUrl.startsWith('https') ? https : http;
        
        const request = protocol.get(downloadUrl, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, destination);
                return;
            }

            if (response.statusCode !== 200) {
                event.reply('download-error', `Ошибка: ${response.statusCode}`);
                return;
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
                    if (!fs.existsSync(extractPath)) {
                        fs.mkdirSync(extractPath, { recursive: true });
                    }
                    const zip = new AdmZip(destination);
                    zip.extractAllTo(extractPath, true);
                    fs.unlinkSync(destination);

                    event.reply('download-complete', {
                        success: true,
                        gamePath: extractPath,
                        exePath: findExeFile(extractPath)
                    });
                } catch (error) {
                    event.reply('download-error', `Ошибка распаковки: ${error.message}`);
                }
            });
        });

        request.on('error', (error) => {
            event.reply('download-error', error.message);
        });
    };

    downloadFile(url, zipPath);
});

// ========== УДАЛЕНИЕ ==========

ipcMain.handle('uninstall-game', async (event, gameFolderPath) => {
    try {
        if (fs.existsSync(gameFolderPath)) {
            fs.rmSync(gameFolderPath, { recursive: true, force: true });
            return { success: true };
        }
        return { success: false, error: 'Папка не найдена' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

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
            } else if (file.endsWith('.exe') && 
                       !file.toLowerCase().includes('uninstall') && 
                       !file.toLowerCase().includes('redist') &&
                       !file.toLowerCase().includes('vcredist') &&
                       !file.toLowerCase().includes('dxsetup')) {
                return fullPath;
            }
        }
    } catch (error) {
        console.error('Ошибка поиска exe:', error);
    }
    return null;
}

function formatETA(ms) {
    if (!ms || ms === Infinity) return '∞';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}ч ${minutes % 60}м`;
    if (minutes > 0) return `${minutes}м ${seconds % 60}с`;
    return `${seconds}с`;
}