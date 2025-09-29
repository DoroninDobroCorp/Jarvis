import puppeteer from 'puppeteer';

async function debugPage() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('🚀 Открываем страницу книг...');
  await page.goto('http://localhost:5173/books');
  
  console.log('⏳ Ждем 5 секунд для загрузки...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('🔍 Анализируем содержимое страницы...');
  
  const pageInfo = await page.evaluate(() => {
    const body = document.body.innerHTML;
    const allDivs = document.querySelectorAll('div');
    const allImages = document.querySelectorAll('img');
    const gridDivs = document.querySelectorAll('div[style*="grid"]');
    const borderDivs = document.querySelectorAll('div[style*="border"]');
    
    return {
      url: window.location.href,
      title: document.title,
      bodyLength: body.length,
      totalDivs: allDivs.length,
      totalImages: allImages.length,
      gridDivs: gridDivs.length,
      borderDivs: borderDivs.length,
      hasReactRoot: !!document.getElementById('root'),
      bodyPreview: body.substring(0, 500)
    };
  });
  
  console.log('📊 Информация о странице:');
  console.log(`URL: ${pageInfo.url}`);
  console.log(`Заголовок: ${pageInfo.title}`);
  console.log(`Размер body: ${pageInfo.bodyLength} символов`);
  console.log(`Всего div элементов: ${pageInfo.totalDivs}`);
  console.log(`Всего изображений: ${pageInfo.totalImages}`);
  console.log(`Grid div элементов: ${pageInfo.gridDivs}`);
  console.log(`Border div элементов: ${pageInfo.borderDivs}`);
  console.log(`React root найден: ${pageInfo.hasReactRoot}`);
  console.log(`\nПревью body:\n${pageInfo.bodyPreview}...`);
  
  // Попробуем принудительно запустить аудит через консоль
  console.log('\n🔧 Пробуем запустить аудит через консоль...');
  
  const auditResult = await page.evaluate(async () => {
    if (window.__coverAudit) {
      try {
        const result = await window.__coverAudit(10, 2);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    } else {
      return { success: false, error: 'window.__coverAudit не найден' };
    }
  });
  
  console.log('Результат аудита:', auditResult);
  
  // Ждем еще немного и проверяем снова
  console.log('\n⏳ Ждем еще 10 секунд и проверяем снова...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const finalCheck = await page.evaluate(() => {
    const items = document.querySelectorAll('div[style*="border: 1px solid #ddd"]');
    const itemsInfo = [];
    
    items.forEach((item, index) => {
      const img = item.querySelector('img');
      const titleEl = item.querySelector('div[style*="font-weight: 700"]');
      itemsInfo.push({
        index,
        hasImg: !!img,
        imgSrc: img ? img.src : null,
        title: titleEl ? titleEl.textContent : null
      });
    });
    
    return {
      totalItems: items.length,
      items: itemsInfo
    };
  });
  
  console.log('\n📋 Финальная проверка элементов:');
  console.log(`Найдено элементов: ${finalCheck.totalItems}`);
  finalCheck.items.forEach(item => {
    console.log(`${item.index + 1}. "${item.title}" - ${item.hasImg ? 'есть картинка' : 'нет картинки'} - ${item.imgSrc ? item.imgSrc.substring(0, 50) + '...' : 'нет src'}`);
  });
  
  console.log('\n🔍 Оставляем браузер открытым для ручной проверки...');
  console.log('Нажмите Ctrl+C когда закончите проверку');
  
  // Оставляем браузер открытым
  await new Promise(() => {}); // Бесконечное ожидание
}

debugPage().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
