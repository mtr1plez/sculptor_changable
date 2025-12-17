#!/bin/bash

echo "========================================"
echo "  Sculptor Pro - Starting..."
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 is not installed"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping Sculptor Pro..."
    kill $API_PID $UI_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

echo "[1/3] Starting Python API Server..."
python3 api/bridge.py &
API_PID=$!
sleep 3

echo "[2/3] Starting React UI..."
cd ui
npm run dev &
UI_PID=$!
cd ..
sleep 5

echo "[3/3] Opening browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open http://localhost:5173
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open http://localhost:5173 2>/dev/null || echo "Please open http://localhost:5173 manually"
fi

echo ""
echo "========================================"
echo "  Sculptor Pro is running!"
echo "========================================"
echo ""
echo "  UI:  http://localhost:5173"
echo "  API: http://127.0.0.1:5000"
echo ""
echo "  Press Ctrl+C to stop all services"
echo "========================================"

# Keep script running
wait
EOFcat > start_sculptor.sh << 'EOF'
#!/bin/bash

echo "========================================"
echo "  Sculptor Pro - Starting..."
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 is not installed"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping Sculptor Pro..."
    kill $API_PID $UI_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

echo "[1/3] Starting Python API Server..."
python3 api/bridge.py &
API_PID=$!
sleep 3

echo "[2/3] Starting React UI..."
cd ui
npm run dev &
UI_PID=$!
cd ..
sleep 5

echo "[3/3] Opening browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open http://localhost:5173
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open http://localhost:5173 2>/dev/null || echo "Please open http://localhost:5173 manually"
fi

echo ""
echo "========================================"
echo "  Sculptor Pro is running!"
echo "========================================"
echo ""
echo "  UI:  http://localhost:5173"
echo "  API: http://127.0.0.1:5000"
echo ""
echo "  Press Ctrl+C to stop all services"
echo "========================================"

# Keep script running
wait
