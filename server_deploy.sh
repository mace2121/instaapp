#!/usr/bin/env bash
# Docker-compose.yml'e IG volume mount ekler, panel'i yeniden build eder
COMPOSE="/docker/n8n/docker-compose.yml"
IG_MOUNT="      - /home/mahsum/instaapp/your_instagram_activity:/app/your_instagram_activity:ro"

if ! grep -q "your_instagram_activity" "$COMPOSE"; then
  sed -i "s|/home/mahsum/instaapp/app/uploads:/app/uploads|/home/mahsum/instaapp/app/uploads:/app/uploads\n${IG_MOUNT}|" "$COMPOSE"
  echo "Volume mount eklendi."
else
  echo "Volume mount zaten mevcut."
fi
