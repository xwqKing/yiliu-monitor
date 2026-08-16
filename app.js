const MQTT_URL = "wss://broker.emqx.io:8084/mqtt";
const MQTT_TOPIC = "yiliu/483fda021bd9/pressure";
const HISTORY_LIMIT = 48;
const LOG_LIMIT = 30;

const pressures = [null, null, null, null, null];
const history = [];
const logs = [];
let client = null;
let manuallyDisconnected = false;
let demoTimer = null;
let chartSize = { width: 0, height: 0 };

const elements = {
  connectionState: document.getElementById("connectionState"),
  connectionText: document.getElementById("connectionText"),
  connectionButton: document.getElementById("connectionButton"),
  demoButton: document.getElementById("demoButton"),
  activeCount: document.getElementById("activeCount"),
  totalPressure: document.getElementById("totalPressure"),
  peakPressure: document.getElementById("peakPressure"),
  lastUpdate: document.getElementById("lastUpdate"),
  cards: [...document.querySelectorAll(".sensor-card")],
  messageList: document.getElementById("messageList"),
  clearLogButton: document.getElementById("clearLogButton"),
  canvas: document.getElementById("pressureChart")
};

function setConnectionState(state, label) {
  elements.connectionState.dataset.state = state;
  elements.connectionText.textContent = label;
  elements.connectionButton.title = state === "offline" ? "重新连接" : "断开连接";
  elements.connectionButton.setAttribute("aria-label", elements.connectionButton.title);
}

function connectMqtt() {
  if (typeof mqtt === "undefined") {
    setConnectionState("offline", "组件加载失败");
    return;
  }

  manuallyDisconnected = false;
  setConnectionState("connecting", "正在连接");
  client = mqtt.connect(MQTT_URL, {
    clientId: `yiliu_web_${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 3000
  });

  client.on("connect", () => {
    setConnectionState("online", "在线");
    client.subscribe(MQTT_TOPIC, { qos: 0 }, (error) => {
      if (error) setConnectionState("offline", "订阅失败");
    });
  });

  client.on("reconnect", () => setConnectionState("connecting", "正在重连"));
  client.on("offline", () => setConnectionState("offline", "离线"));
  client.on("error", () => setConnectionState("offline", "连接异常"));
  client.on("close", () => {
    if (manuallyDisconnected) setConnectionState("offline", "已断开");
  });
  client.on("message", (_topic, payload) => processMessage(payload.toString()));
}

function disconnectMqtt() {
  manuallyDisconnected = true;
  if (client) {
    client.end(true);
    client = null;
  }
  setConnectionState("offline", "已断开");
}

function processMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    addLog(raw);
    return;
  }

  if (Number.isInteger(Number(data.address)) && Number.isFinite(Number(data.pressure))) {
    const index = Number(data.address) - 1;
    if (index >= 0 && index < pressures.length) pressures[index] = Number(data.pressure);
  }

  pressures.forEach((_value, index) => {
    const key = `pressure${index + 1}`;
    if (Number.isFinite(Number(data[key]))) pressures[index] = Number(data[key]);
  });

  if (pressures[0] !== null) {
    history.push(pressures[0]);
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  addLog(raw);
  renderDashboard();
}

function renderDashboard() {
  const validValues = pressures.filter(Number.isFinite);
  const scale = Math.max(1000, ...validValues);

  elements.cards.forEach((card, index) => {
    const value = pressures[index];
    const valid = Number.isFinite(value);
    card.classList.toggle("online", valid);
    card.querySelector(".sensor-status").textContent = valid ? "已接入" : "未接入";
    card.querySelector(".sensor-value strong").textContent = valid ? Math.round(value) : "--";
    card.querySelector(".pressure-track span").style.width = valid
      ? `${Math.min(100, Math.max(0, value / scale * 100))}%`
      : "0%";
  });

  elements.activeCount.textContent = `${validValues.length} / 5`;
  elements.totalPressure.textContent = validValues.length
    ? Math.round(validValues.reduce((sum, value) => sum + value, 0)).toString()
    : "--";
  elements.peakPressure.textContent = validValues.length ? Math.round(Math.max(...validValues)).toString() : "--";
  elements.lastUpdate.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  drawChart();
}

function addLog(raw) {
  logs.unshift({ time: new Date(), raw });
  if (logs.length > LOG_LIMIT) logs.pop();

  elements.messageList.replaceChildren(...logs.map((item) => {
    const row = document.createElement("div");
    row.className = "message-row";
    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = item.time.toLocaleTimeString("zh-CN", { hour12: false });
    const data = document.createElement("span");
    data.className = "message-data";
    data.textContent = item.raw;
    data.title = item.raw;
    row.append(time, data);
    return row;
  }));
}

function resizeChart() {
  const rect = elements.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  chartSize = { width: rect.width, height: rect.height };
  elements.canvas.width = Math.max(1, Math.round(rect.width * ratio));
  elements.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = elements.canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawChart();
}

function drawChart() {
  const context = elements.canvas.getContext("2d");
  const { width, height } = chartSize;
  if (!width || !height) return;

  context.clearRect(0, 0, width, height);
  const padding = { top: 22, right: 18, bottom: 28, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.strokeStyle = "#e4e9e6";
  context.lineWidth = 1;
  context.fillStyle = "#77817c";
  context.font = "10px Manrope, sans-serif";
  context.textAlign = "right";

  const maxValue = Math.max(100, ...history);
  const axisMax = Math.ceil(maxValue / 100) * 100;
  for (let line = 0; line <= 4; line++) {
    const y = padding.top + plotHeight * line / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(Math.round(axisMax * (1 - line / 4)).toString(), padding.left - 8, y + 3);
  }

  if (history.length < 1) {
    context.fillStyle = "#929b97";
    context.font = "12px 'Noto Sans SC', sans-serif";
    context.textAlign = "center";
    context.fillText("等待压力数据", padding.left + plotWidth / 2, padding.top + plotHeight / 2);
    return;
  }

  context.strokeStyle = "#087a55";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  history.forEach((value, index) => {
    const x = padding.left + (history.length === 1 ? plotWidth : plotWidth * index / (history.length - 1));
    const y = padding.top + plotHeight * (1 - value / axisMax);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const lastValue = history[history.length - 1];
  const lastX = padding.left + plotWidth;
  const lastY = padding.top + plotHeight * (1 - lastValue / axisMax);
  context.fillStyle = "#087a55";
  context.beginPath();
  context.arc(history.length === 1 ? padding.left + plotWidth / 2 : lastX, lastY, 3.5, 0, Math.PI * 2);
  context.fill();
}

function toggleDemo() {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
    elements.demoButton.classList.remove("active");
    return;
  }

  elements.demoButton.classList.add("active");
  let phase = 0;
  demoTimer = setInterval(() => {
    phase += 0.34;
    processMessage(JSON.stringify({
      pressure1: Math.max(0, Math.round(380 + Math.sin(phase) * 260)),
      pressure2: Math.max(0, Math.round(250 + Math.sin(phase * 0.73 + 1) * 180)),
      pressure3: Math.max(0, Math.round(160 + Math.sin(phase * 1.2 + 2) * 120)),
      pressure4: Math.max(0, Math.round(290 + Math.sin(phase * 0.82 + 3) * 210)),
      pressure5: Math.max(0, Math.round(110 + Math.sin(phase * 1.4 + 4) * 90))
    }));
  }, 900);
}

elements.connectionButton.addEventListener("click", () => {
  if (client) disconnectMqtt();
  else connectMqtt();
});
elements.demoButton.addEventListener("click", toggleDemo);
elements.clearLogButton.addEventListener("click", () => {
  logs.length = 0;
  elements.messageList.innerHTML = '<div class="empty-message">等待 MQTT 数据</div>';
});

new ResizeObserver(resizeChart).observe(elements.canvas.parentElement);
if (window.lucide) window.lucide.createIcons();
connectMqtt();
