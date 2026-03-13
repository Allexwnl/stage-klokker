import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => { if (!iso) return "--:--"; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`; };
const hoursFromMs = (ms) => ms / 3600000;
const fmtHours = (h) => { const hrs = Math.floor(h); const mins = Math.round((h-hrs)*60); return `${hrs}u ${pad(mins)}m`; };
const getWeekNumber = (dateStr, startDateStr) => {
  if (!startDateStr) return 1;
  const start = new Date(startDateStr); start.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.floor((d-start)/(7*24*60*60*1000))+1;
};
const DAYS_NL = ["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"];
const getDayName = (dateStr) => DAYS_NL[new Date(dateStr).getDay()];

const getUserDoc = (uid) => doc(db, "users", uid);
const loadUserData = async (uid) => { const snap = await getDoc(getUserDoc(uid)); return snap.exists() ? snap.data() : null; };
const saveUserData = async (uid, data) => { await setDoc(getUserDoc(uid), data, { merge: true }); };

const exportExcel = (entries, startDate, username) => {
  const sorted = [...entries].sort((a,b) => new Date(a.date)-new Date(b.date));
  const totalHours = sorted.reduce((sum,e) => sum+(e.hours||0), 0);
  const rows = sorted.map(e => ({ Week:`Week ${getWeekNumber(e.date,startDate)}`, Dag:getDayName(e.date), Datum:fmtDate(e.date), "Ingewerkt van":fmtTime(e.clockIn), Tot:fmtTime(e.clockOut), "Uren die dag":parseFloat((e.hours||0).toFixed(2)) }));
  rows.push({}); rows.push({ Week:"", Dag:"", Datum:"TOTAAL", "Ingewerkt van":"", Tot:"", "Uren die dag":parseFloat(totalHours.toFixed(2)) });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:10},{wch:12},{wch:14},{wch:14},{wch:10},{wch:16}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Stage Uren");
  XLSX.writeFile(wb, `stage-uren-${username}.xlsx`);
};

const sendNotification = (title, body) => {
  if (Notification.permission === "granted") {
    new Notification(title, { body, tag: "stagetimer", renotify: true });
  }
};

const NAV = [
  { id:"dashboard", label:"Dashboard", icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { id:"hours", label:"Mijn Uren", icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg> },
  { id:"manual", label:"Invoeren", icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> },
  { id:"settings", label:"Instellingen", icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
];

export default function App() {
  const [screen, setScreen] = useState("login");
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [clockedIn, setClockedIn] = useState(null);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [notifPermission, setNotifPermission] = useState(Notification.permission);
  const firedToday = useRef({});

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [manDate, setManDate] = useState(new Date().toISOString().slice(0,10));
  const [manStart, setManStart] = useState("09:00");
  const [manEnd, setManEnd] = useState("17:00");
  const [settingsStart, setSettingsStart] = useState("");
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifClockInTime, setNotifClockInTime] = useState("09:00");
  const [notifClockOutTime, setNotifClockOutTime] = useState("17:00");
  const [notifDays, setNotifDays] = useState([1,2,3,4,5]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => { clearInterval(t); window.removeEventListener("resize", onResize); };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const ud = await loadUserData(user.uid);
        if (ud) {
          setCurrentUser(user); setUserData(ud);
          setSettingsStart(ud.startDate || "");
          setClockedIn(ud.clockedIn || null);
          if (ud.notifications) {
            setNotifEnabled(ud.notifications.enabled ?? false);
            setNotifClockInTime(ud.notifications.clockInTime ?? "09:00");
            setNotifClockOutTime(ud.notifications.clockOutTime ?? "17:00");
            setNotifDays(ud.notifications.days ?? [1,2,3,4,5]);
          }
          setScreen("dashboard");
        } else {
          setCurrentUser(user);
          const newDoc = { username: user.email.split("@")[0], startDate:"", entries:[], clockedIn:null, notifications:{enabled:false,clockInTime:"09:00",clockOutTime:"17:00",days:[1,2,3,4,5]} };
          await saveUserData(user.uid, newDoc);
          setUserData(newDoc); setScreen("settings");
        }
      } else { setCurrentUser(null); setUserData(null); setScreen("login"); }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!notifEnabled || notifPermission !== "granted") return;
    const check = () => {
      const n = new Date();
      const todayKey = n.toISOString().slice(0,10);
      if (firedToday.current.date !== todayKey) firedToday.current = { date: todayKey };
      const dayOfWeek = n.getDay();
      const hhmm = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
      if (!notifDays.includes(dayOfWeek)) return;
      if (hhmm === notifClockInTime && !firedToday.current.clockIn && !clockedIn) {
        sendNotification("⏱️ Vergeet niet in te kloppen!", `Het is ${notifClockInTime} — open StageTimer om in te kloppen.`);
        firedToday.current.clockIn = true;
      }
      if (hhmm === notifClockOutTime && !firedToday.current.clockOut && clockedIn) {
        sendNotification("⏹️ Vergeet niet uit te kloppen!", `Het is ${notifClockOutTime} — je bent nog steeds ingeklokt.`);
        firedToday.current.clockOut = true;
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [notifEnabled, notifPermission, notifClockInTime, notifClockOutTime, notifDays, clockedIn]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };
  const toEmail = (u) => `${u.toLowerCase().replace(/\s/g,"_")}@stagetimer.app`;

  const updateUserData = async (data) => {
    const merged = { ...userData, ...data };
    setUserData(merged);
    await saveUserData(currentUser.uid, merged);
  };

  const requestNotifPermission = async () => {
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    return result;
  };

  const handleLogin = async () => {
    setLoginErr("");
    try { await signInWithEmailAndPassword(auth, toEmail(loginUser), loginPass); setLoginUser(""); setLoginPass(""); }
    catch (e) { setLoginErr(e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" ? "Gebruiker niet gevonden of wachtwoord onjuist" : "Inloggen mislukt: "+e.message); }
  };

  const handleRegister = async () => {
    setLoginErr("");
    if (!loginUser || !loginPass) { setLoginErr("Vul alle velden in"); return; }
    if (loginPass.length < 6) { setLoginErr("Wachtwoord minimaal 6 tekens"); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, toEmail(loginUser), loginPass);
      const newDoc = { username:loginUser, startDate:"", entries:[], clockedIn:null, notifications:{enabled:false,clockInTime:"09:00",clockOutTime:"17:00",days:[1,2,3,4,5]} };
      await saveUserData(cred.user.uid, newDoc);
      setLoginUser(""); setLoginPass(""); showToast("Account aangemaakt! 🎉");
    } catch (e) { setLoginErr(e.code === "auth/email-already-in-use" ? "Gebruikersnaam al in gebruik" : "Registreren mislukt: "+e.message); }
  };

  const handleLogout = async () => await signOut(auth);

  const handleClockIn = async () => {
    const time = new Date().toISOString();
    await updateUserData({ clockedIn: time }); setClockedIn(time); showToast("Ingeklokt! 🟢");
  };

  const handleClockOut = async () => {
    if (!clockedIn) return;
    const outTime = new Date().toISOString();
    const hours = hoursFromMs(new Date(outTime)-new Date(clockedIn));
    const newEntry = { id:Date.now(), date:new Date(clockedIn).toISOString().slice(0,10), clockIn:clockedIn, clockOut:outTime, hours, manual:false };
    await updateUserData({ entries:[...(userData.entries||[]),newEntry], clockedIn:null });
    setClockedIn(null); showToast(`Uitgeklokt! ${fmtHours(hours)} geregistreerd ✅`);
  };

  const handleManualAdd = async () => {
    if (!manDate||!manStart||!manEnd) { showToast("Vul alle velden in"); return; }
    const inISO = new Date(`${manDate}T${manStart}:00`).toISOString();
    const outISO = new Date(`${manDate}T${manEnd}:00`).toISOString();
    if (new Date(outISO) <= new Date(inISO)) { showToast("Eindtijd moet na starttijd zijn"); return; }
    const hours = hoursFromMs(new Date(outISO)-new Date(inISO));
    const newEntry = { id:Date.now(), date:manDate, clockIn:inISO, clockOut:outISO, hours, manual:true };
    await updateUserData({ entries:[...(userData.entries||[]),newEntry] });
    showToast("Uren handmatig toegevoegd ✅"); setManStart("09:00"); setManEnd("17:00");
  };

  const handleDeleteEntry = async (id) => { await updateUserData({ entries:userData.entries.filter(e=>e.id!==id) }); showToast("Verwijderd"); };
  const handleSaveSettings = async () => { await updateUserData({ startDate:settingsStart }); showToast("Opgeslagen ✅"); };
  const handleEndStage = async () => {
    exportExcel(userData.entries||[], userData.startDate, displayName);
    await updateUserData({ ended:true, endDate:new Date().toISOString() });
    setShowEndConfirm(false); showToast("Stage afgesloten! 🎓");
  };

  const handleSaveNotifications = async () => {
    if (notifEnabled && notifPermission !== "granted") {
      const result = await requestNotifPermission();
      if (result !== "granted") { showToast("Meldingen geblokkeerd ❌"); return; }
    }
    const notifData = { enabled:notifEnabled, clockInTime:notifClockInTime, clockOutTime:notifClockOutTime, days:notifDays };
    await updateUserData({ notifications:notifData });
    showToast("Meldingen opgeslagen ✅");
  };

  const toggleDay = (day) => setNotifDays(prev => prev.includes(day) ? prev.filter(d=>d!==day) : [...prev,day]);

  const entries = userData?.entries || [];
  const totalHours = entries.reduce((s,e) => s+(e.hours||0), 0);
  const currentSessionHours = clockedIn ? hoursFromMs(now-new Date(clockedIn)) : 0;
  const displayName = userData?.username || currentUser?.email?.split("@")[0] || "";
  const byWeek = {};
  entries.forEach(e => { const wk = getWeekNumber(e.date, userData?.startDate); if (!byWeek[wk]) byWeek[wk]=[]; byWeek[wk].push(e); });
  const DAY_LABELS = ["Zo","Ma","Di","Wo","Do","Vr","Za"];

  if (loading) return <div style={{minHeight:"100vh",background:"#0a0908",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Mono',monospace",color:"#ff6b2b",fontSize:32}}>⏱️</div>;

  const isAuth = screen === "login" || screen === "register";

  return (
    <div style={{minHeight:"100vh",background:"#0a0908",color:"#f0ece4",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Space+Mono:wght@400;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        input,button{font-family:inherit;outline:none} button{cursor:pointer;border:none}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#ff6b2b44;border-radius:4px}
        input[type="date"],input[type="time"]{color-scheme:dark}
        .input-field{width:100%;padding:13px 16px;background:#151311;border:1.5px solid #2a2722;border-radius:10px;color:#f0ece4;font-size:15px;transition:border-color .2s}
        .input-field:focus{border-color:#ff6b2b} .input-field::placeholder{color:#444}
        .btn-primary{width:100%;padding:14px 20px;background:#ff6b2b;color:#fff;border-radius:10px;font-size:15px;font-weight:700;transition:background .15s,transform .1s}
        .btn-primary:hover{background:#ff7d42} .btn-primary:active{transform:scale(.98);background:#e55c1e}
        .btn-secondary{width:100%;padding:13px 20px;background:#151311;color:#ccc;border-radius:10px;border:1.5px solid #2a2722;font-size:15px;font-weight:500;transition:border-color .2s,color .2s,transform .1s}
        .btn-secondary:hover{border-color:#ff6b2b;color:#ff6b2b} .btn-secondary:active{transform:scale(.98)}
        .card{background:#131110;border-radius:14px;border:1px solid #222;padding:20px}
        .tag{display:inline-block;padding:2px 9px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
        .tag-manual{background:#2a1e0e;color:#e8a04a;border:1px solid #3a2a14}
        .tag-auto{background:#0e2212;color:#4ae870;border:1px solid #143a1e}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeUp .3s ease}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}} .pulse{animation:pulse 1.6s ease infinite}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .sidebar{position:fixed;top:0;left:0;bottom:0;width:220px;background:#0d0c0b;border-right:1px solid #1e1c1a;display:flex;flex-direction:column;padding:28px 16px;z-index:100}
        .sidebar-nav-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:9px;margin-bottom:4px;color:#666;font-size:14px;font-weight:500;background:none;width:100%;transition:background .15s,color .15s;text-align:left}
        .sidebar-nav-item:hover{background:#1a1816;color:#ccc} .sidebar-nav-item.active{background:#1e1208;color:#ff6b2b}
        .sidebar-user{margin-top:auto;padding:12px;border-radius:10px;background:#131110;border:1px solid #222;display:flex;align-items:center;gap:10px}
        .sidebar-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#ff6b2b,#ff8c00);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0}
        .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0d0c0b;border-top:1px solid #1e1c1a;display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,0)}
        .bottom-nav-btn{flex:1;padding:10px 0;background:none;color:#555;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;transition:color .15s}
        .bottom-nav-btn.active{color:#ff6b2b}
        .clock-btn{border-radius:50%;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;transition:all .25s;position:relative;overflow:hidden}
        .clock-btn::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.14),transparent 60%)}
        .clock-btn.in{background:linear-gradient(135deg,#ff6b2b,#ff8c00);color:#fff;box-shadow:0 0 0 8px rgba(255,107,43,.1),0 0 0 16px rgba(255,107,43,.04)}
        .clock-btn.out{background:linear-gradient(135deg,#0e1e10,#0a1a0c);color:#4ae870;border:2px solid #1e3a20;box-shadow:0 0 0 8px rgba(74,232,112,.06)}
        .clock-btn:active{transform:scale(.93)}
        .desktop-layout{margin-left:220px;min-height:100vh;padding:40px 48px}
        .desktop-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}
        .hours-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:24px}
        .toggle-track{width:44px;height:24px;border-radius:12px;background:#2a2722;border:none;cursor:pointer;position:relative;transition:background .2s;flex-shrink:0}
        .toggle-track.on{background:#ff6b2b}
        .toggle-thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s}
        .toggle-track.on .toggle-thumb{transform:translateX(20px)}
        .day-pill{width:36px;height:36px;border-radius:50%;border:1.5px solid #2a2722;background:none;color:#555;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s}
        .day-pill.active{background:#ff6b2b;border-color:#ff6b2b;color:#fff}
        @media(max-width:1000px){.desktop-grid{grid-template-columns:1fr}}
      `}</style>

      {toast && <div style={{position:"fixed",bottom:isMobile?90:32,left:"50%",transform:"translateX(-50%)",background:"#1e1c1a",border:"1px solid #333",padding:"11px 22px",borderRadius:10,fontSize:14,fontWeight:500,zIndex:999,whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,.6)",color:"#f0ece4",animation:"toastIn .25s ease"}}>{toast}</div>}

      {isAuth && (
        <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 24px"}}>
          <div className="fade-in" style={{width:"100%",maxWidth:420}}>
            <div style={{marginBottom:40}}>
              <div style={{fontSize:40,marginBottom:8}}>⏱️</div>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:26,fontWeight:700,color:"#ff6b2b"}}>StageTimer</div>
              <div style={{color:"#555",fontSize:14,marginTop:4}}>Jouw stage-uren, simpel bijgehouden</div>
            </div>
            <div style={{display:"flex",background:"#131110",borderRadius:10,padding:4,marginBottom:24}}>
              {["login","register"].map(s => (
                <button key={s} onClick={() => {setScreen(s);setLoginErr("");}} style={{flex:1,padding:"10px 0",borderRadius:7,background:screen===s?"#ff6b2b":"none",color:screen===s?"#fff":"#666",fontSize:14,fontWeight:600,transition:"all .2s"}}>
                  {s==="login"?"Inloggen":"Registreren"}
                </button>
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <input className="input-field" placeholder="Gebruikersnaam" value={loginUser} onChange={e=>setLoginUser(e.target.value)}/>
              <input className="input-field" type="password" placeholder="Wachtwoord (min. 6 tekens)" value={loginPass} onChange={e=>setLoginPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(screen==="login"?handleLogin():handleRegister())}/>
              {loginErr && <div style={{color:"#ff4a4a",fontSize:13}}>{loginErr}</div>}
              <button className="btn-primary" style={{marginTop:4}} onClick={screen==="login"?handleLogin:handleRegister}>
                {screen==="login"?"Inloggen →":"Account aanmaken →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isAuth && (
        <>
          {!isMobile && (
            <aside className="sidebar">
              <div style={{marginBottom:36,padding:"0 8px"}}>
                <div style={{fontSize:28,marginBottom:4}}>⏱️</div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:18,fontWeight:700,color:"#ff6b2b"}}>StageTimer</div>
              </div>
              {NAV.map(({id,label,icon}) => (
                <button key={id} className={`sidebar-nav-item ${screen===id?"active":""}`} onClick={()=>setScreen(id)}>{icon} {label}</button>
              ))}
              <div className="sidebar-user">
                <div className="sidebar-avatar">{displayName.charAt(0).toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#ddd",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName}</div>
                  <div style={{fontSize:11,color:"#555"}}>Ingelogd</div>
                </div>
                <button onClick={handleLogout} style={{background:"none",color:"#444",fontSize:18,padding:4,transition:"color .15s"}} onMouseEnter={e=>e.target.style.color="#ff4a4a"} onMouseLeave={e=>e.target.style.color="#444"}>↪</button>
              </div>
            </aside>
          )}

          {isMobile && (
            <nav className="bottom-nav">
              {NAV.map(({id,label,icon}) => (
                <button key={id} className={`bottom-nav-btn ${screen===id?"active":""}`} onClick={()=>setScreen(id)}>{icon}{label}</button>
              ))}
            </nav>
          )}

          <main className={isMobile?"":"desktop-layout"} style={isMobile?{padding:"28px 20px",paddingBottom:90}:{}}>

            {screen==="dashboard" && (
              <div className="fade-in">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:32}}>
                  <div>
                    <div style={{color:"#555",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>Welkom terug,</div>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?22:28,fontWeight:700,color:"#ff6b2b"}}>{displayName}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?22:30,fontWeight:700}}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
                    <div style={{color:"#444",fontSize:12}}>{fmtDate(now.toISOString())}</div>
                  </div>
                </div>
                <div className={isMobile?"":"desktop-grid"}>
                  <div>
                    <div style={{display:"flex",justifyContent:isMobile?"center":"flex-start",marginBottom:24}}>
                      <button className={`clock-btn ${clockedIn?"out":"in"}`} onClick={clockedIn?handleClockOut:handleClockIn} style={{width:isMobile?188:210,height:isMobile?188:210,fontSize:isMobile?18:19}}>
                        <span style={{fontSize:isMobile?34:38}}>{clockedIn?"⏹":"▶"}</span>
                        <span>{clockedIn?"Uitkloppen":"Inkloppen"}</span>
                        {clockedIn && <span style={{fontSize:11,fontWeight:500,opacity:.8}} className="pulse">● Actief</span>}
                      </button>
                    </div>
                    {clockedIn && (
                      <div className="card" style={{borderColor:"#1a3a1e",marginBottom:16}}>
                        <div style={{color:"#4ae870",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Huidige sessie</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontFamily:"'Space Mono',monospace",fontSize:28,fontWeight:700}}>{fmtHours(currentSessionHours)}</div>
                            <div style={{color:"#444",fontSize:12,marginTop:2}}>Ingeklokt om {fmtTime(clockedIn)}</div>
                          </div>
                          <div style={{fontSize:34}}>🟢</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr",gap:12}}>
                      <div className="card"><div style={{color:"#444",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Totaal</div><div style={{fontFamily:"'Space Mono',monospace",fontSize:20,fontWeight:700,color:"#ff6b2b"}}>{fmtHours(totalHours)}</div></div>
                      <div className="card"><div style={{color:"#444",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Dagen</div><div style={{fontFamily:"'Space Mono',monospace",fontSize:20,fontWeight:700}}>{new Set(entries.map(e=>e.date)).size}</div></div>
                      {!isMobile && <div className="card"><div style={{color:"#444",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Handmatig</div><div style={{fontFamily:"'Space Mono',monospace",fontSize:20,fontWeight:700}}>{entries.filter(e=>e.manual).length}</div></div>}
                    </div>
                    {userData?.startDate && (
                      <div className="card">
                        <div style={{color:"#444",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Stage voortgang</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontSize:14}}>Week <span style={{color:"#ff6b2b",fontWeight:700,fontFamily:"'Space Mono',monospace",fontSize:20}}>{getWeekNumber(now.toISOString().slice(0,10),userData.startDate)}</span></div>
                          <div style={{color:"#444",fontSize:12}}>Start: {fmtDate(userData.startDate)}</div>
                        </div>
                      </div>
                    )}
                    {!isMobile && entries.length > 0 && (
                      <div className="card">
                        <div style={{color:"#444",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",marginBottom:14}}>Recente invoer</div>
                        {[...entries].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5).map((e,i)=>(
                          <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:i<4?"1px solid #1a1816":"none"}}>
                            <div><span style={{fontSize:13,fontWeight:500}}>{getDayName(e.date)}</span><span style={{color:"#444",fontSize:12,marginLeft:8}}>{fmtDate(e.date)}</span></div>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span className={`tag ${e.manual?"tag-manual":"tag-auto"}`}>{e.manual?"handmatig":"geklokt"}</span>
                              <span style={{fontFamily:"'Space Mono',monospace",fontSize:13,color:"#ff6b2b",fontWeight:700}}>{fmtHours(e.hours)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {screen==="hours" && (
              <div className="fade-in">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28}}>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?20:24,fontWeight:700}}>Mijn Uren</div>
                  <div style={{background:"#1a0e06",border:"1px solid #3a2010",borderRadius:8,padding:"6px 14px",fontFamily:"'Space Mono',monospace",fontSize:13,color:"#ff6b2b"}}>{fmtHours(totalHours)} totaal</div>
                </div>
                {entries.length===0 ? (
                  <div style={{textAlign:"center",color:"#444",paddingTop:80}}><div style={{fontSize:48,marginBottom:12}}>📋</div><div>Nog geen uren geregistreerd</div></div>
                ) : (
                  <div className={isMobile?"":"hours-grid"}>
                    {Object.keys(byWeek).sort((a,b)=>a-b).map(wk => {
                      const wkEntries = byWeek[wk].sort((a,b)=>new Date(a.date)-new Date(b.date));
                      const wkTotal = wkEntries.reduce((s,e)=>s+(e.hours||0),0);
                      return (
                        <div key={wk} style={{marginBottom:isMobile?24:0}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                            <div style={{fontSize:12,textTransform:"uppercase",letterSpacing:".08em",color:"#ff6b2b",fontWeight:700}}>Week {wk}</div>
                            <div style={{fontSize:12,color:"#444"}}>{fmtHours(wkTotal)}</div>
                          </div>
                          {wkEntries.map(e => (
                            <div key={e.id} className="card" style={{marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div style={{flex:1}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                  <div style={{fontWeight:600,fontSize:14}}>{getDayName(e.date)}</div>
                                  <span className={`tag ${e.manual?"tag-manual":"tag-auto"}`}>{e.manual?"handmatig":"geklokt"}</span>
                                </div>
                                <div style={{color:"#444",fontSize:12}}>{fmtDate(e.date)} · {fmtTime(e.clockIn)} – {fmtTime(e.clockOut)}</div>
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:14}}>
                                <div style={{fontFamily:"'Space Mono',monospace",fontSize:14,fontWeight:700,color:"#ff6b2b"}}>{fmtHours(e.hours)}</div>
                                <button onClick={()=>handleDeleteEntry(e.id)} style={{background:"none",color:"#444",fontSize:17,padding:4,transition:"color .15s"}} onMouseEnter={e=>e.target.style.color="#ff4a4a"} onMouseLeave={e=>e.target.style.color="#444"}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {screen==="manual" && (
              <div className="fade-in" style={{maxWidth:520}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?20:24,fontWeight:700,marginBottom:8}}>Handmatig Invoeren</div>
                <div style={{color:"#444",fontSize:13,marginBottom:28}}>Vergeten in te kloppen? Voeg je uren hier toe.</div>
                <div className="card">
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <div>
                      <label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Datum</label>
                      <input type="date" className="input-field" value={manDate} onChange={e=>setManDate(e.target.value)}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div><label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Start</label><input type="time" className="input-field" value={manStart} onChange={e=>setManStart(e.target.value)}/></div>
                      <div><label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Einde</label><input type="time" className="input-field" value={manEnd} onChange={e=>setManEnd(e.target.value)}/></div>
                    </div>
                    {manStart&&manEnd&&manDate&&(()=>{const ms=new Date(`${manDate}T${manEnd}`)-new Date(`${manDate}T${manStart}`);return ms>0?<div style={{background:"#0e0d0c",border:"1px solid #1e1c1a",borderRadius:10,padding:"14px 16px"}}><div style={{color:"#444",fontSize:11,marginBottom:4}}>Voorberekend</div><div style={{fontFamily:"'Space Mono',monospace",fontSize:22,fontWeight:700,color:"#ff6b2b"}}>{fmtHours(hoursFromMs(ms))}</div></div>:null;})()}
                    <button className="btn-primary" onClick={handleManualAdd}>Uren toevoegen →</button>
                  </div>
                </div>
              </div>
            )}

            {screen==="settings" && (
              <div className="fade-in" style={{maxWidth:560}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?20:24,fontWeight:700,marginBottom:28}}>Instellingen</div>
                <div style={{display:"flex",flexDirection:"column",gap:16}}>

                  <div className="card">
                    <div style={{color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:12}}>Stage startdatum</div>
                    <input type="date" className="input-field" value={settingsStart} onChange={e=>setSettingsStart(e.target.value)} style={{marginBottom:14}}/>
                    <button className="btn-primary" onClick={handleSaveSettings}>Opslaan →</button>
                  </div>

                  {/* ── MELDINGEN ── */}
                  <div className="card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div>
                        <div style={{color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:2}}>Meldingen</div>
                        <div style={{color:"#444",fontSize:12}}>Herinnering voor in- en uitkloppen</div>
                      </div>
                      <button className={`toggle-track ${notifEnabled?"on":""}`} onClick={()=>setNotifEnabled(v=>!v)}>
                        <div className="toggle-thumb"/>
                      </button>
                    </div>

                    {notifEnabled && notifPermission==="denied" && (
                      <div style={{background:"#2a1010",border:"1px solid #4a2020",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#ff8080"}}>
                        ⚠️ Meldingen zijn geblokkeerd in je browser. Ga naar browserinstellingen om ze toe te staan.
                      </div>
                    )}
                    {notifEnabled && notifPermission==="default" && (
                      <div style={{background:"#1a1208",border:"1px solid #3a2a10",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#e8a04a"}}>
                        🔔 Klik op "Meldingen opslaan" om toestemming te geven.
                      </div>
                    )}

                    <div style={{display:"flex",flexDirection:"column",gap:14,opacity:notifEnabled?1:0.4,pointerEvents:notifEnabled?"auto":"none",transition:"opacity .2s"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>🟢 Inkloppen om</label>
                          <input type="time" className="input-field" value={notifClockInTime} onChange={e=>setNotifClockInTime(e.target.value)}/>
                        </div>
                        <div>
                          <label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>🔴 Uitkloppen om</label>
                          <input type="time" className="input-field" value={notifClockOutTime} onChange={e=>setNotifClockOutTime(e.target.value)}/>
                        </div>
                      </div>
                      <div>
                        <label style={{display:"block",color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:10}}>Dagen</label>
                        <div style={{display:"flex",gap:8}}>
                          {DAY_LABELS.map((label,i)=>(
                            <button key={i} className={`day-pill ${notifDays.includes(i)?"active":""}`} onClick={()=>toggleDay(i)}>{label}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{background:"#0e0d0c",border:"1px solid #1e1c1a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#555",lineHeight:1.5}}>
                        💡 Melding komt alleen als je <strong style={{color:"#777"}}>nog niet</strong> ingeklokt bent (inklopmelding) of <strong style={{color:"#777"}}>nog steeds</strong> ingeklokt bent (uitklopmelding). Browser moet open zijn.
                      </div>
                    </div>
                    <button className="btn-primary" style={{marginTop:16}} onClick={handleSaveNotifications}>Meldingen opslaan →</button>
                  </div>

                  <div className="card">
                    <div style={{color:"#666",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Excel exporteren</div>
                    <div style={{color:"#444",fontSize:13,marginBottom:14}}>Download een overzicht van al je uren als Excel bestand.</div>
                    <button className="btn-secondary" onClick={()=>exportExcel(entries,userData?.startDate,displayName)}>📊 Excel downloaden</button>
                  </div>

                  <div className="card" style={{borderColor:"#2a1010"}}>
                    <div style={{color:"#ff4a4a",fontSize:12,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Stage afronden</div>
                    <div style={{color:"#444",fontSize:13,marginBottom:14}}>Sluit je stage af. Je totaaloverzicht wordt automatisch als Excel gedownload.</div>
                    {!showEndConfirm ? (
                      <button className="btn-secondary" style={{borderColor:"#3a1010",color:"#ff4a4a"}} onClick={()=>setShowEndConfirm(true)}>🎓 Klaar met stage</button>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        <div style={{color:"#ff6b2b",fontSize:14,textAlign:"center",padding:"8px 0"}}>Weet je het zeker?</div>
                        <button className="btn-primary" style={{background:"#b02020"}} onClick={handleEndStage}>✓ Ja, stage afronden + Excel downloaden</button>
                        <button className="btn-secondary" onClick={()=>setShowEndConfirm(false)}>Annuleren</button>
                      </div>
                    )}
                  </div>

                  {isMobile && <button className="btn-secondary" onClick={handleLogout} style={{color:"#555"}}>Uitloggen</button>}
                </div>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}