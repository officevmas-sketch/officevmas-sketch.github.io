let session = null;
let companyProfile = null;
let companyUsers = {};
let latestAttendance = [];
let latestLogs = [];
let mediaRecorder = null;
let audioChunks = [];
let activeCallRef = null;
let heartbeatTimer = null;

const $ = id => document.getElementById(id);

window.addEventListener("load", async () => {
  bindVoiceButton();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  const savedSession = localStorage.getItem("vmas_session");

  if (savedSession) {
    try {
      session = JSON.parse(savedSession);
      $("loginView").classList.add("hidden");
      $("dashboardView").classList.remove("hidden");

      if (session.role === "superAdmin") {
        $("welcomeText").innerText = "Super Admin Dashboard";
        $("superBtn").classList.remove("hidden");
        showTab("super");
        loadCompanies();
      } else {
        const allowed = await enforceSingleLogin(true);
        if (allowed) await enterApp();
      }
    } catch (e) {
      localStorage.removeItem("vmas_session");
    }
  }
});

function planLimit(p) {
  return p === "starter" ? 25 : p === "growth" ? 100 : p === "enterprise" ? 99999 : 10;
}

function getDeviceId() {
  let deviceId = localStorage.getItem("deviceId");
  if (!deviceId) {
    deviceId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "device_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    localStorage.setItem("deviceId", deviceId);
  }
  return deviceId;
}

async function enforceSingleLogin(isRestore = false) {
  if (!session || !session.company || !session.user) return true;

  const deviceId = getDeviceId();
  const sessionRef = db.ref(`companies/${session.company}/activeSessions/${session.user}`);
  const snap = await sessionRef.once("value");

  if (snap.exists()) {
    const existing = snap.val();
    if (existing.deviceId && existing.deviceId !== deviceId) {
      alert("This user is already logged in on another device.");
      localStorage.removeItem("vmas_session");
      session = null;
      location.reload();
      return false;
    }
  }

  await sessionRef.set({
    deviceId,
    user: session.user,
    name: session.name,
    loginTime: isRestore ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
    lastActive: Date.now(),
    deviceInfo: navigator.userAgent
  });

  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (session) sessionRef.update({ lastActive: Date.now() }).catch(() => {});
  }, 30000);

  return true;
}

async function login() {
  const company = $("companyCode").value.trim().toLowerCase();
  const user = $("username").value.trim().toLowerCase();
  const pin = $("pin").value.trim();

  if (!company || !user || !pin) {
    $("loginStatus").innerText = "Enter company, username and PIN.";
    return;
  }

  const companySnap = await db.ref(`companies/${company}/profile`).once("value");
  if (!companySnap.exists()) {
    $("loginStatus").innerText = "Company not found.";
    return;
  }

  const companyData = companySnap.val();
  if (companyData.active === false) {
    $("loginStatus").innerText = "This company account is suspended.";
    return;
  }

  const snap = await db.ref(`companies/${company}/users/${user}`).once("value");
  if (!snap.exists()) {
    $("loginStatus").innerText = "User not found.";
    return;
  }

  const u = snap.val();

  if (u.pin !== pin || u.active === false) {
    $("loginStatus").innerText = "Invalid PIN or inactive user.";
    return;
  }

  session = {
    company,
    user,
    role: u.role || "employee",
    name: u.name || user
  };

  const allowed = await enforceSingleLogin(false);
  if (!allowed) return;

  localStorage.setItem("vmas_session", JSON.stringify(session));

  if ("Notification" in window) Notification.requestPermission().catch(() => {});

  enterApp();
}

async function superAdminLogin() {
  const user = $("username").value.trim().toLowerCase();
  const pin = $("pin").value.trim();

  const snap = await db.ref(`superAdmins/${user}`).once("value");

  if (String(snap.val()) === pin) {
    session = { company: "", user, role: "superAdmin", name: user };
    localStorage.setItem("vmas_session", JSON.stringify(session));

    $("loginView").classList.add("hidden");
    $("dashboardView").classList.remove("hidden");
    $("welcomeText").innerText = "Super Admin Dashboard";
    $("superBtn").classList.remove("hidden");

    showTab("super");
    loadCompanies();
  } else {
    $("loginStatus").innerText = "Invalid Super Admin login.";
  }
}

async function enterApp() {
  $("loginView").classList.add("hidden");
  $("dashboardView").classList.remove("hidden");

  $("welcomeText").innerText = `Welcome, ${session.name}`;

  if (session.role === "companyAdmin") $("adminBtn").classList.remove("hidden");

  await loadCompanyProfile();

  listenUsers();
  listenCalls();
  listenVoice();
  loadAttendance();
  loadLogs();
}

async function loadCompanyProfile() {
  const snap = await db.ref(`companies/${session.company}/profile`).once("value");

  companyProfile = snap.val() || {
    plan: "free",
    userLimit: 10,
    subscriptionStatus: "trial"
  };

  $("planInfo").innerText =
    `Company: ${session.company} | Plan: ${companyProfile.plan} | Limit: ${companyProfile.userLimit}`;

  if ($("adminPlanInfo")) {
    $("adminPlanInfo").innerText =
      `Plan: ${companyProfile.plan} | User Limit: ${companyProfile.userLimit} | Status: ${companyProfile.subscriptionStatus}`;
  }
}

function listenUsers() {
  db.ref(`companies/${session.company}/users`).on("value", snap => {
    companyUsers = snap.val() || {};
    renderEmployees();
    renderAdminUsers();
  });
}

function renderEmployees() {
  const list = $("employeeList");
  const voiceTo = $("voiceTo");

  list.innerHTML = "";
  voiceTo.innerHTML = "";

  Object.entries(companyUsers).forEach(([uid, u]) => {
    if (uid === session.user || u.active === false) return;

    const div = document.createElement("div");
    div.className = "employee";
    div.innerHTML =
      `<b>${esc(u.name || uid)}</b><br><small>${esc(u.department || "General")}</small>`;

    const b = document.createElement("button");
    b.textContent = "Call";
    b.onclick = () => callUser(uid, u.name || uid);

    div.appendChild(b);
    list.appendChild(div);

    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = u.name || uid;
    voiceTo.appendChild(opt);
  });

  if (!list.innerHTML) list.innerHTML = '<p class="muted">No active employees found.</p>';
}

async function callUser(to, toName) {
  const key = db.ref(`companies/${session.company}/calls/${to}`).push().key;

  const call = {
    type: "call",
    from: session.user,
    fromName: session.name,
    to,
    toName,
    status: "ringing",
    time: Date.now()
  };

  await db.ref(`companies/${session.company}/calls/${to}/${key}`).set(call);
  await db.ref(`companies/${session.company}/callLogs/${key}`).set(call);

  alert(`Calling ${toName}`);
}

function listenCalls() {
  if (activeCallRef) activeCallRef.off();

  activeCallRef = db.ref(`companies/${session.company}/calls/${session.user}`);

  activeCallRef.on("child_added", async snap => {
    const call = snap.val();
    if (!call) return;

    $("incomingBox").classList.remove("hidden");
    $("incomingText").innerText = `${call.fromName || call.from} is calling you`;
    $("incomingBox").dataset.key = snap.key;

    playRingtone();

    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("VMAS Workplace Call", {
          body: `${call.fromName || call.from} is calling you`,
          requireInteraction: true
        });
      } catch (e) {}
    }
  });
}

function playRingtone() {
  try {
    const ringtone = $("ringtone");
    ringtone.loop = true;
    ringtone.currentTime = 0;
    ringtone.play().catch(() => {
      console.log("Autoplay blocked until user interacts with page.");
    });
  } catch (e) {}
}

function stopRingtone() {
  try {
    const ringtone = $("ringtone");
    ringtone.pause();
    ringtone.currentTime = 0;
  } catch (e) {}
}

async function ackCall() {
  const key = $("incomingBox").dataset.key;

  $("incomingBox").classList.add("hidden");
  stopRingtone();

  if (key) {
    await db.ref(`companies/${session.company}/calls/${session.user}/${key}`).remove();
    await db.ref(`companies/${session.company}/callLogs/${key}/status`).set("acknowledged");
  }
}

async function punch(type) {
  if (!session) {
    alert("Session expired. Please login again.");
    return;
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  const log = {
    user: session.user,
    name: session.name,
    type,
    timestamp: Date.now(),
    date,
    time: now.toLocaleString(),
    device: navigator.userAgent
  };

  try {
    await db.ref(`companies/${session.company}/attendance/${date}/${session.user}/${type}`).set(log.time);
    await db.ref(`companies/${session.company}/attendanceLogs`).push(log);

    alert(type === "punchIn" ? "Punch In Successful" : "Punch Out Successful");
    loadAttendance();
  } catch (err) {
    console.error(err);
    alert("Attendance sync failed. Please check Firebase rules.");
  }
}

function loadAttendance() {
  db.ref(`companies/${session.company}/attendanceLogs`).limitToLast(100).on("value", snap => {
    latestAttendance = [];

    snap.forEach(s => latestAttendance.push({ id: s.key, ...s.val() }));

    latestAttendance.sort((a, b) => (b.timestamp || b.time || 0) - (a.timestamp || a.time || 0));

    $("attendanceLogs").innerHTML =
      latestAttendance
        .filter(x => x.user === session.user || session.role === "companyAdmin")
        .map(x =>
          `<div class="row">
            <b>${esc(x.name || x.user)}</b><br>
            <small>${esc(x.type)} - ${esc(x.time || "")}</small>
          </div>`
        )
        .join("") || '<p class="muted">No attendance logs.</p>';
  });
}

function exportAttendanceCsv() {
  if (!latestAttendance.length) {
    alert("No attendance data.");
    return;
  }

  const rows = [["User", "Name", "Type", "Date", "Time"]];

  latestAttendance.forEach(x => rows.push([
    x.user || "",
    x.name || "",
    x.type || "",
    x.date || "",
    x.time || ""
  ]));

  const csv = rows
    .map(r => r.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `attendance-${session.company}.csv`;
  a.click();
}

function loadLogs() {
  db.ref(`companies/${session.company}/callLogs`).limitToLast(100).on("value", snap => {
    latestLogs = [];

    snap.forEach(s => latestLogs.push({ id: s.key, ...s.val() }));

    latestLogs.sort((a, b) => (b.time || 0) - (a.time || 0));

    $("callLogs").innerHTML =
      latestLogs
        .map(x =>
          `<div class="row">
            <b>${esc(x.type || "call")}</b> | ${esc(x.fromName || x.from)} → ${esc(x.toName || x.to)}<br>
            <small>${esc(x.status || "")} | ${new Date(x.time).toLocaleString()}</small>
          </div>`
        )
        .join("") || '<p class="muted">No logs.</p>';
  });
}

async function addUser() {
  if (session.role !== "companyAdmin") return alert("Only company admin can add users.");

  const uid = $("newUserId").value.trim().toLowerCase();
  const name = $("newUserName").value.trim();
  const pin = $("newUserPin").value.trim();
  const dept = $("newUserDept").value.trim();

  if (!uid || !pin) return alert("Username and PIN required.");

  const snap = await db.ref(`companies/${session.company}/users`).once("value");
  const exists = snap.child(uid).exists();
  const count = snap.numChildren();

  if (!exists && count >= (companyProfile.userLimit || 10)) {
    alert("User limit reached. Please upgrade plan.");
    return;
  }

  await db.ref(`companies/${session.company}/users/${uid}`).set({
    name: name || uid,
    pin,
    department: dept || "General",
    role: "employee",
    active: true
  });

  $("newUserId").value = "";
  $("newUserName").value = "";
  $("newUserPin").value = "";
  $("newUserDept").value = "";

  alert("User saved.");
}

function renderAdminUsers() {
  if (session?.role !== "companyAdmin") return;

  const box = $("adminUserList");
  if (!box) return;

  box.innerHTML = "";

  Object.entries(companyUsers).forEach(([uid, u]) => {
    const div = document.createElement("div");
    div.className = "row";

    div.innerHTML =
      `<b>${esc(u.name || uid)}</b><br>
       <small>${uid} | ${u.role || "employee"} | ${u.active === false ? "Inactive" : "Active"}</small>`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const tog = document.createElement("button");
    tog.className = u.active === false ? "success" : "danger";
    tog.textContent = u.active === false ? "Activate" : "Deactivate";
    tog.onclick = () =>
      db.ref(`companies/${session.company}/users/${uid}/active`).set(!(u.active !== false));

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.onclick = () => {
      if (confirm("Delete user?")) {
        db.ref(`companies/${session.company}/users/${uid}`).remove();
      }
    };

    actions.append(tog, del);
    div.appendChild(actions);
    box.appendChild(div);
  });
}

async function markStarterPaid() {
  await db.ref(`companies/${session.company}/profile`).update({
    plan: "starter",
    userLimit: 25,
    subscriptionStatus: "active"
  });

  await db.ref(`companies/${session.company}/billing/lastPayment`).set({
    provider: "Razorpay demo",
    status: "paid",
    time: Date.now()
  });

  await loadCompanyProfile();
  alert("Starter plan activated.");
}

async function createCompany() {
  if (session.role !== "superAdmin") return;

  const code = $("newCompanyCode").value.trim().toLowerCase();
  const name = $("newCompanyName").value.trim();
  const plan = $("newCompanyPlan").value;

  if (!code) return alert("Company code required.");

  await db.ref(`companies/${code}/profile`).set({
    companyName: name || code,
    plan,
    userLimit: planLimit(plan),
    subscriptionStatus: plan === "free" ? "trial" : "active",
    active: true
  });

  await db.ref(`companies/${code}/users/admin`).set({
    name: "Company Admin",
    pin: "1234",
    department: "Admin",
    role: "companyAdmin",
    active: true
  });

  alert("Company created. Default login: admin / 1234");
}

function loadCompanies() {
  db.ref("companies").on("value", snap => {
    const box = $("companyList");
    box.innerHTML = "";

    snap.forEach(c => {
      const p = c.child("profile").val() || {};
      const div = document.createElement("div");
      div.className = "row";

      div.innerHTML =
        `<b>${esc(c.key)}</b><br>
         <small>${esc(p.companyName || "")} | ${esc(p.plan || "")} | Limit: ${p.userLimit || ""} | ${p.active === false ? "Suspended" : "Active"}</small>`;

      const tog = document.createElement("button");
      tog.className = p.active === false ? "success" : "danger";
      tog.textContent = p.active === false ? "Activate" : "Suspend";
      tog.onclick = () =>
        db.ref(`companies/${c.key}/profile/active`).set(!(p.active !== false));

      div.appendChild(tog);
      box.appendChild(div);
    });
  });
}

function bindVoiceButton() {
  const btn = $("talkBtn");
  if (!btn) return;

  btn.addEventListener("mousedown", startRecording);
  btn.addEventListener("touchstart", e => {
    e.preventDefault();
    startRecording();
  }, { passive: false });

  btn.addEventListener("mouseup", stopRecording);
  btn.addEventListener("mouseleave", stopRecording);

  btn.addEventListener("touchend", e => {
    e.preventDefault();
    stopRecording();
  }, { passive: false });
}

async function startRecording() {
  const to = $("voiceTo").value;

  if (!to) return alert("Select employee.");
  if (!navigator.mediaDevices?.getUserMedia) return alert("Microphone not supported.");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => {
      if (e.data.size) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      sendVoice(to);
    };

    mediaRecorder.start();

    $("talkBtn").classList.add("recording");
    $("talkBtn").textContent = "🔴 Recording... Release";
  } catch (e) {
    alert("Microphone permission required.");
  }
}

function stopRecording() {
  if (!mediaRecorder) return;

  if (mediaRecorder.state === "recording") mediaRecorder.stop();

  mediaRecorder = null;

  $("talkBtn").classList.remove("recording");
  $("talkBtn").textContent = "🎤 Hold to Talk";
}

async function sendVoice(to) {
  if (!audioChunks.length) return;

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const dataUrl = await blobToDataUrl(blob);

  const key = db.ref(`companies/${session.company}/voiceMessages/${to}`).push().key;

  const msg = {
    type: "voice",
    from: session.user,
    fromName: session.name,
    to,
    toName: companyUsers[to]?.name || to,
    audio: dataUrl,
    status: "sent",
    time: Date.now()
  };

  await db.ref(`companies/${session.company}/voiceMessages/${to}/${key}`).set(msg);

  const log = { ...msg };
  delete log.audio;

  await db.ref(`companies/${session.company}/callLogs/${key}`).set(log);

  $("voiceStatus").innerText = "Voice note sent.";
}

function listenVoice() {
  db.ref(`companies/${session.company}/voiceMessages/${session.user}`).on("child_added", snap => {
    const msg = snap.val();

    if (msg?.audio) {
      new Audio(msg.audio).play().catch(() => {});
      alert(`Voice note from ${msg.fromName || msg.from}`);
      snap.ref.remove();
    }
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function showTab(tab) {
  ["employees", "attendance", "logs", "admin", "super"].forEach(t => {
    const el = $(t + "Tab");
    if (el) el.classList.toggle("hidden", t !== tab);
  });

  if (tab === "super") loadCompanies();
}

async function logout() {
  if (activeCallRef) activeCallRef.off();
  clearInterval(heartbeatTimer);
  stopRingtone();

  if (session && session.company && session.user) {
    try {
      await db.ref(`companies/${session.company}/activeSessions/${session.user}`).remove();
    } catch (e) {}
  }

  localStorage.removeItem("vmas_session");

  session = null;
  location.reload();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[c]));
}
