#!/usr/bin/env bash
# Публикация «Оценки кандидата» на Telegram Serverless одной командой (Ubuntu/Debian):
#
#   curl -fsSL https://raw.githubusercontent.com/cifroai/nestro/claude/brave-johnson-k6q0sj/interview-rating-serverless/deploy.sh | bash
#
# Спросит только CLI-токен (@BotFather → бот → Serverless → CLI Access → Access token).
# Повторный запуск обновляет приложение.
#
# Рекрутеры (кто может создавать кандидатов) и загрузчики резюме — Telegram ID через запятую:
#   curl -fsSL …/deploy.sh | ADMIN_IDS=111,222 RESUME_UPLOADER_IDS=111 bash
# Значения запоминаются в ~/.nestro-hr.env и применяются при следующих запусках.

set -euo pipefail

BRANCH=claude/brave-johnson-k6q0sj
REPO=https://github.com/cifroai/nestro.git
DIR="$HOME/nestro"
SETTINGS="$HOME/.nestro-hr.env"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

SUDO=""
[[ $EUID -eq 0 ]] || SUDO="sudo"

need_node=1
if command -v node >/dev/null; then
  [[ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -ge 18 ]] && need_node=0
fi
if [[ $need_node -eq 1 ]] || ! command -v git >/dev/null; then
  command -v apt-get >/dev/null || die "установите Node.js 18+ и git вручную"
  say "Установка Node.js и git"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl ca-certificates git >/dev/null
  if [[ $need_node -eq 1 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >/dev/null
    $SUDO apt-get install -y -qq nodejs >/dev/null
  fi
fi

say "Загрузка приложения"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/interview-rating-serverless"

# Настройки доступа: из переменных запуска, иначе из сохранённых.
touch "$SETTINGS"
for var in ADMIN_IDS RESUME_UPLOADER_IDS; do
  if [[ -n "${!var+x}" ]]; then
    [[ "${!var}" =~ ^[0-9,\ ]*$ ]] || die "$var: только цифры через запятую"
    sed -i "/^$var=/d" "$SETTINGS"
    echo "$var=\"$(echo "${!var}" | tr -d ' ')\"" >> "$SETTINGS"
  fi
done
# shellcheck disable=SC1090
. "$SETTINGS"
for var in ADMIN_IDS RESUME_UPLOADER_IDS; do
  ids=$(echo "${!var:-}" | tr -d ' ' | sed 's/,,*/,/g; s/^,//; s/,$//')
  sed -i "s/^export const $var = \[.*\];/export const $var = [$ids];/" tgcloud/lib/config.js
  echo "$var: [${ids:-любой}]"
done
npm install --silent --no-audit --no-fund
npx tgcloud init --no-git >/dev/null

if [[ -z "${TGCLOUD_TOKEN:-}" && ! -f .tgcloud/credentials ]]; then
  say "Токен"
  echo "@BotFather → ваш бот → Serverless → CLI Access → Access token"
  read -rsp "Вставьте токен (ввод скрыт) и нажмите Enter: " TGCLOUD_TOKEN </dev/tty
  echo
  [[ "$TGCLOUD_TOKEN" =~ ^app[0-9]+:.+ ]] || die "токен должен начинаться с app<цифры>:"
fi
[[ -n "${TGCLOUD_TOKEN:-}" ]] && export TGCLOUD_TOKEN

say "Публикация"
npx tgcloud push --force 2>&1 | tee /tmp/tgcloud-push.log

say "База данных"
npx tgcloud migrate --yes

URL=$(grep -oE 'https://app[0-9]+\.tgcloud\.ai/?' /tmp/tgcloud-push.log | head -1 || true)
cat <<EOF

Готово! Осталось в @BotFather:
  /newapp → выберите бота → название «Оценка кандидата» → описание → картинка 640×360
  → URL: ${URL:-адрес https://app….tgcloud.ai/ из вывода выше}
  → short name: rate

Затем напишите боту:  /new Иванов Иван; Ведущий аналитик
EOF
