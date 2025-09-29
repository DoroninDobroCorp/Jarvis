# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - link "Назад к доске" [ref=e6] [cursor=pointer]:
        - /url: /
        - text: ← Назад к доске
      - heading "Книги" [level=1] [ref=e7]
    - navigation "Навигация по допстраницам" [ref=e8]:
      - link "Книги" [ref=e9] [cursor=pointer]:
        - /url: /books
        - text: 📚
      - link "Фильмы" [ref=e10] [cursor=pointer]:
        - /url: /movies
        - text: 🎬
      - link "Игры" [ref=e11] [cursor=pointer]:
        - /url: /games
        - text: 🎮
      - link "Покупки" [ref=e12] [cursor=pointer]:
        - /url: /purchases
        - text: 🛒
      - link "Достижения" [ref=e13] [cursor=pointer]:
        - /url: /achievements
        - text: 🏅
  - generic [ref=e14]:
    - textbox "Название книги" [ref=e15]
    - textbox "Комментарий (необязательно)" [ref=e16]
    - button "Добавить" [ref=e17] [cursor=pointer]
```