import puppeteer from 'puppeteer';

async function checkCovers() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('🚀 Открываем страницу с принудительным аудитом...');
  await page.goto('http://localhost:5173/books?backfill=1&audit=1');
  
  console.log('⏳ Ждем 20 секунд для завершения бэкфилла и аудита...');
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  console.log('🔍 Проверяем обложки книг...');
  
  const results = await page.evaluate(() => {
    // Попробуем разные селекторы
    let items = document.querySelectorAll('div[style*="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))"] > div');
    
    if (items.length === 0) {
      // Попробуем более общий селектор
      items = document.querySelectorAll('div[style*="border: 1px solid #ddd"]');
    }
    
    if (items.length === 0) {
      // Попробуем найти любые изображения на странице
      const allImages = document.querySelectorAll('img');
      console.log('Найдено изображений на странице:', allImages.length);
      allImages.forEach((img, i) => {
        console.log(`Изображение ${i + 1}:`, img.src);
      });
    }
    
    const results = [];
    
    items.forEach((item, index) => {
      const img = item.querySelector('img');
      const titleEl = item.querySelector('div[style*="font-weight: 700"]') || 
                     item.querySelector('div[style*="fontWeight: 700"]') ||
                     item.querySelector('.active-item__title');
      const title = titleEl ? titleEl.textContent : `Item ${index + 1}`;
      const src = img ? img.src : 'No image found';
      
      results.push({
        title,
        src,
        isPlaceholder: src.startsWith('data:image/svg+xml')
      });
    });
    
    return { results, totalItems: items.length, pageUrl: window.location.href };
  });
  
  console.log(`📊 Найдено ${results.results.length} книг на странице ${results.pageUrl}:`);
  console.log(`Всего элементов найдено: ${results.totalItems}`);
  
  let placeholderCount = 0;
  results.results.forEach((item, index) => {
    if (item.isPlaceholder) {
      placeholderCount++;
      console.log(`❌ ${index + 1}. "${item.title}" - ПЛЕЙСХОЛДЕР`);
    } else {
      console.log(`✅ ${index + 1}. "${item.title}" - OK (${item.src.substring(0, 50)}...)`);
    }
  });
  
  console.log(`\n📈 Итого: ${results.results.length - placeholderCount}/${results.results.length} книг имеют реальные обложки`);
  
  if (placeholderCount > 0) {
    console.log(`❌ ПРОБЛЕМА: ${placeholderCount} книг все еще имеют плейсхолдеры!`);
  } else {
    console.log('🎉 УСПЕХ: Все книги имеют реальные обложки!');
  }
  
  await browser.close();
  return placeholderCount === 0;
}

checkCovers().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
