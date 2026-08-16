const MQTT_URL = "wss://broker.emqx.io:8084/mqtt";
const PRESSURE_TOPIC = "yiliu/483fda021bd9/pressure";
const HEART_TOPIC = "yiliu/483fda021bd9/heart";
const MAX_HISTORY = 90;
const PRESSURE_STALE_MS = 10000;
const HEART_STALE_MS = 5000;
const SERIES_COLORS = ["#13795b", "#2764c5", "#b56a00", "#8a4fac", "#287f86"];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  client: null,
  connected: false,
  pressures: [null, null, null, null, null],
  pressureHistory: [[], [], [], [], []],
  heartRate: null,
  heartHistory: [],
  lastPressureAt: null,
  lastHeartAt: null,
  lastDataAt: null,
  messages: []
};

const elements = {
  connection: document.getElementById("connectionState"),
  connectionText: document.getElementById("connectionText"),
  reconnectButton: document.getElementById("reconnectButton"),
  pressureTopicState: document.getElementById("pressureTopicState"),
  heartTopicState: document.getElementById("heartTopicState"),
  lastUpdateText: document.getElementById("lastUpdateText"),
  pressureCards: [...document.querySelectorAll(".pressure-card")],
  pressureScale: document.getElementById("pressureScale"),
  pressureCanvas: document.getElementById("pressureChart"),
  pressureChartEmpty: document.getElementById("pressureChartEmpty"),
  heartValue: document.getElementById("heartValue"),
  heartIcon: document.getElementById("heartIcon"),
  heartLiveIndicator: document.getElementById("heartLiveIndicator"),
  heartCanvas: document.getElementById("heartMiniChart"),
  heartChartEmpty: document.getElementById("heartChartEmpty"),
  messageList: document.getElementById("messageList"),
  messageCount: document.getElementById("messageCount")
};

function connectMqtt() {
  if (typeof mqtt === "undefined") {
    setConnection("offline", "MQTT 组件加载失败");
    addMessage("system", "无法加载 MQTT.js，请检查电脑网络");
    return;
  }

  if (state.client) {
    state.client.end(true);
    state.client = null;
  }

  setConnection("connecting", "正在连接 MQTT");
  elements.reconnectButton.classList.add("is-busy");

  state.client = mqtt.connect(MQTT_URL, {
    clientId: `yiliu_web_${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 2500,
    keepalive: 45
  });

  state.client.on("connect", () => {
    state.connected = true;
    setConnection("online", "MQTT 已连接");
    elements.reconnectButton.classList.remove("is-busy");
    state.client.subscribe([PRESSURE_TOPIC, HEART_TOPIC], { qos: 0 }, error => {
      if (error) {
        addMessage("system", `订阅失败：${error.message}`);
        return;
      }
      addMessage("system", "已订阅压力与心率真实数据");
    });
  });

  state.client.on("reconnect", () => {
    state.connected = false;
    setConnection("connecting", "正在重新连接");
    elements.reconnectButton.classList.add("is-busy");
  });

  state.client.on("close", () => {
    state.connected = false;
    setConnection("offline", "MQTT 已断开");
  });

  state.client.on("offline", () => {
    state.connected = false;
    setConnection("offline", "网络不可用");
  });

  state.client.on("error", error => {
    setConnection("offline", "MQTT 连接错误");
    elements.reconnectButton.classList.remove("is-busy");
    addMessage("system", error.message);
  });

  state.client.on("message", (topic, payload) => {
    handleMqttMessage(topic, payload.toString());
  });
}

function handleMqttMessage(topic, text) {
  if (text.trim().toLowerCase() === "hello") {
    addMessage("system", "设备已发布上线测试消息 hello");
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_error) {
    addMessage("system", `忽略非 JSON 消息：${text}`);
    return;
  }

  if (topic === PRESSURE_TOPIC) {
    processPressureData(data, text);
  } else if (topic === HEART_TOPIC) {
    processHeartData(data, text);
  }
}

function processPressureData(data, rawText) {
  const nextValues = [...state.pressures];
  let changed = false;

  for (let index = 0; index < 5; index += 1) {
    const value = Number(data[`pressure${index + 1}`]);
    if (Number.isFinite(value)) {
      nextValues[index] = Math.max(0, value);
      changed = true;
    }
  }

  const address = Number(data.address);
  const singleValue = Number(data.pressure);
  if (Number.isInteger(address) && address >= 1 && address <= 5 && Number.isFinite(singleValue)) {
    nextValues[address - 1] = Math.max(0, singleValue);
    changed = true;
  }

  if (!changed) {
    addMessage("system", `压力字段无效：${rawText}`);
    return;
  }

  const now = Date.now();
  state.pressures = nextValues;
  state.lastPressureAt = now;
  state.lastDataAt = now;

  nextValues.forEach((value, index) => {
    if (Number.isFinite(value)) {
      state.pressureHistory[index].push({ time: now, value });
      trimHistory(state.pressureHistory[index]);
    }
  });

  updatePressureCards();
  drawPressureChart();
  addMessage("pressure", rawText);
}

function processHeartData(data, rawText) {
  const value = Number(data.heart_rate);
  if (!Number.isFinite(value) || value < 0) {
    addMessage("system", `心率字段无效：${rawText}`);
    return;
  }

  const now = Date.now();
  state.heartRate = Math.round(value);
  state.lastHeartAt = now;
  state.lastDataAt = now;
  state.heartHistory.push({ time: now, value: state.heartRate });
  trimHistory(state.heartHistory);

  elements.heartValue.textContent = String(state.heartRate);
  elements.heartIcon.style.setProperty("--beat-duration", `${60 / Math.max(30, state.heartRate)}s`);
  elements.heartIcon.classList.toggle("is-beating", !prefersReducedMotion);
  elements.heartChartEmpty.hidden = true;
  drawHeartChart();
  addMessage("heart", rawText);
}

function updatePressureCards() {
  const validValues = state.pressures.filter(Number.isFinite);
  const scale = Math.max(1000, ...validValues);
  elements.pressureScale.textContent = Math.ceil(scale).toLocaleString("zh-CN");

  elements.pressureCards.forEach((card, index) => {
    const value = state.pressures[index];
    const valid = Number.isFinite(value);
    card.classList.toggle("is-live", valid);
    card.querySelector(".sensor-value strong").textContent = valid ? Math.round(value).toLocaleString("zh-CN") : "--";
    card.querySelector(".sensor-status").textContent = valid ? "实时" : "等待";
    card.querySelector(".pressure-meter span").style.width = valid ? `${Math.min(100, value / scale * 100)}%` : "0%";
    card.querySelector(".sensor-time").textContent = valid ? `更新于 ${formatClock(state.lastPressureAt)}` : "尚未更新";
  });

  elements.pressureChartEmpty.hidden = validValues.length > 0;
}

function addMessage(type, payload) {
  state.messages.unshift({ type, payload, time: new Date() });
  if (state.messages.length > 20) state.messages.length = 20;
  renderMessages();
}

function renderMessages() {
  elements.messageCount.textContent = `${state.messages.length} 条`;
  elements.messageList.replaceChildren();

  state.messages.slice(0, 7).forEach(message => {
    const row = document.createElement("div");
    row.className = "message-row";
    const labels = { pressure: "压力", heart: "心率", system: "系统" };
    row.innerHTML = `
      <span class="message-time">${formatClock(message.time)}</span>
      <span class="message-type ${message.type}">${labels[message.type]}</span>
      <span class="message-payload"></span>`;
    row.querySelector(".message-payload").textContent = message.payload;
    elements.messageList.appendChild(row);
  });
}

function setConnection(status, text) {
  elements.connection.dataset.state = status;
  elements.connectionText.textContent = text;
}

function updateFreshness() {
  const now = Date.now();
  updateTopicState(elements.pressureTopicState, state.lastPressureAt, PRESSURE_STALE_MS);
  updateTopicState(elements.heartTopicState, state.lastHeartAt, HEART_STALE_MS);

  const pressureFresh = state.lastPressureAt && now - state.lastPressureAt <= PRESSURE_STALE_MS;
  elements.pressureCards.forEach((card, index) => {
    if (!Number.isFinite(state.pressures[index])) return;
    card.classList.toggle("is-live", Boolean(pressureFresh));
    card.querySelector(".sensor-status").textContent = pressureFresh ? "实时" : "已超时";
    card.querySelector(".sensor-time").textContent = relativeTime(state.lastPressureAt);
  });

  const heartFresh = state.lastHeartAt && now - state.lastHeartAt <= HEART_STALE_MS;
  elements.heartLiveIndicator.dataset.state = state.lastHeartAt ? (heartFresh ? "live" : "stale") : "waiting";
  elements.heartLiveIndicator.lastChild.textContent = state.lastHeartAt ? (heartFresh ? "实时" : "已超时") : "等待";
  elements.heartIcon.classList.toggle("is-beating", Boolean(heartFresh) && !prefersReducedMotion);

  elements.lastUpdateText.textContent = state.lastDataAt ? relativeTime(state.lastDataAt) : "尚未收到真实数据";
}

function updateTopicState(element, timestamp, staleMs) {
  if (!timestamp) {
    element.dataset.state = "waiting";
    element.textContent = "等待数据";
    return;
  }
  const fresh = Date.now() - timestamp <= staleMs;
  element.dataset.state = fresh ? "live" : "stale";
  element.textContent = fresh ? "实时接收" : "数据已超时";
}

function drawPressureChart() {
  const histories = state.pressureHistory;
  const values = histories.flatMap(series => series.map(point => point.value));
  if (!values.length) return;

  drawCanvas(elements.pressureCanvas, (context, width, height, ratio) => {
    const padding = { left: 46 * ratio, right: 14 * ratio, top: 12 * ratio, bottom: 28 * ratio };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const yMax = niceMaximum(Math.max(1000, ...values));
    const times = histories.flatMap(series => series.map(point => point.time));
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times, minTime + 1000);

    drawGrid(context, padding, plotWidth, plotHeight, yMax, ratio);

    histories.forEach((series, seriesIndex) => {
      if (!series.length) return;
      context.beginPath();
      context.strokeStyle = SERIES_COLORS[seriesIndex];
      context.lineWidth = 2 * ratio;
      context.lineJoin = "round";
      context.lineCap = "round";
      series.forEach((point, index) => {
        const x = padding.left + ((point.time - minTime) / (maxTime - minTime)) * plotWidth;
        const y = padding.top + plotHeight - (point.value / yMax) * plotHeight;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    });

    drawTimeLabels(context, minTime, maxTime, padding, plotWidth, height, ratio);
  });
}

function drawHeartChart() {
  drawCanvas(elements.heartCanvas, (context, width, height, ratio) => {
    drawEcgGrid(context, width, height, ratio);

    const fresh = state.lastHeartAt && Date.now() - state.lastHeartAt <= HEART_STALE_MS;
    const baseline = height * 0.59;
    context.beginPath();
    context.strokeStyle = fresh ? "#55e49a" : "#466b60";
    context.shadowColor = fresh ? "rgba(85, 228, 154, 0.55)" : "transparent";
    context.shadowBlur = fresh ? 5 * ratio : 0;
    context.lineWidth = 1.8 * ratio;
    context.lineJoin = "round";
    context.lineCap = "round";

    const bpm = Math.max(30, state.heartRate || 60);
    const beatIntervalMs = 60000 / bpm;
    const windowMs = 5000;
    const now = prefersReducedMotion ? 0 : performance.now();

    for (let x = 0; x <= width; x += Math.max(1, ratio)) {
      let y = baseline;
      if (fresh) {
        const sampleTime = now - (width - x) / width * windowMs;
        const phase = ((sampleTime % beatIntervalMs) + beatIntervalMs) % beatIntervalMs / beatIntervalMs;
        y -= ecgWave(phase) * height * 0.34;
      }
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    context.shadowBlur = 0;
  });
}

function drawEcgGrid(context, width, height, ratio) {
  const minor = 10 * ratio;
  const major = minor * 5;

  context.lineWidth = ratio;
  for (let x = 0; x <= width; x += minor) {
    context.beginPath();
    context.strokeStyle = x % major === 0 ? "#244238" : "#182c27";
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += minor) {
    context.beginPath();
    context.strokeStyle = y % major === 0 ? "#244238" : "#182c27";
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function ecgWave(phase) {
  const gaussian = (center, width, amplitude) => {
    const distance = (phase - center) / width;
    return amplitude * Math.exp(-0.5 * distance * distance);
  };

  return gaussian(0.18, 0.035, 0.11)
    + gaussian(0.295, 0.012, -0.18)
    + gaussian(0.325, 0.008, 1.0)
    + gaussian(0.355, 0.014, -0.33)
    + gaussian(0.58, 0.065, 0.22);
}

function animateHeartChart() {
  drawHeartChart();
  requestAnimationFrame(animateHeartChart);
}

function drawCanvas(canvas, draw) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  draw(context, width, height, ratio);
}

function drawGrid(context, padding, plotWidth, plotHeight, yMax, ratio) {
  context.font = `${11 * ratio}px "Segoe UI", sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + plotHeight * index / 4;
    context.beginPath();
    context.strokeStyle = "#e4e8ed";
    context.lineWidth = ratio;
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + plotWidth, y);
    context.stroke();
    context.fillStyle = "#7a8594";
    context.fillText(String(Math.round(yMax * (1 - index / 4))), padding.left - 8 * ratio, y);
  }
}

function drawTimeLabels(context, minTime, maxTime, padding, plotWidth, height, ratio) {
  context.font = `${10 * ratio}px "Segoe UI", sans-serif`;
  context.fillStyle = "#7a8594";
  context.textBaseline = "bottom";
  context.textAlign = "left";
  context.fillText(formatClock(minTime), padding.left, height - 2 * ratio);
  context.textAlign = "right";
  context.fillText(formatClock(maxTime), padding.left + plotWidth, height - 2 * ratio);
}

function niceMaximum(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return Math.ceil(value / magnitude) * magnitude;
}

function trimHistory(history) {
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function formatClock(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 2) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

elements.reconnectButton.addEventListener("click", connectMqtt);
window.addEventListener("resize", () => {
  drawPressureChart();
  drawHeartChart();
});

setInterval(updateFreshness, 1000);
if (window.lucide) lucide.createIcons();
if (!prefersReducedMotion) requestAnimationFrame(animateHeartChart);
connectMqtt();
