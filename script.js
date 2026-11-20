// Set these values and provide a server-side code-exchange endpoint to enable Google OAuth.
const GOOGLE_CLIENT_ID = "";
const GOOGLE_AUTH_ENDPOINT = "./api/auth/google";
const VISION_VERSION = "1.2.3";
const VISION_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const AVATAR_STORAGE_KEY = "motionverse.avatar.v1";

const screens = {
  welcome: document.querySelector("#welcome-screen"),
  creator: document.querySelector("#creator-screen")
};
const driveScreen = document.querySelector("#drive-screen");
const figure = document.querySelector("#avatar-figure");
const stage = document.querySelector("#avatar-stage");
const motionButton = document.querySelector("#motion-toggle");
const motionButtonLabel = document.querySelector("#motion-button-label");
const motionPanel = document.querySelector("#motion-panel");
const cameraVideo = document.querySelector("#camera-video");
const motionStatus = document.querySelector("#motion-status");
const toast = document.querySelector("#toast-message");

const defaultState = {
  character: "wanderer",
  skin: "#d89c7e",
  hair: "#532544",
  headwear: "none",
  garment: "tunic",
  material: "soft",
  texture: "plain",
  tiling: "1",
  rotation: "0",
  outfit: "#83b9a5",
  shoes: "boots",
  accessory: "none",
  pose: 1
};

let state = loadSavedState();
let undoStack = [];
let redoStack = [];
let toastTimer;
let cameraStream;
let landmarker;
let trackingFrame;
let lastVideoTime = -1;
let lastGesture = "";
let smoothX = 0.5;
let smoothY = 0.55;
let dragState;
let googleScriptPromise;
let googleCodeClient;
let authBusy = false;
let authMode = "signin";
let pendingDriveAfterSignIn = false;
let selectedCar = "race-future";
let selectedTrim = "cyan";
let THREE;
let gltfLoader;
let garageRenderer;
let garageScene;
let garageCamera;
let garageCar;
let garageFrame;
let garageHemisphere;
let garageKeyLight;
let garageRimLight;
let garageAccentLight;
let garageCameraTarget;
let garageCameraTransitionFrame = null;
let selectedCameraPreset = "front-quarter";
let showroomMood = "studio";
let studioCarRenderer;
let studioCarScene;
let studioCarCamera;
let studioCar;
let studioCarRim;
let studioCarFrame;
let studioCarPromise;
let studioCarVersion = 0;
let studioCarDragging = false;
let studioCarLastX = 0;
let studioCarRotation = -0.48;
let driveReturnScreen = "welcome";
let driveRenderer;
let driveScene;
let driveCamera;
let driveFrame;
let driveState;
let driveSetupVersion = 0;
let driveStream;
let driveLandmarker;
let driveTrackingFrame;
let driveLastVideoTime = -1;
let driveLoopSegments = [];
let driveRoadsideLights = [];
let driveHazards = [];
let driveLastFrame = 0;
const carModelCache = new Map();
const driveCameraVideo = document.querySelector("#drive-camera");

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...defaultState };
    const valid = {};
    for (const [key, value] of Object.entries(defaultState)) {
      if (typeof saved[key] === typeof value && (typeof value !== "string" || value.length < 50)) valid[key] = saved[key];
    }
    return { ...defaultState, ...valid };
  } catch (error) {
    console.error("Could not read the saved avatar:", error);
    return { ...defaultState };
  }
}

function saveState() {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save the avatar in this browser:", error);
    showToast("Your browser couldn't save this preview. You can still export it.");
  }
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    const active = key === name;
    screen.hidden = !active;
    screen.setAttribute("aria-hidden", String(!active));
  });
  if (name === "creator") {
    document.body.style.overflow = "hidden";
    applyState();
  } else {
    document.body.style.overflow = "";
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function updateHistoryButtons() {
  document.querySelector("#undo-button").disabled = undoStack.length === 0;
  document.querySelector("#redo-button").disabled = redoStack.length === 0;
}

function updateState(patch) {
  undoStack.push({ ...state });
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  state = { ...state, ...patch };
  applyState();
  saveState();
  updateHistoryButtons();
}

function applyState() {
  figure.dataset.character = state.character;
  figure.dataset.headwear = state.headwear;
  figure.dataset.garment = state.garment;
  figure.dataset.material = state.material;
  figure.dataset.texture = state.texture;
  figure.dataset.shoes = state.shoes;
  figure.dataset.accessory = state.accessory;
  figure.classList.toggle("pose-two", state.pose === 2);
  figure.classList.toggle("pose-three", state.pose === 3);
  figure.style.setProperty("--skin-color", state.skin);
  figure.style.setProperty("--hair-color", state.hair);
  figure.style.setProperty("--outfit-color", state.outfit);
  figure.style.setProperty("--texture-scale", state.tiling);
  figure.style.setProperty("--texture-angle", `${state.rotation}deg`);
  const textures = {
    plain: "none",
    weave: "repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 1px,transparent 1px 5px)",
    stars: "radial-gradient(circle,rgba(255,255,255,.82) 0 1px,transparent 1.6px)"
  };
  figure.style.setProperty("--texture-image", textures[state.texture] || "none");

  document.querySelector("#skin-color").value = state.skin;
  document.querySelector("#hair-color").value = state.hair;
  document.querySelector("#outfit-color").value = state.outfit;
  document.querySelector("#skin-preview").style.background = state.skin;
  document.querySelector("#hair-preview").style.background = state.hair;
  document.querySelector("#material-select").value = state.material;
  document.querySelector("#texture-select").value = state.texture;
  document.querySelector("#tiling-slider").value = state.tiling;
  document.querySelector("#rotation-slider").value = state.rotation;
  document.querySelector("#tiling-value").textContent = `${Number(state.tiling).toFixed(1)}×`;
  document.querySelector("#rotation-value").textContent = `${state.rotation}°`;

  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.value === state[button.dataset.choice]);
  });
  document.querySelectorAll(".color-swatch").forEach((button) => {
    const target = button.dataset.target || "outfit";
    button.classList.toggle("selected", button.dataset.color === state[target]);
  });
  if (!stage.classList.contains("is-garage-mode")) {
    document.querySelector("#avatar-caption").textContent = `${state.character.toUpperCase()} · NEW CREATION`;
  }
  updateHistoryButtons();
}

function syncVehicleControls() {
  document.querySelectorAll(".car-choice, .studio-car-choice").forEach((button) => {
    const active = button.dataset.car === selectedCar;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".trim-choice, .studio-trim-choice").forEach((button) => {
    const active = button.dataset.trim === selectedTrim;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncShowroomControls() {
  document.querySelectorAll(".cam-choice").forEach((button) => {
    const active = button.dataset.cam === selectedCameraPreset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const toggle = document.querySelector("#showroom-light-toggle");
  toggle.dataset.mood = showroomMood;
  toggle.setAttribute("aria-pressed", String(showroomMood === "nocturne"));
  document.querySelector("#light-mood-label").textContent = showroomMood === "studio" ? "STUDIO" : "NIGHT";
  document.querySelector(".garage-readout small").textContent = showroomMood === "studio" ? "STUDIO LIGHTING" : "NOCTURNE LIGHTING";
}

function selectCategory(category) {
  document.querySelectorAll(".tool-tab").forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".category-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== category;
  });
  const descriptions = {
    avatar: ["Avatar", "Start with the details that make you, you."],
    garage: ["Car garage", "Choose a machine and its glow."],
    headwear: ["Headwear", "A finishing touch for your next big adventure."],
    garments: ["Garments", "Pick a look, then make it completely yours."],
    shoes: ["Shoes", "Choose how you want to explore."],
    accessories: ["Accessories", "The little details make a big difference."]
  };
  const [title, description] = descriptions[category];
  document.querySelector("#category-title").textContent = title;
  document.querySelector("#category-description").textContent = description;
  const garageMode = category === "garage";
  document.querySelector("#panel-overline").textContent = garageMode ? "VEHICLE SETUP" : "YOUR CHARACTER";
  stage.classList.toggle("is-garage-mode", garageMode);
  stage.setAttribute("aria-label", garageMode ? "3D car preview" : "Avatar preview");
  document.querySelector("#stage-world-label").textContent = garageMode ? "MY GARAGE" : "MY AVATAR";
  document.querySelector("#stage-view-label").innerHTML = garageMode ? "3D CONFIG <b>·</b> 01" : "PREVIEW MODE <b>·</b> 01";
  document.querySelector("#stage-hint").hidden = garageMode;
  document.querySelector("#studio-car-hint").hidden = !garageMode;
  document.querySelector("#change-pose").hidden = garageMode;
  if (garageMode) {
    syncVehicleControls();
    initializeStudioCarExperience();
  } else {
    document.querySelector("#avatar-caption").textContent = `${state.character.toUpperCase()} · NEW CREATION`;
  }
}

function restoreHistory(from, to) {
  if (!from.length) return;
  to.push({ ...state });
  state = from.pop();
  applyState();
  saveState();
  updateHistoryButtons();
}

function enterCreator(name = "Guest creator") {
  document.querySelector("#profile-name").textContent = name;
  document.querySelector("#profile-button").textContent = name === "Guest creator" ? "G" : (name.trim()[0] || "U").toUpperCase();
  document.querySelector("#signin-message").textContent = "";
  selectCategory("avatar");
  showScreen("creator");
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    const active = button.dataset.authTab === mode;
    button.classList.toggle("active", active);
    if (button.hasAttribute("role")) button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#login-title").textContent = mode === "signin" ? "PILOT ACCESS" : "NEW PILOT";
  document.querySelector("#login-subtitle").textContent = mode === "signin" ? "SYNC YOUR RIDE" : "CREATE YOUR PROFILE";
  document.querySelector("#account-submit").innerHTML = `${mode === "signin" ? "CONNECT" : "REGISTER"} <span>›</span>`;
  document.querySelector("#account-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  document.querySelector("#account-footnote").innerHTML = mode === "signin"
    ? 'NEW PILOT? <button type="button" data-auth-tab="signup">REGISTER</button>'
    : 'ALREADY REGISTERED? <button type="button" data-auth-tab="signin">CONNECT</button>';
  document.querySelector("#signin-message").textContent = "";
  document.querySelectorAll("#account-footnote [data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authTab), { once: true });
  });
}

function openAccount(mode = "signup") {
  setAuthMode(mode);
  if (window.matchMedia("(max-width: 760px)").matches) {
    document.querySelector("#home-sidebar").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  document.querySelector("#account-email").focus({ preventScroll: true });
}

function showHomeSignIn() {
  pendingDriveAfterSignIn = true;
  document.querySelector("#home-configurator").hidden = true;
  document.querySelector("#home-signin").hidden = false;
  setAuthMode("signin");
  document.querySelector("#login-subtitle").textContent = `SIGN IN TO DRIVE YOUR ${CAR_LABELS[selectedCar]}`;
  document.querySelector("#home-sidebar").scrollTop = 0;
  document.querySelector("#login-title").focus({ preventScroll: true });
}

function showHomeConfigurator() {
  pendingDriveAfterSignIn = false;
  document.querySelector("#home-signin").hidden = true;
  document.querySelector("#home-configurator").hidden = false;
  document.querySelector("#home-sidebar").scrollTop = 0;
  document.querySelector("#hero-create-button").focus({ preventScroll: true });
}

async function loadGoogleIdentity() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return;
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google Identity Services could not be loaded."));
      document.head.appendChild(script);
    });
  }
  await googleScriptPromise;
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error("Google Identity Services did not initialize.");
  }
}

async function startGoogleSignIn() {
  const message = document.querySelector("#signin-message");
  if (!GOOGLE_CLIENT_ID) {
    message.textContent = "Google sign-in isn't connected yet. Add a Google OAuth client ID and a server endpoint that verifies the sign-in, or continue as a guest.";
    return;
  }
  if (authBusy) return;
  authBusy = true;
  message.textContent = "Connecting to Google…";
  try {
    await loadGoogleIdentity();
    googleCodeClient = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      ux_mode: "popup",
      callback: async (result) => {
        try {
          if (result.error || !result.code) throw new Error(result.error_description || result.error || "Google sign-in did not return an authorization code.");
          const response = await fetch(GOOGLE_AUTH_ENDPOINT, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: result.code })
          });
          if (!response.ok) throw new Error(`Account verification failed (HTTP ${response.status}).`);
          const account = await response.json();
          if (account.authenticated !== true || typeof account.name !== "string") {
            throw new Error("The server did not verify this Google account.");
          }
          if (pendingDriveAfterSignIn) {
            pendingDriveAfterSignIn = false;
            openDriveScreen();
          } else {
            enterCreator(account.name);
          }
        } catch (error) {
          message.textContent = error.message || "Google sign-in failed. Please try again.";
          console.error("MotionVerse Google sign-in failed:", error);
        } finally {
          authBusy = false;
        }
      },
      error_callback: (error) => {
        message.textContent = error.message || "Google sign-in was closed before it finished.";
        authBusy = false;
      }
    });
    googleCodeClient.requestCode();
  } catch (error) {
    message.textContent = error.message || "Google sign-in could not start.";
    console.error("MotionVerse Google sign-in setup failed:", error);
    authBusy = false;
  }
}

async function loadHandTracker() {
  try {
    const vision = await import(`${VISION_BASE_URL}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION_BASE_URL}/wasm`);
    const options = {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    };
    try {
      return await vision.HandLandmarker.createFromOptions(files, options);
    } catch (gpuError) {
      console.warn("BEYOND TOUCH GPU hand tracking is unavailable; retrying on CPU:", gpuError);
      return await vision.HandLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" }
      });
    }
  } catch (error) {
    console.error("BEYOND TOUCH hand-tracking library, WASM, or model failed to load:", error);
    throw error;
  }
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function classifyGesture(landmarks) {
  const fingerPairs = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]];
  const extendedCount = fingerPairs.reduce((count, [tip, pip, base]) => {
    return count + (pointDistance(landmarks[tip], landmarks[base]) > pointDistance(landmarks[pip], landmarks[base]) * 1.12 ? 1 : 0);
  }, 0);
  if (extendedCount >= 3) return "OPEN PALM";
  if (extendedCount <= 1) return "FIST";
  return "HAND TRACKED";
}

function applyHandPosition(landmarks) {
  const targetX = Math.min(0.82, Math.max(0.18, 1 - landmarks[9].x));
  const targetY = Math.min(0.8, Math.max(0.2, landmarks[9].y));
  smoothX += (targetX - smoothX) * 0.36;
  smoothY += (targetY - smoothY) * 0.36;
  figure.classList.add("is-moving");
  figure.style.left = `${smoothX * 100}%`;
  figure.style.bottom = `${8 + (1 - smoothY) * 8}%`;
}

function animateHand() {
  if (!cameraStream || !landmarker) return;
  try {
    if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && cameraVideo.currentTime !== lastVideoTime) {
      lastVideoTime = cameraVideo.currentTime;
      const result = landmarker.detectForVideo(cameraVideo, performance.now());
      const hand = result.landmarks && result.landmarks[0];
      if (hand) {
        applyHandPosition(hand);
        const gesture = classifyGesture(hand);
        motionStatus.textContent = gesture === "FIST" ? "Fist detected · jump" : gesture === "OPEN PALM" ? "Open palm · tracking" : "Hand tracked · move to guide avatar";
        document.querySelector(".motion-panel-top i").classList.add("is-live");
        if (gesture === "FIST" && lastGesture !== "FIST") {
          figure.classList.remove("is-jumping");
          void figure.offsetWidth;
          figure.classList.add("is-jumping");
        }
        lastGesture = gesture;
      } else {
        motionStatus.textContent = "Show one hand to your camera";
        document.querySelector(".motion-panel-top i").classList.remove("is-live");
        lastGesture = "";
      }
    }
    trackingFrame = requestAnimationFrame(animateHand);
  } catch (error) {
    console.error("MotionVerse hand tracking frame failed:", error);
    stopMotion("Hand tracking stopped unexpectedly. Turn it on to try again.");
  }
}

function stopMotion(message = "Camera is off") {
  if (trackingFrame) cancelAnimationFrame(trackingFrame);
  trackingFrame = undefined;
  if (landmarker) landmarker.close();
  landmarker = undefined;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  lastVideoTime = -1;
  lastGesture = "";
  figure.classList.remove("is-moving", "is-jumping");
  figure.style.left = "50%";
  figure.style.bottom = "";
  document.querySelector(".motion-panel-top i").classList.remove("is-live");
  motionButton.classList.remove("is-active");
  motionButtonLabel.textContent = "MOTION OFF";
  motionButton.setAttribute("aria-label", "Turn on motion tracking");
  motionStatus.textContent = message;
}

async function startMotion() {
  motionPanel.hidden = false;
  motionStatus.textContent = "Requesting camera access…";
  motionButton.setAttribute("aria-label", "Starting hand tracking");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    motionStatus.textContent = "Camera access requires HTTPS or localhost in a supported browser.";
    motionButton.setAttribute("aria-label", "Turn on motion tracking");
    return;
  }
  motionButton.disabled = true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    motionButton.classList.add("is-active");
    motionButtonLabel.textContent = "MOTION ON";
    motionButton.setAttribute("aria-label", "Turn off motion tracking");
    motionStatus.textContent = "Loading hand tracking… first use downloads the model.";
    landmarker = await loadHandTracker();
    smoothX = 0.5;
    smoothY = 0.55;
    lastVideoTime = -1;
    motionStatus.textContent = "Show one hand to your camera";
    animateHand();
  } catch (error) {
    console.error("BEYOND TOUCH webcam permission or camera setup failed:", error);
    stopMotion(error && error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access, then try again."
      : error && error.name === "NotFoundError"
        ? "No camera was found. Connect a camera or use the avatar controls."
        : "Camera or hand tracking failed. Check your connection and permissions, then try again.");
  } finally {
    motionButton.disabled = false;
  }
}

document.querySelector("#create-avatar").addEventListener("click", () => {
  enterCreator();
  selectCategory("garage");
});
document.querySelector("#hero-create-button").addEventListener("click", showHomeSignIn);
document.querySelector("#join-adventure").addEventListener("click", showHomeSignIn);
document.querySelector("#back-to-configurator").addEventListener("click", showHomeConfigurator);
document.querySelector("#drive-from-studio").addEventListener("click", () => openDriveScreen("creator"));
document.querySelector("#studio-drive-button").addEventListener("click", () => openDriveScreen("creator"));
document.querySelectorAll("[data-open-creator]").forEach((button) => {
  button.addEventListener("click", () => openAccount("signup"));
});
document.querySelector("#google-signin").addEventListener("click", startGoogleSignIn);
document.querySelector("#continue-guest").addEventListener("click", () => {
  pendingDriveAfterSignIn = false;
  openDriveScreen();
});
document.querySelectorAll(".auth-tab,[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
});
document.querySelector("#account-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#signin-message").textContent = authMode === "signin"
    ? "Email sign-in is not connected yet. Continue as a guest or use Google sign-in."
    : "Registration is not connected yet. Continue as a guest or use Google sign-in.";
});
document.querySelector("#forgot-password").addEventListener("click", () => {
  document.querySelector("#signin-message").textContent = "Password recovery will be available when account sign-in is connected.";
});
document.querySelector("#password-toggle").addEventListener("click", (event) => {
  const password = document.querySelector("#account-password");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
});
document.querySelector("#github-signin").addEventListener("click", () => {
  document.querySelector("#signin-message").textContent = "GitHub sign-in isn't configured yet. Use Google sign-in or continue as a guest.";
});
document.querySelector("#discord-signin").addEventListener("click", () => {
  document.querySelector("#signin-message").textContent = "Discord sign-in isn't configured yet. Use Google sign-in or continue as a guest.";
});
document.querySelectorAll(".landing-nav a, .landing-nav button").forEach((link) => {
  link.addEventListener("click", () => {
    const menuButton = document.querySelector("#landing-menu-button");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    document.querySelector("#landing-nav").classList.remove("open");
  });
});
document.querySelector(".creator-brand").addEventListener("click", (event) => {
  event.preventDefault();
  showScreen("welcome");
});
document.querySelector("#landing-menu-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  button.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
  document.querySelector("#landing-nav").classList.toggle("open", !expanded);
});

document.querySelectorAll(".car-choice, .studio-car-choice").forEach((button) => {
  button.addEventListener("click", () => selectCar(button.dataset.car));
});
document.querySelectorAll(".trim-choice, .studio-trim-choice").forEach((button) => {
  button.addEventListener("click", () => selectTrim(button.dataset.trim));
});
document.querySelectorAll(".cam-choice").forEach((button) => {
  button.addEventListener("click", () => setShowroomCameraPreset(button.dataset.cam));
});
document.querySelector("#showroom-light-toggle").addEventListener("click", () => {
  setShowroomMood(showroomMood === "studio" ? "nocturne" : "studio");
});
document.querySelector("#enable-drive").addEventListener("click", () => prepareRace(true));
document.querySelector("#keyboard-drive").addEventListener("click", () => prepareRace(false));
document.querySelector("#exit-driving").addEventListener("click", closeDriveScreen);
document.querySelector("#end-return").addEventListener("click", closeDriveScreen);
document.querySelector("#drive-retry").addEventListener("click", () => prepareRace(driveState ? driveState.useCamera : true));
document.addEventListener("keydown", handleDriveKeyDown);
document.addEventListener("keyup", handleDriveKeyUp);

document.querySelectorAll(".tool-tab").forEach((button) => {
  button.addEventListener("click", () => selectCategory(button.dataset.category));
});

document.querySelectorAll("[data-choice]").forEach((button) => {
  button.addEventListener("click", () => updateState({ [button.dataset.choice]: button.dataset.value }));
});

document.querySelectorAll(".color-swatch").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.target || "outfit";
    updateState({ [target]: button.dataset.color });
  });
});

document.querySelector("#skin-color").addEventListener("input", (event) => updateState({ skin: event.target.value }));
document.querySelector("#hair-color").addEventListener("input", (event) => updateState({ hair: event.target.value }));
document.querySelector("#outfit-color").addEventListener("input", (event) => updateState({ outfit: event.target.value }));
document.querySelector("#material-select").addEventListener("change", (event) => updateState({ material: event.target.value }));
document.querySelector("#texture-select").addEventListener("change", (event) => updateState({ texture: event.target.value }));
document.querySelector("#tiling-slider").addEventListener("input", (event) => updateState({ tiling: event.target.value }));
document.querySelector("#rotation-slider").addEventListener("input", (event) => updateState({ rotation: event.target.value }));

document.querySelector("#undo-button").addEventListener("click", () => restoreHistory(undoStack, redoStack));
document.querySelector("#redo-button").addEventListener("click", () => restoreHistory(redoStack, undoStack));
document.querySelector("#reset-avatar").addEventListener("click", () => {
  undoStack.push({ ...state });
  state = { ...defaultState };
  applyState();
  saveState();
  updateHistoryButtons();
  showToast("Avatar settings reset.");
});
document.querySelector("#export-avatar").addEventListener("click", () => {
  const file = new Blob([JSON.stringify({ name: "MotionVerse Avatar", version: 1, settings: state }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "motionverse-avatar.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("Avatar settings exported.");
});
document.querySelector("#motion-toggle").addEventListener("click", () => {
  if (cameraStream) stopMotion();
  else startMotion();
});
document.querySelector("#close-motion").addEventListener("click", () => {
  stopMotion();
  motionPanel.hidden = true;
});
document.querySelector("#change-pose").addEventListener("click", () => {
  const nextPose = state.pose % 3 + 1;
  figure.classList.remove("pose-two", "pose-three");
  if (nextPose === 2) figure.classList.add("pose-two");
  if (nextPose === 3) figure.classList.add("pose-three");
  updateState({ pose: nextPose });
});
document.querySelector("#profile-button").addEventListener("click", () => {
  const menu = document.querySelector("#profile-menu");
  menu.hidden = !menu.hidden;
});
document.querySelector("#restart-flow").addEventListener("click", () => {
  if (cameraStream) stopMotion();
  document.querySelector("#profile-menu").hidden = true;
  showScreen("welcome");
});

stage.addEventListener("pointerdown", (event) => {
  if (cameraStream || event.target.closest("button,.motion-panel")) return;
  dragState = { x: event.clientX, rotation: Number(figure.dataset.rotation || 0) };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!dragState || cameraStream) return;
  const rotation = Math.max(-35, Math.min(35, dragState.rotation + (event.clientX - dragState.x) * 0.32));
  figure.dataset.rotation = String(rotation);
  figure.style.setProperty("--avatar-rotation", `${rotation}deg`);
});
stage.addEventListener("pointerup", () => { dragState = undefined; });
stage.addEventListener("pointercancel", () => { dragState = undefined; });

document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream) stopMotion("Camera paused while this tab is hidden");
  if (document.hidden && driveStream) {
    if (driveState) driveState.running = false;
    stopDriveCamera();
    if (!driveScreen.hidden) {
      document.querySelector("#drive-start-overlay").hidden = false;
      document.querySelector("#drive-setup-message").textContent = "Race paused while this tab was hidden. Start camera control again to continue.";
    }
  }
});
window.addEventListener("beforeunload", () => {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  if (driveStream) driveStream.getTracks().forEach((track) => track.stop());
});

const CAR_LABELS = {
  "race-future": "NEON GT",
  race: "RACER",
  "hatchback-sports": "SPORT"
};
const VEHICLE_PREFERENCE_KEY = "beyondTouch.vehiclePreferences.v1";
const TRIM_COLORS = {
  cyan: { css: "#7be3f6", hex: 0x7be3f6 },
  pink: { css: "#e87ab8", hex: 0xe87ab8 },
  lime: { css: "#c6f279", hex: 0xc6f279 }
};
const GARAGE_CAMERA_PRESETS = {
  "front-quarter": { position: [3.35, 1.65, 4.25], target: [0, 0.52, 0] },
  side: { position: [5.8, 1.45, 0.15], target: [0, 0.52, 0] },
  rear: { position: [-3.35, 1.55, -4.15], target: [0, 0.55, 0] }
};
const SHOWROOM_MOODS = {
  studio: {
    hemisphereSky: 0xfff8ee,
    hemisphereGround: 0x161922,
    hemisphereIntensity: 1.35,
    keyColor: 0xfff2dc,
    keyIntensity: 2.8,
    rimColor: 0x9ec5ff,
    rimIntensity: 2.0,
    accentColor: 0xd9be8c,
    accentIntensity: 1.25
  },
  nocturne: {
    hemisphereSky: 0x1e2c4a,
    hemisphereGround: 0x06080d,
    hemisphereIntensity: 0.85,
    keyColor: 0xd9be8c,
    keyIntensity: 2.25,
    rimColor: 0x69eaff,
    rimIntensity: 2.8,
    accentColor: 0x7a9cff,
    accentIntensity: 1.55
  }
};
function loadVehiclePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(VEHICLE_PREFERENCE_KEY) || "null");
    if (saved && CAR_LABELS[saved.car]) selectedCar = saved.car;
    if (saved && TRIM_COLORS[saved.trim]) selectedTrim = saved.trim;
  } catch (error) {
    console.error("Could not read the saved vehicle preferences:", error);
  }
  document.documentElement.style.setProperty("--car-trim", TRIM_COLORS[selectedTrim].css);
  syncVehicleControls();
}

function saveVehiclePreferences() {
  try {
    localStorage.setItem(VEHICLE_PREFERENCE_KEY, JSON.stringify({ car: selectedCar, trim: selectedTrim }));
  } catch (error) {
    console.error("Could not save the selected car and trim:", error);
  }
}

loadVehiclePreferences();
const DRIVE_LAP_METERS = 240;
let garageLoadVersion = 0;
let driveWorldPromise;
let driveCar;
let driveWheels = [];

async function loadThreeEngine() {
  if (THREE && gltfLoader) return;
  const [threeModule, gltfModule] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js"),
    import("https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js")
  ]);
  THREE = threeModule;
  gltfLoader = new gltfModule.GLTFLoader();
}

function loadCarAsset(name) {
  if (!CAR_LABELS[name]) return Promise.reject(new Error(`Unknown car model: ${name}`));
  if (!carModelCache.has(name)) {
    const url = new URL(`./assets/cars/${name}.glb`, document.baseURI).href;
    carModelCache.set(name, gltfLoader.loadAsync(url).then((asset) => asset.scene));
  }
  return carModelCache.get(name);
}

function prepareCarModel(source, addNeonEdges = false, neonColor = TRIM_COLORS[selectedTrim].hex) {
  const car = source.clone(true);
  const originalBounds = new THREE.Box3().setFromObject(car);
  const size = originalBounds.getSize(new THREE.Vector3());
  const scale = 3.8 / Math.max(size.z, 0.1);
  car.scale.setScalar(scale);
  const bounds = new THREE.Box3().setFromObject(car);
  const center = bounds.getCenter(new THREE.Vector3());
  car.position.set(-center.x, -bounds.min.y, -center.z);

  car.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.receiveShadow = true;
    if (part.material.map) part.material.map.colorSpace = THREE.SRGBColorSpace;
    if (addNeonEdges) {
      const edges = new THREE.EdgesGeometry(part.geometry, 34);
      const wire = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: neonColor, transparent: true, opacity: 0.78, depthWrite: false })
      );
      wire.scale.setScalar(1.006);
      part.add(wire);
    }
  });
  return car;
}

function disposeCarEdges(car) {
  car.traverse((part) => {
    if (!part.isLineSegments) return;
    part.geometry.dispose();
    part.material.dispose();
  });
}

function resizeGarageRenderer() {
  if (!garageRenderer || !garageCamera) return;
  const canvas = document.querySelector("#car-canvas");
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  garageRenderer.setSize(bounds.width, bounds.height, false);
  garageCamera.aspect = bounds.width / bounds.height;
  garageCamera.fov = bounds.width < 500 ? 44 : 32;
  garageCamera.updateProjectionMatrix();
}

function cancelShowroomCameraTransition() {
  if (garageCameraTransitionFrame === null) return;
  cancelAnimationFrame(garageCameraTransitionFrame);
  garageCameraTransitionFrame = null;
}

function setShowroomCameraPreset(name, duration = 780) {
  const preset = GARAGE_CAMERA_PRESETS[name];
  if (!preset) return;
  selectedCameraPreset = name;
  syncShowroomControls();
  if (!garageCamera || !THREE) return;

  cancelShowroomCameraTransition();
  const startPosition = garageCamera.position.clone();
  const endPosition = new THREE.Vector3(...preset.position);
  const startTarget = garageCameraTarget ? garageCameraTarget.clone() : new THREE.Vector3(0, 0.52, 0);
  const endTarget = new THREE.Vector3(...preset.target);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) duration = 0;
  if (duration <= 0) {
    garageCamera.position.copy(endPosition);
    garageCameraTarget = endTarget;
    garageCamera.lookAt(garageCameraTarget);
    return;
  }

  const startTime = performance.now();
  const animate = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    garageCamera.position.lerpVectors(startPosition, endPosition, ease);
    garageCameraTarget = startTarget.clone().lerp(endTarget, ease);
    garageCamera.lookAt(garageCameraTarget);
    if (progress < 1) {
      garageCameraTransitionFrame = requestAnimationFrame(animate);
    } else {
      garageCameraTransitionFrame = null;
    }
  };
  garageCameraTransitionFrame = requestAnimationFrame(animate);
}

function setShowroomMood(name) {
  const mood = SHOWROOM_MOODS[name];
  if (!mood) return;
  showroomMood = name;
  if (garageHemisphere && garageKeyLight && garageRimLight && garageAccentLight) {
    garageHemisphere.color.setHex(mood.hemisphereSky);
    garageHemisphere.groundColor.setHex(mood.hemisphereGround);
    garageHemisphere.intensity = mood.hemisphereIntensity;
    garageKeyLight.color.setHex(mood.keyColor);
    garageKeyLight.intensity = mood.keyIntensity;
    garageRimLight.color.setHex(mood.rimColor);
    garageRimLight.intensity = mood.rimIntensity;
    garageAccentLight.color.setHex(mood.accentColor);
    garageAccentLight.intensity = mood.accentIntensity;
  }
  syncShowroomControls();
}

async function mountGarageCar() {
  const status = document.querySelector("#car-status");
  const version = ++garageLoadVersion;
  status.textContent = `LOADING ${CAR_LABELS[selectedCar]}`;
  try {
    const source = await loadCarAsset(selectedCar);
    if (version !== garageLoadVersion) return;
    if (garageCar) {
      garageScene.remove(garageCar);
      disposeCarEdges(garageCar);
    }
    garageCar = prepareCarModel(source, true, TRIM_COLORS[selectedTrim].hex);
    garageCar.rotation.y = -0.48;
    garageScene.add(garageCar);
    const stage = document.querySelector("#car-stage");
    stage.classList.remove("is-changing");
    void stage.offsetWidth;
    stage.classList.add("is-changing");
    window.setTimeout(() => stage.classList.remove("is-changing"), 650);
    status.textContent = "READY · DRAG TO ORBIT";
    stage.classList.add("is-ready");
  } catch (error) {
    if (version !== garageLoadVersion) return;
    console.error("BEYOND TOUCH car model failed to load:", error);
    status.textContent = "3D CAR UNAVAILABLE · CHECK ASSETS";
    document.querySelector("#car-stage").classList.add("fallback-only");
  }
}

function resizeStudioCarRenderer() {
  if (!studioCarRenderer || !studioCarCamera) return;
  const canvas = document.querySelector("#studio-car-canvas");
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  studioCarRenderer.setSize(bounds.width, bounds.height, false);
  studioCarCamera.aspect = bounds.width / bounds.height;
  studioCarCamera.updateProjectionMatrix();
}

async function mountStudioCar() {
  const status = document.querySelector("#studio-car-status");
  const version = ++studioCarVersion;
  status.textContent = `LOADING ${CAR_LABELS[selectedCar]}`;
  try {
    const source = await loadCarAsset(selectedCar);
    if (version !== studioCarVersion) return;
    if (studioCar) {
      studioCarScene.remove(studioCar);
      disposeCarEdges(studioCar);
    }
    studioCar = prepareCarModel(source, true, TRIM_COLORS[selectedTrim].hex);
    studioCar.rotation.y = studioCarRotation;
    studioCarScene.add(studioCar);
    document.querySelector("#avatar-caption").textContent = `${CAR_LABELS[selectedCar]} · SELECTED`;
    status.textContent = `READY · ${CAR_LABELS[selectedCar]}`;
  } catch (error) {
    if (version !== studioCarVersion) return;
    console.error("BEYOND TOUCH Studio car preview failed:", error);
    status.textContent = "MODEL FAILED · RETRY";
    showToast("That car could not load. Check the model assets and try again.");
  }
}

function animateStudioCar() {
  studioCarFrame = requestAnimationFrame(animateStudioCar);
  if (!studioCarRenderer || document.hidden || screens.creator.hidden || !stage.classList.contains("is-garage-mode")) return;
  if (studioCar && !studioCarDragging) {
    studioCarRotation += 0.0015;
    studioCar.rotation.y = studioCarRotation;
  }
  studioCarRenderer.render(studioCarScene, studioCarCamera);
}

async function initializeStudioCarExperience() {
  if (studioCarRenderer) {
    resizeStudioCarRenderer();
    mountStudioCar();
    return;
  }
  if (studioCarPromise) return studioCarPromise;
  studioCarPromise = (async () => {
    await loadThreeEngine();
    const canvas = document.querySelector("#studio-car-canvas");
    studioCarRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    studioCarRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    studioCarRenderer.outputColorSpace = THREE.SRGBColorSpace;
    studioCarRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    studioCarRenderer.toneMappingExposure = 1.18;
    studioCarScene = new THREE.Scene();
    studioCarCamera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
    studioCarCamera.position.set(4.4, 2.2, 5.7);
    studioCarCamera.lookAt(0, 0.42, 0);
    studioCarScene.add(new THREE.HemisphereLight(0xd8f3ed, 0x171d1a, 2.1));
    const key = new THREE.DirectionalLight(0xfff0d0, 3.2);
    key.position.set(-4, 6, 5);
    studioCarScene.add(key);
    studioCarRim = new THREE.PointLight(TRIM_COLORS[selectedTrim].hex, 26, 13);
    studioCarRim.position.set(1, 2.4, -3);
    studioCarScene.add(studioCarRim);
    canvas.addEventListener("pointerdown", (event) => {
      studioCarDragging = true;
      studioCarLastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!studioCarDragging || !studioCar) return;
      studioCarRotation += (event.clientX - studioCarLastX) * 0.012;
      studioCarLastX = event.clientX;
      studioCar.rotation.y = studioCarRotation;
    });
    canvas.addEventListener("pointerup", () => { studioCarDragging = false; });
    canvas.addEventListener("pointercancel", () => { studioCarDragging = false; });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      studioCarCamera.position.z = Math.max(3.6, Math.min(8.5, studioCarCamera.position.z + Math.sign(event.deltaY) * 0.45));
    }, { passive: false });
    window.addEventListener("resize", resizeStudioCarRenderer);
    resizeStudioCarRenderer();
    await mountStudioCar();
    animateStudioCar();
  })();
  try {
    await studioCarPromise;
  } catch (error) {
    studioCarPromise = undefined;
    console.error("BEYOND TOUCH Studio garage could not initialize:", error);
    document.querySelector("#studio-car-status").textContent = "3D GARAGE UNAVAILABLE";
    showToast("The 3D garage could not start. Check your connection and try again.");
  }
}

async function initializeCarExperience() {
  const canvas = document.querySelector("#car-canvas");
  try {
    await loadThreeEngine();
    garageRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    garageRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    garageRenderer.outputColorSpace = THREE.SRGBColorSpace;
    garageRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    garageRenderer.toneMappingExposure = 1.12;
    garageScene = new THREE.Scene();
    garageCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
    garageCameraTarget = new THREE.Vector3(...GARAGE_CAMERA_PRESETS[selectedCameraPreset].target);
    garageCamera.position.fromArray(GARAGE_CAMERA_PRESETS[selectedCameraPreset].position);
    garageCamera.lookAt(garageCameraTarget);
    garageHemisphere = new THREE.HemisphereLight(0xfff8ee, 0x161922, 1.35);
    garageHemisphere.position.set(0, 8, 0);
    garageScene.add(garageHemisphere);
    garageKeyLight = new THREE.DirectionalLight(0xfff2dc, 2.8);
    garageKeyLight.position.set(5.5, 7.5, 4.5);
    garageKeyLight.castShadow = true;
    garageScene.add(garageKeyLight);
    garageRimLight = new THREE.DirectionalLight(0x9ec5ff, 2.0);
    garageRimLight.position.set(-5, 4.2, -5.5);
    garageScene.add(garageRimLight);
    garageAccentLight = new THREE.SpotLight(0xd9be8c, 1.25, 18, Math.PI / 4, 0.65, 1);
    garageAccentLight.position.set(0, 1.6, 5.5);
    garageAccentLight.target.position.set(0, 0.5, 0);
    garageScene.add(garageAccentLight, garageAccentLight.target);
    setShowroomCameraPreset(selectedCameraPreset, 0);
    setShowroomMood(showroomMood);
    syncShowroomControls();

    resizeGarageRenderer();
    const resizeObserver = new ResizeObserver(resizeGarageRenderer);
    resizeObserver.observe(canvas);
    await mountGarageCar();

    let dragging = false;
    let previousX = 0;
    const pointerDown = (event) => {
      cancelShowroomCameraTransition();
      if (!garageCar) return;
      dragging = true;
      previousX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging || !garageCar) return;
      garageCar.rotation.y += (event.clientX - previousX) * 0.01;
      previousX = event.clientX;
    });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointercancel", () => { dragging = false; });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      cancelShowroomCameraTransition();
      const offset = garageCamera.position.clone().sub(garageCameraTarget);
      const distance = THREE.MathUtils.clamp(offset.length() + Math.sign(event.deltaY) * 0.45, 3.8, 8.5);
      garageCamera.position.copy(garageCameraTarget).add(offset.normalize().multiplyScalar(distance));
      garageCamera.lookAt(garageCameraTarget);
    }, { passive: false });

    const renderGarage = () => {
      garageFrame = requestAnimationFrame(renderGarage);
      if (document.hidden || screens.welcome.hidden || !garageRenderer) return;
      if (garageCar && !dragging && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        garageCar.rotation.y += 0.0015;
      }
      garageRenderer.render(garageScene, garageCamera);
    };
    renderGarage();
  } catch (error) {
    console.error("BEYOND TOUCH 3D garage could not initialize:", error);
    document.querySelector("#car-status").textContent = "3D GARAGE UNAVAILABLE · CHECK CONNECTION";
    document.querySelector("#car-stage").classList.add("fallback-only");
  }
}

function selectCar(name) {
  if (!CAR_LABELS[name] || selectedCar === name) return;
  selectedCar = name;
  saveVehiclePreferences();
  syncVehicleControls();
  if (garageRenderer) mountGarageCar();
  if (studioCarRenderer) mountStudioCar();
}

function selectTrim(name) {
  if (!TRIM_COLORS[name] || selectedTrim === name) return;
  selectedTrim = name;
  saveVehiclePreferences();
  document.documentElement.style.setProperty("--car-trim", TRIM_COLORS[name].css);
  syncVehicleControls();
  if (studioCarRim) studioCarRim.color.set(TRIM_COLORS[name].hex);
  if (garageRenderer) mountGarageCar();
  if (studioCarRenderer) mountStudioCar();
}

function openDriveScreen(returnTo = "welcome") {
  driveReturnScreen = returnTo;
  stopDriveCamera();
  showScreen("welcome");
  screens.welcome.hidden = true;
  driveScreen.hidden = false;
  document.body.style.overflow = "hidden";
  document.querySelector("#drive-start-overlay").hidden = false;
  document.querySelector("#drive-end-overlay").hidden = true;
  document.querySelector("#drive-camera-card").hidden = true;
  document.querySelector("#drive-mode-label").textContent = "READY? LET'S ROLL!";
  document.querySelector("#drive-setup-message").textContent = "Pick your steering style, then let's race!";
  document.querySelector("#enable-drive").disabled = false;
  document.querySelector("#keyboard-drive").disabled = false;
  document.querySelector("#drive-speed").textContent = "000";
  document.querySelector("#drive-speed-fill").style.width = "0%";
  document.querySelector("#drive-distance").textContent = "0.00";
  document.querySelector("#drive-lap").innerHTML = "01 <i>/ 03</i>";
  document.querySelector("#drive-best").textContent = readBestRaceDistance().toFixed(2);
  ensureDriveWorld().catch((error) => {
    console.error("BEYOND TOUCH race scene could not load:", error);
    document.querySelector("#drive-setup-message").textContent = "The 3D race could not load. Check your connection and car assets.";
  });
}

function closeDriveScreen() {
  driveSetupVersion += 1;
  if (driveState) driveState.running = false;
  stopDriveCamera();
  driveScreen.hidden = true;
  showScreen(driveReturnScreen);
  if (driveReturnScreen === "welcome") showHomeConfigurator();
  if (driveReturnScreen === "creator") selectCategory("garage");
  driveState = undefined;
}

function createTrackMarking(x, z, width, length, color, emissive = 0) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    roughness: 0.48,
    metalness: 0.22
  });
  const mark = new THREE.Mesh(new THREE.BoxGeometry(width, 0.025, length), material);
  mark.position.set(x, 0.015, z);
  driveScene.add(mark);
  return mark;
}

function createRoadsideLight(x, z, index) {
  const postMaterial = new THREE.MeshStandardMaterial({
    color: index % 2 ? 0x334a32 : 0x533024,
    emissive: index % 2 ? 0xd8ff72 : 0xff754d,
    emissiveIntensity: 1.35,
    roughness: 0.4,
    metalness: 0.45
  });
  const post = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.4, 0.18), postMaterial);
  base.position.y = 0.7;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 10, 8),
    new THREE.MeshBasicMaterial({ color: index % 2 ? 0xd8ff72 : 0xff754d })
  );
  lamp.position.y = 1.48;
  post.add(base, lamp);
  post.position.set(x, 0, z);
  driveScene.add(post);
  driveRoadsideLights.push(post);
}

async function ensureDriveWorld() {
  if (driveRenderer) {
    resizeDriveRenderer();
    return;
  }
  if (driveWorldPromise) return driveWorldPromise;

  driveWorldPromise = (async () => {
    await loadThreeEngine();
    const canvas = document.querySelector("#drive-canvas");
    driveRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    driveRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    driveRenderer.outputColorSpace = THREE.SRGBColorSpace;
    driveRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    driveRenderer.toneMappingExposure = 1.16;
    driveScene = new THREE.Scene();
    driveScene.background = new THREE.Color(0x080b16);
    driveScene.fog = new THREE.Fog(0x0b1020, 33, 118);
    driveCamera = new THREE.PerspectiveCamera(63, 1, 0.1, 180);
    driveCamera.position.set(0, 5.3, 11);
    driveCamera.lookAt(0, 0.6, -15);
    driveScene.add(new THREE.HemisphereLight(0x91c9ef, 0x161323, 1.85));
    const moonLight = new THREE.DirectionalLight(0xe4f6ff, 2.1);
    moonLight.position.set(-5, 8, 3);
    driveScene.add(moonLight);
    const driveGlow = new THREE.PointLight(0xd8ff72, 25, 25);
    driveGlow.position.set(-5, 4, -15);
    driveScene.add(driveGlow);
    const pinkGlow = new THREE.PointLight(0xff754d, 20, 22);
    pinkGlow.position.set(5, 3, -28);
    driveScene.add(pinkGlow);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 180),
      new THREE.MeshStandardMaterial({ color: 0x101727, roughness: 0.92, metalness: 0.05 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.08, -52);
    driveScene.add(ground);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 150),
      new THREE.MeshStandardMaterial({ color: 0x171d2a, roughness: 0.68, metalness: 0.24 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -52);
    driveScene.add(road);
    createTrackMarking(-6.8, -52, 0.09, 150, 0xd8ff72, 1.7);
    createTrackMarking(6.8, -52, 0.09, 150, 0xff754d, 1.7);
    for (let z = -127; z < 17; z += 8) {
      driveLoopSegments.push(createTrackMarking(-2.2, z, 0.065, 3.2, 0xa9d9e8, 0.35));
      driveLoopSegments.push(createTrackMarking(2.2, z, 0.065, 3.2, 0xa9d9e8, 0.35));
    }

    for (let index = 0; index < 16; index += 1) {
      const z = -112 + index * 8;
      createRoadsideLight(-8.8, z, index);
      createRoadsideLight(8.8, z, index + 1);
      const height = 5 + (index % 4) * 1.65;
      const buildingMaterial = new THREE.MeshStandardMaterial({
        color: index % 2 ? 0x151b2d : 0x1d1b32,
        emissive: index % 2 ? 0x102e42 : 0x35112e,
        emissiveIntensity: 0.28,
        roughness: 0.88,
        metalness: 0.08
      });
      [-1, 1].forEach((side) => {
        const building = new THREE.Mesh(new THREE.BoxGeometry(4.5, height, 5.2), buildingMaterial);
        building.position.set(side * (13.5 + (index % 3) * 2), height / 2 - 0.1, z);
        driveScene.add(building);
      });
    }

    driveCar = prepareCarModel(await loadCarAsset(selectedCar), true, TRIM_COLORS[selectedTrim].hex);
    driveCar.rotation.y = Math.PI;
    driveCar.position.set(0, 0, 4.1);
    driveScene.add(driveCar);
    driveWheels = [];
    driveCar.traverse((part) => {
      if (part.isMesh && part.name.toLowerCase().includes("wheel")) driveWheels.push(part);
    });
    resizeDriveRenderer();
    window.addEventListener("resize", resizeDriveRenderer);
    driveLastFrame = performance.now();
    animateDriveScene();
  })();
  return driveWorldPromise;
}

function resizeDriveRenderer() {
  if (!driveRenderer || !driveCamera) return;
  const width = Math.max(1, driveScreen.clientWidth || window.innerWidth);
  const height = Math.max(1, driveScreen.clientHeight || window.innerHeight);
  driveRenderer.setSize(width, height, false);
  driveCamera.aspect = width / height;
  driveCamera.updateProjectionMatrix();
}

function makeHazard() {
  const hazard = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0xff633f, emissive: 0x8e2513, emissiveIntensity: 0.7, roughness: 0.65 })
  );
  body.position.y = 0.48;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.14, 0.54),
    new THREE.MeshStandardMaterial({ color: 0xffb444, emissive: 0x71400e, emissiveIntensity: 0.48 })
  );
  base.position.y = 0.08;
  hazard.add(base, body);
  hazard.position.set([-4.4, -1.5, 1.5, 4.4][Math.floor(Math.random() * 4)], 0, -105);
  driveScene.add(hazard);
  driveHazards.push(hazard);
}

function updateDriveHud() {
  if (!driveState) return;
  const speed = Math.round(driveState.speed);
  const distance = driveState.distance / 1000;
  const lap = Math.min(3, Math.floor(driveState.distance / DRIVE_LAP_METERS) + 1);
  document.querySelector("#drive-speed").textContent = String(speed).padStart(3, "0");
  document.querySelector("#drive-speed-fill").style.width = `${Math.min(100, speed / 2.2)}%`;
  document.querySelector("#drive-distance").textContent = distance.toFixed(2);
  document.querySelector("#drive-lap").innerHTML = `${String(lap).padStart(2, "0")} <i>/ 03</i>`;
  document.querySelector("#drive-best").textContent = Math.max(driveState.bestDistance, distance).toFixed(2);
}

function animateDriveScene(now = performance.now()) {
  driveFrame = requestAnimationFrame(animateDriveScene);
  if (!driveRenderer || document.hidden || driveScreen.hidden) {
    driveLastFrame = now;
    return;
  }
  const delta = Math.min(0.05, Math.max(0, (now - driveLastFrame) / 1000));
  driveLastFrame = now;

  if (driveState && driveState.running) {
    const desiredSpeed = driveState.boost ? 218 : driveState.useCamera ? 152 : 138;
    driveState.speed += (desiredSpeed - driveState.speed) * Math.min(1, delta * 1.35);
    const worldFlow = driveState.speed * 0.052;
    driveState.distance += driveState.speed / 3.6 * delta;
    driveState.elapsed += delta;
    driveState.hazardTimer += delta;
    if (driveState.hazardTimer > Math.max(1.05, 2.1 - driveState.speed / 190)) {
      driveState.hazardTimer = 0;
      makeHazard();
    }

    const targetX = driveState.steering * 4.35;
    driveCar.position.x += (targetX - driveCar.position.x) * Math.min(1, delta * 3.2);
    driveCar.rotation.z = (targetX - driveCar.position.x) * 0.035;
    driveCar.rotation.y = Math.PI + driveState.steering * 0.055;
    driveWheels.forEach((wheel) => { wheel.rotation.x -= worldFlow * 0.44; });
    driveLoopSegments.forEach((segment) => {
      segment.position.z += worldFlow * delta;
      if (segment.position.z > 13) segment.position.z -= 144;
    });
    driveRoadsideLights.forEach((light) => {
      light.position.z += worldFlow * delta;
      if (light.position.z > 13) light.position.z -= 128;
    });
    for (let index = driveHazards.length - 1; index >= 0; index -= 1) {
      const hazard = driveHazards[index];
      hazard.position.z += worldFlow * delta;
      hazard.rotation.y += delta * 0.5;
      if (Math.abs(hazard.position.z - driveCar.position.z) < 1.1 && Math.abs(hazard.position.x - driveCar.position.x) < 1.15) {
        finishRace("OOPS! CONE AHEAD!");
        break;
      }
      if (hazard.position.z > 12) {
        driveScene.remove(hazard);
        driveHazards.splice(index, 1);
      }
    }

    const cameraTarget = new THREE.Vector3(driveCar.position.x * 0.27, 3.8, 12);
    driveCamera.position.lerp(cameraTarget, Math.min(1, delta * 2.2));
    driveCamera.lookAt(driveCar.position.x * 0.18, 0.8, -6);
    if (driveState.distance >= DRIVE_LAP_METERS * 3) finishRace("YOU CRUSHED IT!");
    updateDriveHud();
  } else {
    driveCamera.position.lerp(new THREE.Vector3(0, 5.3, 11), 0.025);
    driveCamera.lookAt(0, 0.6, -15);
  }
  driveRenderer.render(driveScene, driveCamera);
}

async function prepareRace(useCamera) {
  const setupVersion = ++driveSetupVersion;
  const setupMessage = document.querySelector("#drive-setup-message");
  const startButton = document.querySelector("#enable-drive");
  const keyboardButton = document.querySelector("#keyboard-drive");
  startButton.disabled = true;
  keyboardButton.disabled = true;
  setupMessage.textContent = "Loading your car and raceway…";
  document.querySelector("#drive-end-overlay").hidden = true;
  document.querySelector("#drive-start-overlay").hidden = false;
  try {
    await ensureDriveWorld();
    if (setupVersion !== driveSetupVersion) return;
    stopDriveCamera();
    driveHazards.forEach((hazard) => driveScene.remove(hazard));
    driveHazards = [];
    driveState = {
      running: false,
      useCamera,
      steering: 0,
      boost: false,
      speed: 0,
      distance: 0,
      elapsed: 0,
      hazardTimer: 0,
      bestDistance: readBestRaceDistance(),
      samples: [],
      centerX: 0.5,
      calibrated: false
    };
    updateDriveHud();

    if (!useCamera) {
      beginRace("KEYBOARD READY · A/D TO SWERVE!");
      document.querySelector("#drive-camera-card").hidden = true;
      setupMessage.textContent = "";
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setupMessage.textContent = "Camera play needs HTTPS or localhost. Keyboard racing is ready anytime!";
      return;
    }
    setupMessage.textContent = "Asking for camera access…";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }
    });
    if (setupVersion !== driveSetupVersion) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    driveStream = stream;
    driveCameraVideo.srcObject = driveStream;
    await driveCameraVideo.play();
    document.querySelector("#drive-camera-card").hidden = false;
    document.querySelector("#drive-status").textContent = "GETTING YOUR HAND READY";
    document.querySelector("#drive-mode-label").textContent = "CAMERA'S ON!";
    driveLandmarker = await loadHandTracker();
    if (setupVersion !== driveSetupVersion) {
      stopDriveCamera();
      return;
    }
    setupMessage.textContent = "Hold your hand in the middle for a moment, then you're off!";
    document.querySelector("#drive-status").textContent = "WAVE HELLO TO START";
    driveLastVideoTime = -1;
    driveTrackingFrame = requestAnimationFrame(animateDriveHands);
  } catch (error) {
    console.error("BEYOND TOUCH webcam permission or race setup failed:", error);
    if (setupVersion !== driveSetupVersion) return;
    stopDriveCamera();
    setupMessage.textContent = error.name === "NotAllowedError"
      ? "No worries! Allow camera access to steer by hand, or try the keyboard."
      : error.name === "NotFoundError"
        ? "We couldn't find a camera. Plug one in or race with the keyboard."
        : "Oops, the camera setup hit a bump. Try again or use the keyboard.";
  } finally {
    if (setupVersion === driveSetupVersion) {
      startButton.disabled = false;
      keyboardButton.disabled = false;
    }
  }
}

function animateDriveHands() {
  if (!driveStream || !driveLandmarker || !driveState || !driveState.useCamera) return;
  try {
    if (driveCameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && driveCameraVideo.currentTime !== driveLastVideoTime) {
      driveLastVideoTime = driveCameraVideo.currentTime;
      const result = driveLandmarker.detectForVideo(driveCameraVideo, performance.now());
      const hand = result.landmarks && result.landmarks[0];
      const indicator = document.querySelector("#drive-hand-indicator");
      if (!hand) {
        indicator.classList.remove("is-live");
        if (driveState.calibrated) {
          driveState.steering *= 0.88;
          driveState.boost = false;
          document.querySelector("#drive-status").textContent = "WHERE'D YOUR HAND GO? SHOW IT AGAIN!";
        } else {
          document.querySelector("#drive-status").textContent = "SHOW YOUR HAND TO THE CAMERA";
        }
      } else {
        indicator.classList.add("is-live");
        const gesture = classifyGesture(hand);
        if (!driveState.calibrated) {
          driveState.samples.push(hand[9].x);
          document.querySelector("#drive-status").textContent = `FINDING YOUR STEERING SPOT · ${Math.min(100, Math.round(driveState.samples.length / 18 * 100))}%`;
          if (driveState.samples.length >= 18) {
            driveState.centerX = driveState.samples.reduce((sum, value) => sum + value, 0) / driveState.samples.length;
            driveState.calibrated = true;
            beginRace("YOU'RE IN! MOVE YOUR HAND TO STEER");
          }
        } else {
          driveState.steering = Math.max(-1, Math.min(1, (driveState.centerX - hand[9].x) * 4.2));
          driveState.boost = gesture === "FIST";
          document.querySelector("#drive-status").textContent = driveState.boost ? "TURBO ON! NICE FIST!" : "GOT YOU! KEEP STEERING";
          document.querySelector("#drive-mode-label").textContent = "HAND STEERING ON · LET'S GO!";
        }
      }
    }
    driveTrackingFrame = requestAnimationFrame(animateDriveHands);
  } catch (error) {
    console.error("BEYOND TOUCH hand tracking failed during the race:", error);
    stopDriveCamera();
    document.querySelector("#drive-setup-message").textContent = "Hand tracking stopped unexpectedly. Retry camera setup or use the keyboard.";
    document.querySelector("#drive-start-overlay").hidden = false;
  }
}

function beginRace(message) {
  if (!driveState) return;
  driveState.running = true;
  driveState.steering = 0;
  document.querySelector("#drive-start-overlay").hidden = true;
  document.querySelector("#drive-end-overlay").hidden = true;
  document.querySelector("#drive-mode-label").textContent = message;
  if (!driveState.useCamera) document.querySelector("#drive-status").textContent = "A/D TO SWERVE · W TO ZOOM!";
}

function finishRace(reason) {
  if (!driveState || !driveState.running) return;
  driveState.running = false;
  driveState.bestDistance = Math.max(driveState.bestDistance, driveState.distance / 1000);
  try {
    localStorage.setItem("beyondTouch.bestRaceDistance", String(driveState.bestDistance));
  } catch (error) {
    console.error("BEYOND TOUCH could not save the race record:", error);
  }
  document.querySelector("#drive-end-title").textContent = reason;
  document.querySelector("#drive-result").textContent = `${(driveState.distance / 1000).toFixed(2)} KM`;
  document.querySelector("#drive-best").textContent = driveState.bestDistance.toFixed(2);
  document.querySelector("#drive-end-overlay").hidden = false;
  document.querySelector("#drive-camera-card").hidden = true;
  document.querySelector("#drive-mode-label").textContent = "THAT WAS FUN!";
  stopDriveCamera();
}

function readBestRaceDistance() {
  try {
    const distance = Number(localStorage.getItem("beyondTouch.bestRaceDistance") || 0);
    return Number.isFinite(distance) ? Math.max(0, distance) : 0;
  } catch (error) {
    console.error("BEYOND TOUCH could not read the race record:", error);
    return 0;
  }
}

function stopDriveCamera() {
  if (driveTrackingFrame) cancelAnimationFrame(driveTrackingFrame);
  driveTrackingFrame = undefined;
  if (driveLandmarker) driveLandmarker.close();
  driveLandmarker = undefined;
  if (driveStream) driveStream.getTracks().forEach((track) => track.stop());
  driveStream = undefined;
  if (driveCameraVideo) {
    driveCameraVideo.pause();
    driveCameraVideo.srcObject = null;
  }
  driveLastVideoTime = -1;
}

function handleDriveKeyDown(event) {
  if (!driveState || !driveState.running || driveState.useCamera) {
    if (event.key === "Escape" && !driveScreen.hidden) closeDriveScreen();
    return;
  }
  if (["ArrowLeft", "a", "A"].includes(event.key)) {
    event.preventDefault();
    driveState.steering = -1;
  } else if (["ArrowRight", "d", "D"].includes(event.key)) {
    event.preventDefault();
    driveState.steering = 1;
  } else if (["ArrowUp", "w", "W", " "].includes(event.key)) {
    event.preventDefault();
    driveState.boost = true;
  } else if (["ArrowDown", "s", "S"].includes(event.key)) {
    event.preventDefault();
    driveState.boost = false;
  }
}

function handleDriveKeyUp(event) {
  if (!driveState || driveState.useCamera) return;
  if (["ArrowLeft", "a", "A", "ArrowRight", "d", "D"].includes(event.key)) driveState.steering = 0;
  if (["ArrowUp", "w", "W", " "].includes(event.key)) driveState.boost = false;
}

applyState();
showScreen("welcome");
initializeCarExperience();
