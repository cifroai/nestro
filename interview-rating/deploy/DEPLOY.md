# Установка на свой сервер

Скрипт `install.sh` за один запуск ставит Node.js и Caddy (веб-сервер, который сам получает
и продлевает HTTPS-сертификат), настраивает автозапуск через systemd и команду `hr-candidates`.

## Что нужно

- Сервер на **Ubuntu 22.04/24.04** или **Debian 12** с доступом по SSH и правами `sudo`.
  Хватит 1 vCPU / 1 ГБ RAM.
- Белый IP-адрес и открытые порты **80** и **443**.
- Домен, например `hr-rate.nestro.ru`, с DNS-записью типа **A** на IP сервера.
  Если домена нет, используйте бесплатный адрес вида `203-0-113-10.sslip.io`
  (ваш IP через дефисы) — он сразу указывает на сервер.
- Токен бота из @BotFather.

## Установка

```bash
# 1. Скачайте код на сервер
git clone -b claude/brave-johnson-k6q0sj https://github.com/cifroai/nestro.git
cd nestro/interview-rating

# 2. Запустите установку, указав домен
sudo bash deploy/install.sh hr-rate.nestro.ru
```

Скрипт спросит username бота (`nestro_hr_bot`), short name приложения (`rate`) и токен
(ввод скрыт). В конце он проверит, что сайт открывается по `https://`.

Если репозиторий приватный и `git clone` просит пароль — скачайте архив ветки на GitHub
(**Code → Download ZIP**) и загрузите на сервер: `scp nestro.zip user@сервер:~`.

## Подключение к Telegram

В @BotFather: `/newapp` → `@nestro_hr_bot` → название, описание, картинка 640×360 →
URL `https://hr-rate.nestro.ru/` → short name `rate`.

## Работа с кандидатами

```bash
hr-candidates add "Иванов Иван Иванович" "Ведущий аналитик"   # → ссылка для Express
hr-candidates resume <id> ~/Резюме_Иванов.pdf                  # загрузить резюме
hr-candidates results <id>                                     # итоги
hr-candidates list                                             # все кандидаты и ссылки
hr-candidates remove <id>                                      # удалить
```

## Обслуживание

| Задача                | Команда                                                        |
|-----------------------|----------------------------------------------------------------|
| Логи приложения       | `journalctl -u interview-rating -f`                            |
| Логи HTTPS / Caddy    | `journalctl -u caddy -f`                                       |
| Перезапуск            | `sudo systemctl restart interview-rating`                      |
| Изменить настройки    | `sudo nano /etc/interview-rating/env`, затем перезапуск        |
| Сменить токен бота    | поправить `BOT_TOKEN` в `/etc/interview-rating/env`, перезапуск |
| Обновить приложение   | `git pull && sudo bash deploy/install.sh`                      |
| Резервная копия       | `sudo tar czf hr-backup.tgz /var/lib/interview-rating`         |

Данные (оценки и резюме) хранятся в `/var/lib/interview-rating` и при обновлении не затрагиваются.

## Если HTTPS не заработал

- `dig +short hr-rate.nestro.ru` должен вернуть IP сервера.
- Порты 80 и 443 должны быть открыты и в файрволе сервера, и у хостинг-провайдера
  (группы безопасности / сетевые правила в панели).
- Смотрите `journalctl -u caddy -f` — там видно, почему не выпустился сертификат.
- Сервер внутри корпоративной сети без доступа из интернета не подойдёт: Telegram-клиенты
  участников должны открывать адрес из интернета, а Let's Encrypt — проверять домен.

## Если уже есть nginx

Если на сервере уже работает nginx на портах 80/443, скрипт остановится с предупреждением.
Тогда установите приложение без Caddy и добавьте сайт в ваш nginx:

```bash
sudo SKIP_CADDY=1 bash deploy/install.sh hr-rate.nestro.ru
```

Конфигурация сайта для nginx (сертификат — через certbot или ваш корпоративный):

```nginx
server {
    listen 443 ssl;
    server_name hr-rate.nestro.ru;
    ssl_certificate     /etc/letsencrypt/live/hr-rate.nestro.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hr-rate.nestro.ru/privkey.pem;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

После `sudo nginx -t && sudo systemctl reload nginx` приложение откроется по `https://hr-rate.nestro.ru/`.
