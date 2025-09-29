import puppeteer from 'puppeteer';

async function simpleCheck() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  
  console.log('🚀 Открываем страницу книг...');
  await page.goto('http://localhost:5173/books');
  
  console.log('⏳ Ждем 3 секунды...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Проверяем, есть ли книги
  const hasBooks = await page.evaluate(() => {
    const items = document.querySelectorAll('div[style*="border: 1px solid #ddd"]');
    return items.length > 0;
  });
  
  if (!hasBooks) {
    console.log('📚 Книг не найдено, добавляем тестовые...');
    
    const testBooks = ['Война и мир', 'Анна Каренина'];
    
    for (const book of testBooks) {
      await page.click('input[placeholder="Название книги"]');
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder="Название книги"]');
        if (input) {
          input.value = '';
          input.focus();
        }
      });
      await page.type('input[placeholder="Название книги"]', book);
      
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const addButton = buttons.find(btn => btn.textContent.includes('Добавить'));
        if (addButton) addButton.click();
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('🔧 Принудительно запускаем аудит...');
  await page.goto('http://localhost:5173/books?audit=1&backfill=1');
  
  console.log('⏳ Ждем 15 секунд для завершения аудита...');
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  console.log('🔍 Проверяем результат...');
  
  const result = await page.evaluate(() => {
    const items = document.querySelectorAll('div[style*="border: 1px solid #ddd"]');
    const results = [];
    
    items.forEach((item, index) => {
      const img = item.querySelector('img');
      const titleEl = item.querySelector('div[style*="font-weight: 700"]');
      const title = titleEl ? titleEl.textContent.trim() : `Книга ${index + 1}`;
      const src = img ? img.src : 'Нет изображения';
      const isPlaceholder = src.startsWith('data:image/svg+xml');
      
      results.push({ title, src, isPlaceholder });
    });
    
    return results;
  });
  
  console.log(`\n📊 Результаты проверки (${result.length} книг):`);
  
  let placeholderCount = 0;
  result.forEach((book, index) => {
    if (book.isPlaceholder) {
      placeholderCount++;
      console.log(`❌ ${index + 1}. "${book.title}" - ПЛЕЙСХОЛДЕР`);
    } else {
      console.log(`✅ ${index + 1}. "${book.title}" - РЕАЛЬНАЯ ОБЛОЖКА`);
      console.log(`   ${book.src.substring(0, 80)}...`);
    }
  });
  
  console.log(`\n📈 ИТОГ: ${result.length - placeholderCount}/${result.length} книг имеют реальные обложки`);
  
  if (placeholderCount === 0) {
    console.log('🎉 УСПЕХ! Все книги имеют реальные обложки!');
  } else {
    console.log(`❌ ПРОБЛЕМА: ${placeholderCount} книг все еще имеют плейсхолдеры`);
  }
  
  console.log('\n🔍 Браузер остается открытым для ручной проверки...');
  console.log('Закройте браузер, когда закончите');
  
  // Ждем закрытия браузера
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
  
  return placeholderCount === 0;
}

simpleCheck().then(success => {
  console.log(success ? '✅ Тест пройден!' : '❌ Тест провален!');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
