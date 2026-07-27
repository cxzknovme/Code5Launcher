# Code5 Launcher

Лаунчер Minecraft для сервера Code5. Он автоматически загружает нужную версию
Minecraft 1.21.1, NeoForge и моды, после чего подключает игрока к серверу
`65.108.18.26:25790`.

## Скачать

- [Windows: скачать установщик](https://github.com/cxzknovme/Code5Launcher/releases/latest/download/Code5Launcher-Windows.exe)
- [macOS: скачать установщик](https://github.com/cxzknovme/Code5Launcher/releases/latest/download/Code5Launcher-macOS.dmg)

Для Windows используется обычный установщик. Версия macOS пока не подписана:
при первом запуске откройте приложение через контекстное меню и выберите
`Открыть`.

## Как работают обновления

Лаунчер и мод обновляются независимо:

- новая версия мода публикуется в Releases репозитория `cxzknovme/Code5`;
- новая версия программы публикуется в Releases этого репозитория;
- Windows-лаунчер сам скачивает новую версию и устанавливает её после закрытия;
- macOS-автообновление начнёт работать после добавления подписи Apple Developer.

Обычные коммиты не запускают обновление пользователей. Выпуск создаётся только
после публикации тега версии, например `v1.0.1`.

## Разработка

```bash
npm install
npm start
```

Данные игры хранятся здесь:

- Windows: `%APPDATA%\Code5Launcher`
- macOS: `~/Library/Application Support/Code5Launcher`

## Выпуск новой версии

1. Измените поле `version` в `package.json`, например на `1.0.1`.
2. Зафиксируйте и отправьте изменения в ветку `main`.
3. Создайте и отправьте тег с такой же версией:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions соберёт Windows `.exe` и macOS `.dmg`, создаст GitHub Release и
добавит служебные файлы для автообновления.
