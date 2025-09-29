import puppeteer from 'puppeteer';

async function addTestBooks() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('🚀 Открываем страницу книг...');
  await page.goto('http://localhost:5173/books');
  
  console.log('📚 Добавляем тестовые книги...');
  
  const books = [
    'Война и мир',
    'Преступление и наказание', 
    'Мастер и Маргарита',
    'Анна Каренина',
    'Евгений Онегин'
  ];
  
  for (const book of books) {
    console.log(`Добавляем: ${book}`);
    
    // Находим поле ввода и вводим название
    await page.click('input[placeholder="Название книги"]');
    await page.evaluate(() => document.querySelector('input[placeholder="Название книги"]').value = '');
    await page.type('input[placeholder="Название книги"]', book);
    
    // Нажимаем кнопку "Добавить"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const addButton = buttons.find(btn => btn.textContent.includes('Добавить'));
      if (addButton) addButton.click();
    });
    
    // Ждем немного между добавлениями
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('✅ Все книги добавлены!');
  
  // Ждем немного, чтобы увидеть результат
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await browser.close();
}

addTestBooks().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
