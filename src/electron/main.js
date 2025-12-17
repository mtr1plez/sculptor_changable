const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#111827',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  // Load app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../ui/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Python Bridge - Start Python API server
function startPythonBridge() {
  const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
  const apiPath = path.join(__dirname, '../api/bridge.py');
  
  pythonProcess = spawn(pythonPath, [apiPath]);
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python]: ${data}`);
  });
  
  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data}`);
  });
  
  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  startPythonBridge();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

// IPC Handlers
ipcMain.handle('run-pipeline', async (event, options) => {
  // Forward to Python API
  return { success: true, message: 'Pipeline started' };
});

ipcMain.handle('run-step', async (event, stepId) => {
  return { success: true, step: stepId };
});

ipcMain.handle('get-projects', async () => {
  // Get projects from Python
  return [];
});

ipcMain.handle('create-project', async (event, projectData) => {
  return { success: true, project: projectData };
});

ipcMain.handle('delete-project', async (event, projectId) => {
  return { success: true };
});

ipcMain.handle('select-file', async (event, fileType) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: fileType === 'video' 
      ? [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov'] }]
      : [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a'] }]
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});