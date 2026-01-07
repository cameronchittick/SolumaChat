import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  globalShortcut,
  Tray,
  nativeImage,
  screen,
} from "electron";
import path from "path";
import { fileURLToPath } from "url";
import Store from "electron-store";
import { OpenPanel } from "@openpanel/sdk";
import { randomUUID } from "crypto";
import isDev from "electron-is-dev";

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store();

const platformMap = {
  darwin: "mac",
  win32: "win",
  linux: "linux",
};

app.disableHardwareAcceleration();

let mainWindow = null;
let companionWindow = null;
let loginWindow = null;
let tray = null;

let opClient = null;

if (!isDev) {
  const clientId = process.env.OPENPANEL_CLIENT_ID;
  const clientSecret = process.env.OPENPANEL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Error: OPENPANEL_CLIENT_ID or OPENPANEL_CLIENT_SECRET is not defined in the environment variables."
    );
    // Optionally, you might want to prevent the app from running further
    // if these variables are critical.
    // app.quit();
  } else {
    opClient = new OpenPanel({
      clientId: clientId,
      clientSecret: clientSecret,
    });

    opClient.setGlobalProperties({
      app_version: app.getVersion(),
      environment: isDev ? "development" : "production",
    });
    opClient.identify({
      profileId: getUniqueComputerId(),
    });
  }
}

function getUniqueComputerId() {
  let computerId = store.get("computerId");

  if (!computerId) {
    computerId = randomUUID();
    store.set("computerId", computerId);
  }

  return computerId;
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "build", "icon.png"),
    resizable: false,
  });

  const loginPath = path.join(__dirname, "login.html");
  console.log("Loading login page from:", loginPath);
  loginWindow.loadFile(loginPath);
}

const updateDockVisibility = () => {
  if (process.platform === 'darwin') {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      app.dock.show();
    } else {
      app.dock.hide();
    }
  }
}

function createMainWindow(serverHost) {
  // restore standard window
  mainWindow = new BrowserWindow({
    height: 800,
    title: '', // Remove title text
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "build", "icon.png"),
  });

  const url = serverHost.startsWith("http")
    ? serverHost
    : `https://${serverHost}`;

  mainWindow.loadURL(url);

  // Explicitly set dock icon
  if (process.platform === 'darwin') {
      const iconPath = path.join(__dirname, "build", "icon.png"); // Use standard png for dock
      try {
        const icon = nativeImage.createFromPath(iconPath);
        app.dock.setIcon(icon);
      } catch (e) {
          console.error("Failed to set dock icon:", e);
      }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    updateDockVisibility();
  });

  mainWindow.on('show', updateDockVisibility);
  mainWindow.on('hide', updateDockVisibility); // In case we hide it programmatically

  updateDockVisibility();
  
  // Menu for main window
  buildMenu(serverHost); 
}

function createCompanionWindow(serverHost) {
  companionWindow = new BrowserWindow({
    width: 400,
    minWidth: 400, // Prevent resizing too small
    height: 600,
    show: false, // Don't show until ready or toggled
    frame: false, // No title bar
    fullscreenable: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true, // Don't show in taskbar/dock
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "build", "icon.png"),
    opacity: 0.90, // Lower opacity as requested
    title: '', // Ensure no title
  });

  // Inject CSS for drag region and custom close button
  companionWindow.webContents.on('did-finish-load', () => {
    companionWindow.webContents.insertCSS(`
      body::before {
        content: "";
        display: block;
        height: 24px;
        width: 100%;
        -webkit-app-region: drag;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 9999;
        pointer-events: auto; /* Allow dragging */
      }
      
      #companion-close-btn {
        position: fixed;
        top: 12px;
        left: 12px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: rgba(128, 128, 128, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10000;
        color: white;
        transition: background-color 0.2s;
        -webkit-app-region: no-drag;
      }
      #companion-close-btn:hover {
        background-color: rgba(128, 128, 128, 0.6);
      }
      #companion-close-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }

      /* Completely remove the mobile header as requested */
      div.sticky.top-0.md\\:hidden {
        display: none !important;
      }

      /* Right justify the main header and clear the close button area */
      div.absolute.top-0.z-10.flex.h-14.w-full.items-center.justify-between {
          justify-content: flex-end !important;
          padding-left: 48px !important; /* Safety padding for close button */
      }
      
      /* Ensure the inner container of the header collapses directly to the right */
      div.absolute.top-0.z-10.flex.h-14.w-full.items-center.justify-between > div {
          width: auto !important;
          justify-content: flex-end !important;
          margin-left: auto !important;
      }

      /* Hide specific elements if they still persist */
      button[aria-label="Open sidebar"],
      #toggle-right-nav {
         display: none !important;
      }
    `);

    companionWindow.webContents.executeJavaScript(`
      const { ipcRenderer } = require('electron');
      if (!document.getElementById('companion-close-btn')) {
        const btn = document.createElement('div');
        btn.id = 'companion-close-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        btn.onclick = () => {
          ipcRenderer.send('hide-companion');
        };
        document.body.appendChild(btn);
      }
    `).catch(err => console.log('Failed to inject close button script', err));
  });

  // Keep window on top even when losing focus (optional, but requested "Always on top")
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const url = serverHost.startsWith("http")
    ? serverHost
    : `https://${serverHost}`;

  console.log("Loading URL for companion:", url);
  companionWindow.loadURL(url);
}

function initialize() {
  const savedHost = store.get("serverHost");
  console.log("Saved host:", savedHost);
  if (savedHost) {
    createCompanionWindow(savedHost);
    createMainWindow(savedHost);
  } else {
    createLoginWindow();
  }
}

const createTray = () => {
  const settings = store.get('settings') || {
    position: 'top-center',
    resetTimer: '10m',
    openNewChats: 'companion',
    trayVisibility: 'always'
  };

  // If set to 'never' and we are just recreating/updating, maybe we shouldn't unless forced
  // But wait, if it's 'never', we should destroy it.
  if (settings.trayVisibility === 'never') {
      if (tray && !tray.isDestroyed()) {
          tray.destroy();
          tray = null;
      }
      return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Soluma Chat",
      click: () => {
          const savedHost = store.get("serverHost");
          if (!mainWindow || mainWindow.isDestroyed()) {
              if (savedHost) createMainWindow(savedHost);
          } else {
              mainWindow.show();
              mainWindow.focus();
          }
      }
    },
    {
      label: "Open Companion",
      accelerator: "Option+Space", // Visual only, global shortcut handled separately
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
        label: 'Companion Position',
        submenu: [
            { label: 'Bottom Center', type: 'radio', checked: settings.position === 'bottom-center', click: () => updateSetting('position', 'bottom-center') },
            { label: 'Bottom Left', type: 'radio', checked: settings.position === 'bottom-left', click: () => updateSetting('position', 'bottom-left') },
            { label: 'Bottom Right', type: 'radio', checked: settings.position === 'bottom-right', click: () => updateSetting('position', 'bottom-right') }
        ]
    },
    { type: 'separator' },
    {
        label: 'Show in Menu Bar',
        submenu: [
             { label: 'Always', type: 'radio', checked: settings.trayVisibility === 'always', click: () => updateSetting('trayVisibility', 'always') },
             { label: 'When app is running', type: 'radio', checked: settings.trayVisibility === 'running', click: () => updateSetting('trayVisibility', 'running') },
             { label: 'Never', type: 'radio', checked: settings.trayVisibility === 'never', click: () => updateSetting('trayVisibility', 'never') },
        ]
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);

  if (tray) {
      // Update logic if tray exists
      // For right-click behavior, we don't setContextMenu. We pop it up on event.
      // But we can update the 'cached' menu if we want strictly dynamic.
      // actually, let's just recreate logic or update properties.
  } else {
      const iconPath = path.join(__dirname, "build", "icon.png");
      const icon = nativeImage
        .createFromPath(iconPath)
        .resize({ width: 16, height: 16 });
      tray = new Tray(icon);
      tray.setToolTip("Soluma Chat");
  }

  // Remove default context menu to allow left-click toggle
  tray.setContextMenu(null);

  // Interaction Handlers
  tray.removeAllListeners('click');
  tray.removeAllListeners('right-click');
  
  tray.on("click", (event) => {
    // Left click = Toggle Companion
    toggleWindow();
  });

  tray.on("right-click", (event) => {
      tray.popUpContextMenu(contextMenu);
  });
};

const updateSetting = (key, value) => {
    const settings = store.get('settings') || {};
    settings[key] = value;
    store.set('settings', settings);
    
    // Rebuild menu to update selection state
    createTray();

    // Apply immediate effects
    if (key === 'position' && companionWindow) {
        const { x, y } = getWindowPosition(value);
        companionWindow.setPosition(x, y, true);
    }
}

const toggleWindow = () => {
  if (companionWindow.isVisible()) {
      if (companionWindow.isFocused()) {
          companionWindow.hide();
      } else {
          companionWindow.focus();
      }
  } else {
    showWindow();
  }
};

const showWindow = () => {
  const { x, y } = getWindowPosition();
  companionWindow.setPosition(x, y, false);
  companionWindow.show();
  companionWindow.focus();
  
  // Auto-focus the input field
  companionWindow.webContents.executeJavaScript(`
    setTimeout(() => {
      const input = document.querySelector('textarea') || document.querySelector('input[type="text"]') || document.querySelector('[contenteditable="true"]');
      if (input) {
        input.focus();
      }
    }, 100); // Small delay to ensure render
  `).catch(e => console.error("Failed to focus input:", e));
};

const getWindowPosition = (overridePosition) => {
    const windowBounds = companionWindow.getBounds();
    // const trayBounds = tray.getBounds(); // Unused for now
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const settings = store.get('settings') || { position: 'top-center' };
    const position = overridePosition || settings.position;

    let x, y;

    switch (position) {
        case 'bottom-center':
            x = Math.round(screenWidth / 2 - windowBounds.width / 2);
            y = Math.round(screenHeight - windowBounds.height - 20); // 20px padding from bottom
            break;
        case 'bottom-left':
            x = 20;
            y = Math.round(screenHeight - windowBounds.height - 20);
            break;
        case 'bottom-right':
            x = Math.round(screenWidth - windowBounds.width - 20);
            y = Math.round(screenHeight - windowBounds.height - 20);
            break;
        case 'center':
            x = Math.round(screenWidth / 2 - windowBounds.width / 2);
            y = Math.round(screenHeight / 2 - windowBounds.height / 2);
            break;
        case 'top-right':
             x = Math.round(screenWidth - windowBounds.width - 20);
             y = Math.round(screenHeight * 0.1);
             break;
        case 'top-center':
        default:
            x = Math.round(screenWidth / 2 - windowBounds.width / 2);
            // Position slightly down from the top (10% down)
            y = Math.round(screenHeight * 0.1);
            break;
    }

    return { x, y };
};

app.whenReady().then(async () => {
  app.setName("Soluma Chat"); // Set app name early
  console.log("App is ready");

  if (!isDev) {
    // Get current platform flag if using insecure protocol
    const currentPlatform = process.platform;

    // Enhanced tracking with normalized platform name
    if (opClient)
      opClient.track("app_started", {
        os: platformMap[currentPlatform] || currentPlatform,
        arch: process.arch,
        is_packaged: app.isPackaged,
      });
  }


  // app.dock.hide() handled by updateDockVisibility
  updateDockVisibility();

  initialize();
  createTray();

  // Register Global Hotkey
  const ret = globalShortcut.register("Option+Space", () => {
    console.log("Option+Space is pressed");
    if (companionWindow && !companionWindow.isDestroyed()) {
      toggleWindow();
    }
  });

  if (!ret) {
    console.log("registration failed");
  }

  const { default: initializeShortcuts } = await import("./shortcuts.cjs");
  if (mainWindow) initializeShortcuts(globalShortcut, mainWindow);
  // Optional: Add shortcuts to companionWindow too if desired, but careful with clashes
  // initializeShortcuts(globalShortcut, companionWindow);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize();
  }
});

ipcMain.on("submit-server-host", (event, serverHost) => {
  console.log("Saving server host:", serverHost);

  // Check if the server host starts with 'http://'
  if (serverHost.startsWith("http://")) {
    // Show a warning dialog
    dialog
      .showMessageBox({
        type: "warning",
        title: "Security Warning",
        message:
          "You are using an HTTP connection, which is insecure. Data transmitted over HTTP is not encrypted and can be intercepted by third parties. It is highly recommended to use HTTPS for a secure connection.",
        buttons: ["Continue", "Cancel"],
      })
      .then((result) => {
        if (result.response === 0) {
          // User chose to continue
          store.set("serverHost", serverHost);
          createMainWindow(serverHost);
          createCompanionWindow(serverHost);
        } else {
          // User chose to cancel - do nothing or clear the input
          console.log("User cancelled due to security warning.");
          // Optionally, send an event back to the login window to clear the input field.
          event.sender.send("clear-server-host-input");
        }
      });
  } else {
    // If it's HTTPS or another protocol, proceed without warning
    store.set("serverHost", serverHost);
    createMainWindow(serverHost);
    createCompanionWindow(serverHost);
  }
});

ipcMain.on("reset-server", () => {
  console.log("Resetting server configuration");
  store.delete("serverHost");
  if (mainWindow) {
    mainWindow.close();
  }
  if (companionWindow) {
      companionWindow.close();
  }
  createLoginWindow();
});

ipcMain.on("hide-companion", () => {
    if (companionWindow && !companionWindow.isDestroyed()) {
        companionWindow.hide();
    }
});

// Error handling
process.on("uncaughtException", (error) => {
  console.error("An uncaught error occurred:", error);
});

app.on("render-process-gone", (event, webContents, details) => {
  console.error("Render process gone:", details);
});

app.on("child-process-gone", (event, details) => {
  console.error("Child process gone:", details);
});

function buildMenu(serverHost) {
  // Take serverHost as argument
  const template = [
    // { role: 'appMenu' }
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: "File",
      submenu: [
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    // Custom "Server" menu
    {
      label: "Soluma Chat", // Renamed per request
      submenu: [
        {
          label: "Disconnect from host",
          click: async () => {
            const result = await dialog.showMessageBox({
              type: "question",
              buttons: ["Disconnect", "Cancel"],
              defaultId: 1,
              title: "Disconnect Confirmation",
              message: `Are you sure you want to disconnect from the server?\n\n${serverHost}`, // Include serverHost in the message
            });

            if (result.response === 0) {
              console.log("Resetting server configuration from menu");
              store.delete("serverHost");
              if (mainWindow) {
                mainWindow.close();
              }
              createLoginWindow();
            }
          },
        },
      ],
    },
    // { role: 'editMenu' }
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(process.platform === "darwin"
          ? [
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ]
          : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
            label: "Show Tray Icon",
            click: () => {
                const settings = store.get('settings') || {};
                settings.trayVisibility = 'always';
                store.set('settings', settings);
                createTray();
            }
        }
      ],
    },
    // { role: 'windowMenu' }
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            const { shell } = require("electron");
            await shell.openExternal(
              "https://github.com/leikoilja/librechat-ui"
            );
          },
        },
        {
          label: "Keyboard Shortcuts",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Keyboard Shortcuts",
              message: `
                Cmd/Ctrl+N: Start a new chat
                Cmd/Ctrl+Shift+S: Toggle sidebar
                Cmd/Ctrl+Shift+P: Toggle private chat

                Ctrl+K: Scroll up
                Ctrl+J: Scroll down
                Ctrl+U: Scroll to top
                Ctrl+D: Scroll to bottom
              `,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
