#!/usr/bin/env bash
# Установка / обновление приложения «Оценка кандидата» на сервере Ubuntu 22.04+/Debian 12+.
#
#   sudo bash deploy/install.sh hr-rate.example.ru
#
# Без своего домена можно использовать адрес вида <IP-с-дефисами>.sslip.io, например
#   sudo bash deploy/install.sh 203-0-113-10.sslip.io
#
# Повторный запуск обновляет код и перезапускает сервис, не трогая данные и токен.
#
# Если на сервере уже есть свой веб-сервер (nginx и т. п.) — запустите с SKIP_CADDY=1
# и настройте проксирование https://<домен> → http://127.0.0.1:3000 сами (см. DEPLOY.md).

set -euo pipefail

APP_NAME=interview-rating
APP_USER=interview-rating
APP_DIR=/opt/$APP_NAME
DATA_DIR=/var/lib/$APP_NAME
ENV_DIR=/etc/$APP_NAME
ENV_FILE=$ENV_DIR/env
APP_PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DOMAIN="${1:-}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "запустите через sudo: sudo bash deploy/install.sh <домен>"
[[ -f "$SRC_DIR/server.js" ]] || die "не найден server.js рядом со скриптом ($SRC_DIR)"
command -v apt-get >/dev/null || die "скрипт рассчитан на Ubuntu/Debian (apt)"

if [[ -z "$DOMAIN" && -f "$ENV_FILE" ]]; then
  DOMAIN="$(sed -n 's/^PUBLIC_DOMAIN=//p' "$ENV_FILE")"
fi
[[ -n "$DOMAIN" ]] || die "укажите домен: sudo bash deploy/install.sh hr-rate.example.ru"

say "Системные пакеты"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync iproute2 debian-keyring debian-archive-keyring apt-transport-https >/dev/null

NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 18 ]]; then
  say "Установка Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v)"

SKIP_CADDY=${SKIP_CADDY:-0}

# Если порты 80/443 уже заняты другим веб-сервером (nginx, apache), Caddy их не получит.
if [[ $SKIP_CADDY != 1 ]]; then
BUSY=$(ss -Hltnp 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -v caddy || true)
if [[ -n "$BUSY" ]]; then
  echo "$BUSY"
  die "порты 80/443 заняты другим веб-сервером. Запустите с SKIP_CADDY=1 (см. deploy/DEPLOY.md)"
fi

if ! command -v caddy >/dev/null; then
  say "Установка Caddy (веб-сервер с автоматическим HTTPS)"
  # В Ubuntu 24.04+/Debian 12+ Caddy есть в стандартных репозиториях; иначе — официальный репозиторий.
  apt-get install -y -qq caddy >/dev/null 2>&1 || true
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
fi

say "Пользователь и каталоги"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
install -d -m 750 -o root -g "$APP_USER" "$ENV_DIR"
install -d -m 755 "$APP_DIR"

say "Копирование приложения в $APP_DIR"
rsync -a --delete --exclude data/ --exclude .env --exclude node_modules/ "$SRC_DIR/" "$APP_DIR/"
chown -R root:root "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  say "Настройки бота"
  read -rp "Username бота (без @) [nestro_hr_bot]: " BOT_USERNAME
  BOT_USERNAME=${BOT_USERNAME:-nestro_hr_bot}
  read -rp "Short name Mini App [rate]: " APP_SHORT_NAME
  APP_SHORT_NAME=${APP_SHORT_NAME:-rate}
  BOT_TOKEN=""
  while [[ ! "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; do
    read -rsp "Токен бота из @BotFather (ввод скрыт): " BOT_TOKEN; echo
  done
  umask 027
  cat > "$ENV_FILE" <<EOF
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME
APP_SHORT_NAME=$APP_SHORT_NAME
PUBLIC_DOMAIN=$DOMAIN
HOST=127.0.0.1
PORT=$APP_PORT
DB_FILE=$DATA_DIR/db.json
SCORE_MIN=1
SCORE_MAX=10
RESUME_MAX_MB=10
# Telegram ID через запятую, кому можно загружать резюме (пусто — всем):
RESUME_UPLOADERS=
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  unset BOT_TOKEN
else
  echo "Настройки уже есть: $ENV_FILE (токен не изменён)"
  sed -i "s/^PUBLIC_DOMAIN=.*/PUBLIC_DOMAIN=$DOMAIN/" "$ENV_FILE"
fi

say "Служба systemd"
cat > /etc/systemd/system/$APP_NAME.service <<EOF
[Unit]
Description=Interview rating Telegram Mini App
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now $APP_NAME >/dev/null
systemctl restart $APP_NAME

if [[ $SKIP_CADDY != 1 ]]; then
say "HTTPS (Caddy) для $DOMAIN"
SITE_FILE=/etc/caddy/$APP_NAME.caddy
cat > "$SITE_FILE" <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 20MB
	}
	reverse_proxy 127.0.0.1:$APP_PORT
}
EOF
CADDYFILE=/etc/caddy/Caddyfile
if ! grep -q "import $SITE_FILE" "$CADDYFILE" 2>/dev/null; then
  # Стандартный Caddyfile из пакета (заглушка на :80) заменяем, иначе добавляем import.
  if grep -q "/usr/share/caddy" "$CADDYFILE" 2>/dev/null && ! grep -qE '^[a-z0-9.-]+\.[a-z]{2,}' "$CADDYFILE"; then
    cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"
    echo "import $SITE_FILE" > "$CADDYFILE"
  else
    printf '\nimport %s\n' "$SITE_FILE" >> "$CADDYFILE"
  fi
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config "$CADDYFILE" --adapter caddyfile; die "ошибка в конфигурации Caddy"; }
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
fi

say "Команда управления кандидатами: hr-candidates"
cat > /usr/local/bin/hr-candidates <<EOF
#!/usr/bin/env bash
# Обёртка над scripts/candidates.js с настройками сервера.
[[ \$EUID -eq 0 ]] || exec sudo "\$0" "\$@"
# Путь к файлу резюме делаем абсолютным, т.к. команда выполняется от имени службы.
if [[ "\${1:-}" == resume && -n "\${3:-}" ]]; then
  src="\$(realpath "\$3")"
  tmp="\$(mktemp -d)"; trap 'rm -rf "\$tmp"' EXIT
  cp "\$src" "\$tmp/"; chown -R $APP_USER "\$tmp"
  set -- "\$1" "\$2" "\$tmp/\$(basename "\$src")"
fi
exec runuser -u $APP_USER -- bash -c 'set -a; . $ENV_FILE; set +a; exec node $APP_DIR/scripts/candidates.js "\$@"' _ "\$@"
EOF
chmod 755 /usr/local/bin/hr-candidates

say "Проверка"
sleep 2
systemctl is-active --quiet $APP_NAME || { journalctl -u $APP_NAME -n 30 --no-pager; die "служба не запустилась"; }
curl -fsS "http://127.0.0.1:$APP_PORT/api/config" >/dev/null && echo "Приложение отвечает локально"
if curl -fsS --max-time 30 "https://$DOMAIN/api/config" >/dev/null 2>&1; then
  echo "HTTPS работает: https://$DOMAIN/"
else
  echo "HTTPS пока не отвечает. Проверьте, что DNS-запись $DOMAIN указывает на этот сервер"
  echo "и порты 80/443 открыты. Сертификат выпустится автоматически: journalctl -u caddy -f"
fi

cat <<EOF

Готово.
  1. В @BotFather: /newapp → ваш бот → URL: https://$DOMAIN/  → short name как в настройках.
  2. Добавьте кандидата:  hr-candidates add "Иванов Иван" "Ведущий аналитик"
  3. Отправьте полученную ссылку в Express.

Логи:      journalctl -u $APP_NAME -f
Настройки: $ENV_FILE  (после правки: systemctl restart $APP_NAME)
Данные:    $DATA_DIR  (база и резюме — делайте резервные копии)
EOF
