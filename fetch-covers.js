const fs = require('fs');
const path = require('path');
const google = require('googlethis');

// Настройки
const SOURCES_DIR = path.join(__dirname, 'sources');
const OUTPUT_FILE = path.join(__dirname, 'games-names.json');
const DELAY_MS = 2000; // 2 секунды задержки (чтобы гугл не забанил)

// Функция очистки имени (как в лаунчере)
function extractGameName(fullTitle) {
    return fullTitle
        .replace(/\s*v\.?[\d.]+[a-z]?\d*/gi, '')
        .replace(/\s*\[.*?\]/g, '')
        .replace(/\s*\(.*?\)/g, '')
        .replace(/\s*-\s*$/, '')
        .trim() || fullTitle.split(' ')[0];
}

// Главная функция
async function start() {
    console.log('🚀 Начинаем создание базы обложек...');

    // 1. Загружаем существующую базу (чтобы не искать то, что уже есть)
    let db = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        db = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    }

    // 2. Читаем все игры из sources
    const files = fs.readdirSync(SOURCES_DIR).filter(f => f.endsWith('.json'));
    let allTitles = [];

    files.forEach(file => {
        const data = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8'));
        if (data.downloads) {
            data.downloads.forEach(game => {
                const cleanName = extractGameName(game.title);
                if (!db[cleanName] || !db[cleanName].cover) {
                    allTitles.push(cleanName);
                }
            });
        }
    });

    // Убираем дубликаты
    allTitles = [...new Set(allTitles)];
    console.log(`Найдено игр для поиска: ${allTitles.length}`);

    // 3. Перебираем и ищем
    for (let i = 0; i < allTitles.length; i++) {
        const name = allTitles[i];
        
        try {
            console.log(`[${i + 1}/${allTitles.length}] Поиск: ${name}...`);
            
            const images = await google.image(`${name} game box art cover vertical`, { safe: false });
            
            if (images && images.length > 0) {
                // Сохраняем результат
                db[name] = {
                    name: name,
                    cover: images[0].url
                };
                
                console.log(`   ✅ Найдено!`);
            } else {
                console.log(`   ❌ Не найдено`);
            }

            // Сохраняем файл после КАЖДОЙ игры (чтобы не потерять прогресс если вылетит)
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(db, null, 2));

        } catch (e) {
            console.error(`   ⚠️ Ошибка: ${e.message}`);
        }

        // Ждем перед следующим запросом
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    console.log('🎉 Готово! Файл games-names.json обновлен.');
}

start();