#!/bin/bash
echo "Starting Vite dev server with auto-restart..."

# Increase inotify watchers limit (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Setting inotify watchers limit..."
    sudo sysctl fs.inotify.max_user_watches=524288
    sudo sysctl -p
fi

# For Windows, we'll handle differently in the package.json script

while true; do
    echo "Starting dev server at $(date)"
    npm run dev

    echo "Dev server stopped at $(date). Restarting in 5 seconds..."
    sleep 5
done