import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ─── Storage helpers ───────────────────────────────────────────────
const storeGet = async (key) => {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
};
const storeSet = async (key, val) => {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
};

// ─── Helpers ───────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};
const hoursFromMs = (ms) => ms / 3600000;
const fmtHours = (h) => {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}u ${pad(mins)}m`;
};
const getWeekNumber = (dateStr, startDateStr) => {
  if (!startDateStr) return 1;
  const start = new Date(startDateStr);
  start.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const diff = d - start;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
};
const DAYS_NL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
const getDayName = (dateStr) => DAYS_NL[new Date(dateStr).getDay()];

// ─── Export to Excel ───────────────────────────────────────────────
const exportExcel = (entries, startDate, username) => {
  const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalHours = sorted.reduce((sum, e) => sum + (e.hours || 0), 0);

  const rows = sorted.map((e) => ({
    Week: `Week ${getWeekNumber(e.date, startDate)}`,
    Dag: getDayName(e.date),
    Datum: fmtDate(e.date),
    "Ingewerkt van": fmtTime(e.clockIn),
    "Tot": fmtTime(e.clockOut),
    "Uren die dag": parseFloat((e.hours || 0).toFixed(2)),
  }));

  rows.push({});
  rows.push({
    Week: "",
    Dag: "",
    Datum: "TOTAAL",
    "Ingewerkt van": "",
    "Tot": "",
    "Uren die dag": parseFloat(totalHours.toFixed(2)),
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stage Uren");
  XLSX.writeFile(wb, `stage-uren-${username}.xlsx`);
};

// ─── App ────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("login"); // login | register | dashboard | hours | manual | settings
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [clockedIn, setClockedIn] = useState(null); // ISO string when clocked in
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState(null);

  // Login form
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // Manual entry form
  const [manDate, setManDate] = useState(new Date().toISOString().slice(0, 10));
  const [manStart, setManStart] = useState("09:00");
  const [manEnd, setManEnd] = useState("17:00");

  // Settings
  const [settingsStart, setSettingsStart] = useState("");
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // Tick clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load session
  useEffect(() => {
    (async () => {
      const sess = await storeGet("session");
      if (sess?.username) {
        const ud = await storeGet(`user:${sess.username}`);
        if (ud) {
          setCurrentUser(sess.username);
          setUserData(ud);
          setSettingsStart(ud.startDate || "");
          const ci = await storeGet(`clockedin:${sess.username}`);
          if (ci) setClockedIn(ci.time);
          setScreen("dashboard");
        }
      }
    })();
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveUserData = async (username, data) => {
    await storeSet(`user:${username}`, data);
    setUserData(data);
  };

  // ── Auth ──
  const handleLogin = async () => {
    setLoginErr("");
    const ud = await storeGet(`user:${loginUser}`);
    if (!ud) { setLoginErr("Gebruiker niet gevonden"); return; }
    if (ud.password !== loginPass) { setLoginErr("Wachtwoord onjuist"); return; }
    await storeSet("session", { username: loginUser });
    setCurrentUser(loginUser);
    setUserData(ud);
    setSettingsStart(ud.startDate || "");
    const ci = await storeGet(`clockedin:${loginUser}`);
    if (ci) setClockedIn(ci.time);
    setScreen("dashboard");
    setLoginUser(""); setLoginPass("");
  };

  const handleRegister = async () => {
    setLoginErr("");
    if (!loginUser || !loginPass) { setLoginErr("Vul alle velden in"); return; }
    const existing = await storeGet(`user:${loginUser}`);
    if (existing) { setLoginErr("Gebruikersnaam al in gebruik"); return; }
    const newUser = { password: loginPass, startDate: "", entries: [] };
    await storeSet(`user:${loginUser}`, newUser);
    await storeSet("session", { username: loginUser });
    setCurrentUser(loginUser);
    setUserData(newUser);
    setSettingsStart("");
    setScreen("settings");
    setLoginUser(""); setLoginPass("");
    showToast("Account aangemaakt! Stel je startdatum in 🎉");
  };

  const handleLogout = async () => {
    await storeSet("session", null);
    setCurrentUser(null);
    setUserData(null);
    setClockedIn(null);
    setScreen("login");
  };

  // ── Clock in/out ──
  const handleClockIn = async () => {
    const time = new Date().toISOString();
    await storeSet(`clockedin:${currentUser}`, { time });
    setClockedIn(time);
    showToast("Ingeklokt! 🟢");
  };

  const handleClockOut = async () => {
    if (!clockedIn) return;
    const outTime = new Date().toISOString();
    const inDate = new Date(clockedIn);
    const outDate = new Date(outTime);
    const hours = hoursFromMs(outDate - inDate);
    const dateStr = inDate.toISOString().slice(0, 10);

    const newEntry = {
      id: Date.now(),
      date: dateStr,
      clockIn: clockedIn,
      clockOut: outTime,
      hours,
      manual: false,
    };

    const updated = { ...userData, entries: [...(userData.entries || []), newEntry] };
    await saveUserData(currentUser, updated);
    await storeSet(`clockedin:${currentUser}`, null);
    setClockedIn(null);
    showToast(`Uitgeklokt! ${fmtHours(hours)} geregistreerd ✅`);
  };

  // ── Manual entry ──
  const handleManualAdd = async () => {
    if (!manDate || !manStart || !manEnd) { showToast("Vul alle velden in"); return; }
    const inISO = new Date(`${manDate}T${manStart}:00`).toISOString();
    const outISO = new Date(`${manDate}T${manEnd}:00`).toISOString();
    if (new Date(outISO) <= new Date(inISO)) { showToast("Eindtijd moet na starttijd zijn"); return; }
    const hours = hoursFromMs(new Date(outISO) - new Date(inISO));
    const newEntry = {
      id: Date.now(),
      date: manDate,
      clockIn: inISO,
      clockOut: outISO,
      hours,
      manual: true,
    };
    const updated = { ...userData, entries: [...(userData.entries || []), newEntry] };
    await saveUserData(currentUser, updated);
    showToast("Uren handmatig toegevoegd ✅");
    setManStart("09:00");
    setManEnd("17:00");
  };

  const handleDeleteEntry = async (id) => {
    const updated = { ...userData, entries: userData.entries.filter((e) => e.id !== id) };
    await saveUserData(currentUser, updated);
    showToast("Verwijderd");
  };

  // ── Settings ──
  const handleSaveSettings = async () => {
    const updated = { ...userData, startDate: settingsStart };
    await saveUserData(currentUser, updated);
    showToast("Instellingen opgeslagen ✅");
  };

  const handleEndStage = async () => {
    exportExcel(userData.entries || [], userData.startDate, currentUser);
    const updated = { ...userData, ended: true, endDate: new Date().toISOString() };
    await saveUserData(currentUser, updated);
    setShowEndConfirm(false);
    showToast("Stage afgesloten! Excel gedownload 🎓");
  };

  // ── Computed ──
  const entries = userData?.entries || [];
  const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const currentSessionHours = clockedIn ? hoursFromMs(now - new Date(clockedIn)) : 0;

  // Group entries by week
  const byWeek = {};
  entries.forEach((e) => {
    const wk = getWeekNumber(e.date, userData?.startDate);
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(e);
  });

  // ─────────────── RENDER ──────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0e0d",
      color: "#f0ece4",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column",
      maxWidth: 480,
      margin: "0 auto",
      position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input { outline: none; }
        button { cursor: pointer; border: none; outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #1a1917; }
        ::-webkit-scrollbar-thumb { background: #ff6b2b; border-radius: 2px; }

        .nav-btn { 
          flex: 1; padding: 12px 0; background: none; color: #888; 
          font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 500;
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          transition: color .2s;
          letter-spacing: .04em; text-transform: uppercase;
        }
        .nav-btn.active { color: #ff6b2b; }
        .nav-btn svg { width: 22px; height: 22px; }

        .input-field {
          width: 100%; padding: 14px 16px;
          background: #1c1a18; border: 1.5px solid #2e2b27;
          border-radius: 12px; color: #f0ece4;
          font-family: 'DM Sans', sans-serif; font-size: 16px;
          transition: border-color .2s;
        }
        .input-field:focus { border-color: #ff6b2b; }
        .input-field::placeholder { color: #555; }

        .btn-primary {
          width: 100%; padding: 16px;
          background: #ff6b2b; color: #fff; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 700;
          letter-spacing: .02em;
          transition: background .2s, transform .1s;
          active: { transform: scale(.97); }
        }
        .btn-primary:active { transform: scale(.97); background: #e55c1e; }
        .btn-secondary {
          width: 100%; padding: 14px;
          background: #1c1a18; color: #f0ece4; border-radius: 12px;
          border: 1.5px solid #2e2b27;
          font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500;
          transition: border-color .2s, transform .1s;
        }
        .btn-secondary:active { transform: scale(.97); }
        .btn-secondary:hover { border-color: #ff6b2b; color: #ff6b2b; }

        .card {
          background: #1a1917; border-radius: 16px;
          border: 1px solid #272421; padding: 20px;
        }

        .tag { 
          display: inline-block; padding: 3px 10px; border-radius: 6px;
          font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
        }
        .tag-manual { background: #2a2018; color: #e8a04a; border: 1px solid #3a2e1e; }
        .tag-auto { background: #182a1a; color: #4ae870; border: 1px solid #1e3a22; }

        @keyframes fadeIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
        .fade-in { animation: fadeIn .3s ease; }

        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        .pulse { animation: pulse 1.5s ease infinite; }

        @keyframes toastIn { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
        .toast { animation: toastIn .25s ease; }

        .clock-btn {
          width: 200px; height: 200px; border-radius: 50%;
          border: none; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
          font-family: 'DM Sans', sans-serif; font-weight: 800; font-size: 20px;
          letter-spacing: .06em; text-transform: uppercase;
          transition: all .25s;
          box-shadow: 0 0 0 8px rgba(255,107,43,.1), 0 0 0 16px rgba(255,107,43,.04);
          position: relative; overflow: hidden;
        }
        .clock-btn::before {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.12), transparent 60%);
        }
        .clock-btn.in { background: linear-gradient(135deg, #ff6b2b, #ff8c00); color: #fff; }
        .clock-btn.out { background: linear-gradient(135deg, #1a2e1a, #0f1e0f); color: #4ae870; border: 2px solid #2a4a2a; }
        .clock-btn:active { transform: scale(.94); }
        .clock-btn .icon { font-size: 36px; }
        .clock-btn .sub { font-size: 12px; font-weight: 500; opacity: .8; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "#272421", border: "1px solid #3a3530",
          padding: "12px 22px", borderRadius: 12,
          fontSize: 14, fontWeight: 500, zIndex: 999, whiteSpace: "nowrap",
          boxShadow: "0 8px 32px rgba(0,0,0,.5)",
          color: "#f0ece4",
        }}>{toast}</div>
      )}

      {/* ─── LOGIN / REGISTER ────────────────────────── */}
      {(screen === "login" || screen === "register") && (
        <div className="fade-in" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 28px" }}>
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>⏱️</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 28, fontWeight: 700, color: "#ff6b2b", letterSpacing: "-.01em" }}>StageTimer</div>
            <div style={{ color: "#666", fontSize: 14, marginTop: 6 }}>Jouw stage-uren, simpel bijgehouden</div>
          </div>

          <div style={{ display: "flex", gap: 0, marginBottom: 28, background: "#1a1917", borderRadius: 12, padding: 4 }}>
            {["login", "register"].map((s) => (
              <button key={s} onClick={() => { setScreen(s); setLoginErr(""); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 9,
                  background: screen === s ? "#ff6b2b" : "none",
                  color: screen === s ? "#fff" : "#888",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600,
                  border: "none", cursor: "pointer", transition: "all .2s",
                }}>
                {s === "login" ? "Inloggen" : "Registreren"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input className="input-field" placeholder="Gebruikersnaam" value={loginUser}
              onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" />
            <input className="input-field" type="password" placeholder="Wachtwoord" value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)} autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && (screen === "login" ? handleLogin() : handleRegister())} />

            {loginErr && <div style={{ color: "#ff4a4a", fontSize: 13, paddingLeft: 4 }}>{loginErr}</div>}

            <button className="btn-primary" style={{ marginTop: 8 }}
              onClick={screen === "login" ? handleLogin : handleRegister}>
              {screen === "login" ? "Inloggen →" : "Account aanmaken →"}
            </button>
          </div>
        </div>
      )}

      {/* ─── MAIN APP ────────────────────────────────── */}
      {!["login", "register"].includes(screen) && (
        <>
          {/* Content area */}
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>

            {/* ── DASHBOARD ── */}
            {screen === "dashboard" && (
              <div className="fade-in" style={{ padding: "32px 24px 0" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
                  <div>
                    <div style={{ color: "#666", fontSize: 13, letterSpacing: ".04em", textTransform: "uppercase" }}>Hey,</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, fontWeight: 700, color: "#ff6b2b" }}>{currentUser}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 26, fontWeight: 700 }}>
                      {pad(now.getHours())}:{pad(now.getMinutes())}
                    </div>
                    <div style={{ color: "#555", fontSize: 12 }}>{fmtDate(now.toISOString())}</div>
                  </div>
                </div>

                {/* Clock button */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
                  <button className={`clock-btn ${clockedIn ? "out" : "in"}`}
                    onClick={clockedIn ? handleClockOut : handleClockIn}>
                    <span className="icon">{clockedIn ? "⏹" : "▶"}</span>
                    <span>{clockedIn ? "Uitkloppen" : "Inkloppen"}</span>
                    {clockedIn && <span className="sub pulse">● Actief</span>}
                  </button>
                </div>

                {/* Active session */}
                {clockedIn && (
                  <div className="card" style={{ marginBottom: 16, borderColor: "#2a4a2a" }}>
                    <div style={{ color: "#4ae870", fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Huidige sessie</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 28, fontWeight: 700 }}>
                          {fmtHours(currentSessionHours)}
                        </div>
                        <div style={{ color: "#555", fontSize: 12 }}>Ingeklokt om {fmtTime(clockedIn)}</div>
                      </div>
                      <div style={{ fontSize: 36, className: "pulse" }}>🟢</div>
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div className="card">
                    <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Totaal</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 20, fontWeight: 700, color: "#ff6b2b" }}>
                      {fmtHours(totalHours)}
                    </div>
                  </div>
                  <div className="card">
                    <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Dagen</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 20, fontWeight: 700 }}>
                      {new Set(entries.map((e) => e.date)).size}
                    </div>
                  </div>
                </div>

                {/* Stage week indicator */}
                {userData?.startDate && (
                  <div className="card" style={{ marginBottom: 8 }}>
                    <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Stage voortgang</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 14 }}>
                        Week <span style={{ color: "#ff6b2b", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
                          {getWeekNumber(now.toISOString().slice(0, 10), userData.startDate)}
                        </span>
                      </div>
                      <div style={{ color: "#555", fontSize: 12 }}>Start: {fmtDate(userData.startDate)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── HOURS ── */}
            {screen === "hours" && (
              <div className="fade-in" style={{ padding: "32px 24px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 20, fontWeight: 700 }}>Mijn Uren</div>
                  <div style={{ background: "#1e1511", border: "1px solid #3a2a1e", borderRadius: 8, padding: "6px 12px", fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#ff6b2b" }}>
                    {fmtHours(totalHours)} totaal
                  </div>
                </div>

                {entries.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#555", paddingTop: 60 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <div>Nog geen uren geregistreerd</div>
                  </div>
                ) : (
                  Object.keys(byWeek).sort((a, b) => a - b).map((wk) => {
                    const wkEntries = byWeek[wk].sort((a, b) => new Date(a.date) - new Date(b.date));
                    const wkTotal = wkEntries.reduce((s, e) => s + (e.hours || 0), 0);
                    return (
                      <div key={wk} style={{ marginBottom: 24 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "#ff6b2b", fontWeight: 700 }}>Week {wk}</div>
                          <div style={{ fontSize: 12, color: "#555" }}>{fmtHours(wkTotal)}</div>
                        </div>
                        {wkEntries.map((e) => (
                          <div key={e.id} className="card" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{getDayName(e.date)}</div>
                                <span className={`tag ${e.manual ? "tag-manual" : "tag-auto"}`}>
                                  {e.manual ? "handmatig" : "geklokt"}
                                </span>
                              </div>
                              <div style={{ color: "#555", fontSize: 12 }}>
                                {fmtDate(e.date)} · {fmtTime(e.clockIn)} – {fmtTime(e.clockOut)}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700, color: "#ff6b2b" }}>
                                {fmtHours(e.hours)}
                              </div>
                              <button onClick={() => handleDeleteEntry(e.id)} style={{
                                background: "none", color: "#555", fontSize: 18, padding: 4,
                                transition: "color .15s"
                              }} onMouseEnter={(el) => el.target.style.color = "#ff4a4a"}
                                onMouseLeave={(el) => el.target.style.color = "#555"}>✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ── MANUAL ── */}
            {screen === "manual" && (
              <div className="fade-in" style={{ padding: "32px 24px 0" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Handmatig Invoeren</div>
                <div style={{ color: "#555", fontSize: 13, marginBottom: 28 }}>Vergeten in te kloppen? Voeg je uren hier toe.</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", color: "#888", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Datum</label>
                    <input type="date" className="input-field" value={manDate}
                      onChange={(e) => setManDate(e.target.value)}
                      style={{ colorScheme: "dark" }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", color: "#888", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Start</label>
                      <input type="time" className="input-field" value={manStart}
                        onChange={(e) => setManStart(e.target.value)} style={{ colorScheme: "dark" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", color: "#888", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Einde</label>
                      <input type="time" className="input-field" value={manEnd}
                        onChange={(e) => setManEnd(e.target.value)} style={{ colorScheme: "dark" }} />
                    </div>
                  </div>

                  {/* Preview */}
                  {manStart && manEnd && manDate && (
                    <div className="card" style={{ borderColor: "#2e2b27" }}>
                      <div style={{ color: "#555", fontSize: 12, marginBottom: 4 }}>Voorberekend</div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 24, fontWeight: 700, color: "#ff6b2b" }}>
                        {(() => {
                          const ms = new Date(`${manDate}T${manEnd}`) - new Date(`${manDate}T${manStart}`);
                          return ms > 0 ? fmtHours(hoursFromMs(ms)) : "ongeldige tijd";
                        })()}
                      </div>
                    </div>
                  )}

                  <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleManualAdd}>
                    Uren toevoegen →
                  </button>
                </div>
              </div>
            )}

            {/* ── SETTINGS ── */}
            {screen === "settings" && (
              <div className="fade-in" style={{ padding: "32px 24px 0" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 20, fontWeight: 700, marginBottom: 28 }}>Instellingen</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div className="card">
                    <div style={{ color: "#888", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 12 }}>Stage startdatum</div>
                    <input type="date" className="input-field" value={settingsStart}
                      onChange={(e) => setSettingsStart(e.target.value)}
                      style={{ marginBottom: 14, colorScheme: "dark" }} />
                    <button className="btn-primary" onClick={handleSaveSettings}>
                      Opslaan →
                    </button>
                  </div>

                  <div className="card">
                    <div style={{ color: "#888", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Excel exporteren</div>
                    <div style={{ color: "#555", fontSize: 13, marginBottom: 14 }}>
                      Download een overzicht van al je uren als Excel bestand.
                    </div>
                    <button className="btn-secondary" onClick={() => exportExcel(entries, userData?.startDate, currentUser)}>
                      📊 Excel downloaden
                    </button>
                  </div>

                  <div className="card" style={{ borderColor: "#2a1a1a" }}>
                    <div style={{ color: "#ff4a4a", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>Stage afronden</div>
                    <div style={{ color: "#555", fontSize: 13, marginBottom: 14 }}>
                      Sluit je stage af. Je totaaloverzicht wordt automatisch als Excel gedownload.
                    </div>
                    {!showEndConfirm ? (
                      <button className="btn-secondary" style={{ borderColor: "#3a1a1a", color: "#ff4a4a" }}
                        onClick={() => setShowEndConfirm(true)}>
                        🎓 Klaar met stage
                      </button>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ color: "#ff6b2b", fontSize: 14, textAlign: "center", padding: "8px 0" }}>
                          Weet je het zeker?
                        </div>
                        <button className="btn-primary" style={{ background: "#c0392b" }} onClick={handleEndStage}>
                          ✓ Ja, stage afronden + Excel downloaden
                        </button>
                        <button className="btn-secondary" onClick={() => setShowEndConfirm(false)}>
                          Annuleren
                        </button>
                      </div>
                    )}
                  </div>

                  <button className="btn-secondary" onClick={handleLogout} style={{ color: "#555" }}>
                    Uitloggen
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ─── Bottom Nav ─── */}
          <nav style={{
            position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
            width: "100%", maxWidth: 480,
            background: "#131210",
            borderTop: "1px solid #272421",
            display: "flex",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}>
            {[
              { id: "dashboard", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, label: "Home" },
              { id: "hours", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>, label: "Uren" },
              { id: "manual", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>, label: "Invoeren" },
              { id: "settings", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "Instellingen" },
            ].map(({ id, icon, label }) => (
              <button key={id} className={`nav-btn ${screen === id ? "active" : ""}`} onClick={() => setScreen(id)}>
                {icon}
                {label}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
