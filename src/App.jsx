import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Home, Building2, Banknote, Wrench, FileText, Settings as SettingsIcon,
  Plus, Check, X, Clock, AlertTriangle, ChevronRight, Phone, Calendar,
  Trash2, Pencil, ExternalLink, CircleDot, ArrowLeft, Download, Upload, LogOut,
  Sparkles, Loader2, Users, Search, ReceiptText
} from "lucide-react";
import { loadState, saveState, subscribeState, onAuth, signOutUser, uploadDocFile } from "./firebase";
import { suggestDocMeta, canAnalyze } from "./ai";
import Login from "./Login";

/* ------------------------------------------------------------------ */
/*  Data + auth live in ./firebase  (loadState / saveState / subscribe) */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const uid = () => Math.random().toString(36).slice(2, 10);
const CCY = { USD: "en-US", DOP: "es-DO", EUR: "de-DE" };
function money(n, ccy = "USD") {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(CCY[ccy] || "en-US", {
      style: "currency", currency: ccy, maximumFractionDigits: 0,
    }).format(v);
  } catch { return `${ccy} ${v.toLocaleString()}`; }
}
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return Math.round((d - new Date(new Date().toDateString())) / 86400000);
}
const PROP_COLORS = ["#0E7C6B", "#3B6FB0", "#C77D11", "#8A5BB8", "#C5453B", "#1E8E5A", "#B0653B"];

/* rent status for a property in a given month key */
function rentStatus(prop, mk, rentRecords) {
  const rec = rentRecords.find((r) => r.propertyId === prop.id && r.period === mk);
  if (rec) return { state: rec.status, paid: rec.paidAmount, rec };
  if (prop.leaseStart && mk < prop.leaseStart.slice(0, 7)) return { state: "na" };
  if (prop.leaseEnd && mk > prop.leaseEnd.slice(0, 7)) return { state: "na" };
  const [y, m] = mk.split("-").map(Number);
  const due = new Date(y, m - 1, Math.min(prop.rentDueDay || 1, 28));
  const now = new Date(new Date().toDateString());
  if (due > now) return { state: "upcoming" };
  return { state: "overdue" };
}

/* HOA period generation */
function hoaPeriods(freq) {
  const now = new Date();
  const out = [];
  if (freq === "annual") {
    for (let i = 2; i >= -1; i--) {
      const y = now.getFullYear() - i;
      out.push({ key: `${y}`, label: `${y}`, due: new Date(y, 0, 1) });
    }
  } else if (freq === "quarterly") {
    for (let i = 4; i >= -1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
      const q = Math.floor(d.getMonth() / 3) + 1;
      out.push({ key: `${d.getFullYear()}-Q${q}`, label: `Q${q} ’${String(d.getFullYear()).slice(2)}`, due: new Date(d.getFullYear(), (q - 1) * 3, 1) });
    }
  } else {
    for (let i = 5; i >= -1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: monthKey(d), label: monthLabel(monthKey(d)), due: d });
    }
  }
  return out;
}

function propertyFinancials(data, propertyId) {
  const prop = data.properties.find((p) => p.id === propertyId);
  if (!prop) return { income: 0, expenses: 0, net: 0, rows: [] };
  const rows = [];
  data.rent
    .filter((r) => r.propertyId === propertyId && r.status !== "clear")
    .forEach((r) => rows.push({
      id: `rent-${r.period}`,
      date: r.paidDate || `${r.period}-01`,
      type: "Income",
      label: `Rent · ${monthLabel(r.period)}`,
      amount: Number(r.paidAmount) || Number(prop.monthlyRent) || 0,
    }));
  data.hoa
    .filter((h) => h.propertyId === propertyId)
    .forEach((h) => rows.push({
      id: `hoa-${h.id || h.period}`,
      date: h.paidDate || "",
      type: "Expense",
      label: `HOA · ${h.period}`,
      amount: -(Number(h.amount) || Number(prop.hoaAmount) || 0),
    }));
  data.repairs
    .filter((r) => r.propertyId === propertyId && Number(r.cost) > 0)
    .forEach((r) => rows.push({
      id: `repair-${r.id}`,
      date: r.scheduledDate || r.createdDate || "",
      type: "Expense",
      label: `Repair · ${r.title}`,
      amount: -(Number(r.cost) || 0),
    }));
  (data.transactions || [])
    .filter((t) => t.propertyId === propertyId)
    .forEach((t) => rows.push({
      id: `tx-${t.id}`,
      date: t.date || "",
      type: t.direction === "in" ? "Income" : "Expense",
      label: t.category || t.note || "Transaction",
      amount: (t.direction === "in" ? 1 : -1) * (Number(t.amount) || 0),
      party: t.party,
    }));
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const income = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
  return { income, expenses, net: income - expenses, rows };
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const CSS = `
:root{
  --ink:#10302B; --ink2:#1C4A41; --bg:#EEF2EF; --card:#FFFFFF;
  --line:#E0E7E2; --line2:#EDF1EE; --text:#16241F; --muted:#5E6F69;
  --brand:#0E7C6B; --brand-deep:#0A5C50;
  --good:#1E8E5A; --good-bg:#E6F4EC;
  --warn:#B7790F; --warn-bg:#FBF1DC;
  --bad:#C5453B; --bad-bg:#FBE9E7;
  --shadow:0 1px 2px rgba(16,48,43,.06),0 4px 16px rgba(16,48,43,.05);
}
*{box-sizing:border-box}
.pm-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--text);background:var(--bg);min-height:100vh;-webkit-font-smoothing:antialiased}
.pm-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select,textarea{font-family:inherit;font-size:15px}
a{color:var(--brand)}

/* layout */
.shell{display:flex;min-height:100vh}
.side{width:230px;flex:0 0 230px;background:var(--ink);color:#CFE3DC;padding:22px 14px;
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 18px;color:#fff}
.brand b{font-size:16px;letter-spacing:-.01em}
.brand small{display:block;font-size:11px;color:#7FA89D;font-weight:500;letter-spacing:.02em}
.nav{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.navbtn{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;color:#B9D2CA;
  font-size:14.5px;font-weight:500;text-align:left;transition:background .12s,color .12s}
.navbtn:hover{background:rgba(255,255,255,.06);color:#fff}
.navbtn.on{background:var(--brand);color:#fff}
.navbtn .badge{margin-left:auto;background:var(--bad);color:#fff;font-size:11px;font-weight:700;
  min-width:19px;height:19px;border-radius:10px;display:grid;place-items:center;padding:0 5px}
.navbtn.on .badge{background:rgba(255,255,255,.25)}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{display:none}
.content{flex:1;padding:30px 34px 60px;max-width:1080px;width:100%;margin:0 auto}
.page-h{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.page-h h1{font-size:25px;font-weight:700;letter-spacing:-.02em;margin:0}
.page-h p{margin:3px 0 0;color:var(--muted);font-size:14px}

/* buttons */
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:9px;font-size:14px;
  font-weight:600;background:var(--brand);color:#fff;transition:background .12s,transform .04s}
.btn:hover{background:var(--brand-deep)}
.btn:active{transform:translateY(1px)}
.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
.btn.ghost:hover{background:var(--line2)}
.btn.sm{padding:6px 11px;font-size:13px}
.btn.danger{background:var(--bad-bg);color:var(--bad)}
.btn.danger:hover{background:#f6dcd9}
.iconbtn{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;color:var(--muted);
  border:1px solid transparent}
.iconbtn:hover{background:var(--line2);color:var(--ink)}

/* cards */
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.grid{display:grid;gap:14px}
.stat{padding:16px 18px}
.stat .v{font-size:26px;font-weight:700;letter-spacing:-.02em;margin-top:4px}
.stat .v small{font-size:15px;font-weight:600;color:var(--muted)}

/* attention strip */
.attn{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:10px 13px;border-radius:11px;font-size:13.5px;
  font-weight:600;border:1px solid transparent;text-align:left}
.chip:hover{filter:brightness(.98)}
.chip .n{font-size:15px;font-weight:800}
.chip.bad{background:var(--bad-bg);color:#9a342c;border-color:#f3cfca}
.chip.warn{background:var(--warn-bg);color:#7d5408;border-color:#f0dcae}
.chip.ok{background:var(--good-bg);color:#15673f;border-color:#c7e6d3}

/* badges */
.bdg{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:12px;font-weight:700}
.bdg.good{background:var(--good-bg);color:var(--good)}
.bdg.warn{background:var(--warn-bg);color:var(--warn)}
.bdg.bad{background:var(--bad-bg);color:var(--bad)}
.bdg.neutral{background:var(--line2);color:var(--muted)}
.bdg.info{background:#E8F0F8;color:#3B6FB0}

/* list rows */
.row{display:flex;align-items:center;gap:14px;padding:15px 18px;border-bottom:1px solid var(--line2)}
.row:last-child{border-bottom:none}
.dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
.row .title{font-weight:600;font-size:15px}
.row .sub{color:var(--muted);font-size:13px;margin-top:2px}
.grow{flex:1;min-width:0}
.trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* rent ledger */
.ledger{overflow-x:auto}
.ltable{border-collapse:separate;border-spacing:0;width:100%;min-width:520px}
.ltable th,.ltable td{padding:11px 8px;text-align:center;font-size:13px}
.ltable th{color:var(--muted);font-weight:600;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;
  border-bottom:1px solid var(--line)}
.ltable th.prop,.ltable td.prop{text-align:left;padding-left:18px;position:sticky;left:0;background:var(--card);min-width:150px}
.ltable td{border-bottom:1px solid var(--line2)}
.ltable tr:last-child td{border-bottom:none}
.cell{width:42px;height:30px;border-radius:8px;display:inline-grid;place-items:center;font-weight:700;
  font-size:12px;cursor:pointer;transition:transform .04s}
.cell:active{transform:scale(.92)}
.cell.paid{background:var(--good-bg);color:var(--good)}
.cell.partial{background:var(--warn-bg);color:var(--warn)}
.cell.overdue{background:var(--bad-bg);color:var(--bad)}
.cell.due{background:#fff;color:var(--muted);border:1.5px dashed var(--line)}
.cell.upcoming{background:transparent;color:#c3cdc8;border:1px solid var(--line2)}
.cell.na{color:#cdd5d1}

/* modal / sheet */
.scrim{position:fixed;inset:0;background:rgba(16,36,31,.42);display:flex;align-items:flex-end;
  justify-content:center;z-index:50;animation:fade .15s ease}
@keyframes fade{from{opacity:0}to{opacity:1}}
.sheet{background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow-y:auto;
  border-radius:18px 18px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.2);animation:slide .2s ease}
@keyframes slide{from{transform:translateY(24px)}to{transform:translateY(0)}}
.sheet-h{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;
  border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card);z-index:1}
.sheet-h h3{margin:0;font-size:17px;font-weight:700}
.sheet-b{padding:18px 20px 22px}
.sheet-f{display:flex;gap:10px;padding:16px 20px;border-top:1px solid var(--line);position:sticky;bottom:0;background:var(--card)}

/* fields */
.field{margin-bottom:14px}
.field label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:6px}
.field input,.field select,.field textarea{width:100%;padding:10px 12px;border:1px solid var(--line);
  border-radius:9px;background:#fff;color:var(--text);outline:none;transition:border .12s,box-shadow .12s}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);
  box-shadow:0 0 0 3px rgba(14,124,107,.13)}
.field textarea{resize:vertical;min-height:64px}
.frow{display:flex;gap:12px}
.frow>*{flex:1}

/* segmented */
.seg{display:inline-flex;background:var(--line2);border-radius:10px;padding:3px;gap:2px}
.seg button{padding:7px 15px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--muted)}
.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}

/* empty */
.empty{text-align:center;padding:46px 20px;color:var(--muted)}
.empty .ic{width:54px;height:54px;border-radius:14px;background:var(--line2);display:grid;place-items:center;
  margin:0 auto 14px;color:var(--brand)}
.empty h3{margin:0 0 6px;color:var(--text);font-size:17px}
.empty p{margin:0 0 18px;font-size:14px}

/* bottom tabbar (mobile) */
.tabbar{display:none}

/* legend */
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:12px}
.legend span{display:inline-flex;align-items:center;gap:5px}
.lg{width:13px;height:13px;border-radius:4px;display:inline-block}
.clickcard{transition:transform .08s,box-shadow .12s,border-color .12s;cursor:pointer}
.clickcard:hover{transform:translateY(-1px);border-color:#cbd9d2;box-shadow:0 5px 20px rgba(16,48,43,.08)}
.backline{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;font-weight:700;margin-bottom:14px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
.tabs button{padding:8px 12px;border-radius:9px;font-size:13px;font-weight:700;color:var(--muted)}
.tabs button.on{background:#fff;color:var(--ink);box-shadow:var(--shadow)}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.searchbox{position:relative;min-width:220px;flex:1}
.searchbox svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.searchbox input{width:100%;padding:10px 12px 10px 36px;border:1px solid var(--line);border-radius:9px;background:#fff}

@media (max-width:760px){
  .side{display:none}
  .content{padding:18px 16px 92px}
  .page-h h1{font-size:22px}
  .tabbar{display:flex;position:fixed;bottom:0;left:0;right:0;background:var(--card);
    border-top:1px solid var(--line);z-index:40;padding:7px 4px calc(7px + env(safe-area-inset-bottom))}
  .tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;
    color:var(--muted);font-size:10.5px;font-weight:600;position:relative}
  .tab.on{color:var(--brand)}
  .tab .tbadge{position:absolute;top:0;right:50%;margin-right:-22px;background:var(--bad);color:#fff;
    font-size:9px;font-weight:800;min-width:15px;height:15px;border-radius:8px;display:grid;place-items:center;padding:0 3px}
  .frow{flex-direction:column;gap:0}
  .sheet{max-width:none}
}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/* ------------------------------------------------------------------ */
/*  Small UI primitives                                                */
/* ------------------------------------------------------------------ */
function Sheet({ title, onClose, children, footer }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}
function Empty({ icon, title, text, action }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3>{title}</h3><p>{text}</p>{action}
    </div>
  );
}
function StatusBadge({ state }) {
  const map = {
    paid: ["good", "Paid"], partial: ["warn", "Partial"], overdue: ["bad", "Overdue"],
    due: ["neutral", "Due"], upcoming: ["neutral", "Upcoming"],
    new: ["info", "New"], scheduled: ["info", "Scheduled"], in_progress: ["warn", "In progress"], done: ["good", "Done"],
  };
  const [c, t] = map[state] || ["neutral", state];
  return <span className={`bdg ${c}`}>{t}</span>;
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */
const BLANK = { settings: { currency: "USD" }, properties: [], rent: [], hoa: [], repairs: [], docs: [], transactions: [], contacts: [] };

export default function Dashboard({ onSignOut, userEmail }) {
  const [data, setData] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("home");
  const saveTimer = useRef(null);
  const lastSync = useRef("");

  // initial load + live subscription so both accounts stay in sync
  useEffect(() => {
    let active = true;
    loadState()
      .then((d) => {
        if (!active) return;
        if (d) { setData({ ...BLANK, ...d }); lastSync.current = JSON.stringify(d); }
        setLoaded(true);
      })
      .catch((e) => { console.error(e); setLoaded(true); });
    const unsub = subscribeState((incoming) => {
      if (!incoming) return;
      const s = JSON.stringify(incoming);
      if (s === lastSync.current) return; // ignore the echo of our own write
      lastSync.current = s;
      setData({ ...BLANK, ...incoming });
    });
    return () => { active = false; unsub && unsub(); };
  }, []);

  // debounced save (last write wins)
  useEffect(() => {
    if (!loaded) return;
    const s = JSON.stringify(data);
    if (s === lastSync.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSync.current = s;
      saveState(data).catch((e) => console.error("Save failed", e));
    }, 500);
  }, [data, loaded]);

  const ccy = data.settings.currency;
  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  /* derived: attention items */
  const months = lastMonths(6);
  const attention = useMemo(() => {
    const overdueRent = [];
    data.properties.forEach((p) => {
      months.forEach((mk) => {
        if (rentStatus(p, mk, data.rent).state === "overdue") overdueRent.push({ p, mk });
      });
    });
    const urgentRepairs = data.repairs.filter((r) => r.status !== "done" && (r.priority === "urgent" || r.status === "new"));
    const openRepairs = data.repairs.filter((r) => r.status !== "done");
    const expiringDocs = data.docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) !== null && daysUntil(d.expiryDate) <= 45);
    // HOA due now/overdue
    const hoaDue = [];
    data.properties.filter((p) => Number(p.hoaAmount) > 0).forEach((p) => {
      const periods = hoaPeriods(p.hoaFrequency || "monthly");
      periods.forEach((pr) => {
        const paid = data.hoa.find((h) => h.propertyId === p.id && h.period === pr.key);
        if (!paid && pr.due <= new Date(new Date().toDateString())) hoaDue.push({ p, pr });
      });
    });
    return { overdueRent, urgentRepairs, openRepairs, expiringDocs, hoaDue };
  }, [data, months]);

  const navItems = [
    ["home", "Overview", Home, 0],
    ["properties", "Properties", Building2, 0],
    ["payments", "Payments", Banknote, attention.overdueRent.length + attention.hoaDue.length],
    ["repairs", "Repairs", Wrench, attention.openRepairs.length],
    ["directory", "Directory", Users, 0],
    ["docs", "Documents", FileText, 0],
    ["settings", "Settings", SettingsIcon, 0],
  ];

  if (!loaded) {
    return (
      <div className="pm-root"><style>{CSS}</style>
        <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="pm-root">
      <style>{CSS}</style>
      <div className="shell">
        {/* sidebar */}
        <aside className="side">
          <div className="brand">
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--brand)", display: "grid", placeItems: "center" }}>
              <Building2 size={18} color="#fff" />
            </div>
            <div><b>Casa Ledger</b><small>Rental admin</small></div>
          </div>
          <nav className="nav">
            {navItems.map(([k, label, Icon, n]) => (
              <button key={k} className={`navbtn ${view === k ? "on" : ""}`} onClick={() => setView(k)}>
                <Icon size={18} /> {label}
                {n > 0 && <span className="badge pm-num">{n}</span>}
              </button>
            ))}
          </nav>
          <div style={{ marginTop: "auto", fontSize: 11, color: "#6E938A", padding: "0 8px" }}>
            {data.properties.length} {data.properties.length === 1 ? "property" : "properties"} · {ccy}
          </div>
        </aside>

        {/* main */}
        <div className="main">
          <div className="content">
            {view === "home" && <HomeView {...{ data, ccy, attention, months, setView }} />}
            {view === "properties" && <PropertiesView {...{ data, ccy, update }} />}
            {view === "payments" && <PaymentsView {...{ data, ccy, update, months }} />}
            {view === "repairs" && <RepairsView {...{ data, ccy, update }} />}
            {view === "directory" && <DirectoryView {...{ data, update }} />}
            {view === "docs" && <DocsView {...{ data, update }} />}
            {view === "settings" && <SettingsView {...{ data, update, setData, onSignOut, userEmail }} />}
          </div>
        </div>
      </div>

      {/* mobile tabbar */}
      <nav className="tabbar">
        {navItems.slice(0, 6).map(([k, label, Icon, n]) => (
          <button key={k} className={`tab ${view === k ? "on" : ""}`} onClick={() => setView(k)}>
            {n > 0 && <span className="tbadge pm-num">{n}</span>}
            <Icon size={21} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Overview                                                           */
/* ------------------------------------------------------------------ */
function HomeView({ data, ccy, attention, months, setView }) {
  const thisMonth = monthKey(new Date());
  const active = data.properties.filter((p) => {
    if (p.leaseStart && thisMonth < p.leaseStart.slice(0, 7)) return false;
    if (p.leaseEnd && thisMonth > p.leaseEnd.slice(0, 7)) return false;
    return true;
  });
  const paidThis = active.filter((p) => rentStatus(p, thisMonth, data.rent).state === "paid");
  const expectedRent = active.reduce((s, p) => s + (Number(p.monthlyRent) || 0), 0);
  const collectedRent = active.reduce((s, p) => {
    const st = rentStatus(p, thisMonth, data.rent);
    if (st.state === "paid") return s + (Number(p.monthlyRent) || 0);
    if (st.state === "partial") return s + (Number(st.paid) || 0);
    return s;
  }, 0);

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Overview</h1>
          <p>{new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })} · what needs your attention</p>
        </div>
      </div>

      {data.properties.length === 0 ? (
        <div className="card">
          <Empty icon={<Building2 size={26} />} title="Add your first property"
            text="Set up your 5 rentals to start tracking rent, HOA, repairs and documents."
            action={<button className="btn" onClick={() => setView("properties")}><Plus size={16} /> Add property</button>} />
        </div>
      ) : (
        <>
          {/* attention chips */}
          <div className="attn">
            <button className={`chip ${attention.overdueRent.length ? "bad" : "ok"}`} onClick={() => setView("payments")}>
              {attention.overdueRent.length ? <AlertTriangle size={16} /> : <Check size={16} />}
              <span className="n pm-num">{attention.overdueRent.length}</span> rent overdue
            </button>
            <button className={`chip ${attention.hoaDue.length ? "warn" : "ok"}`} onClick={() => setView("payments")}>
              {attention.hoaDue.length ? <Clock size={16} /> : <Check size={16} />}
              <span className="n pm-num">{attention.hoaDue.length}</span> HOA due
            </button>
            <button className={`chip ${attention.urgentRepairs.length ? "bad" : "ok"}`} onClick={() => setView("repairs")}>
              <Wrench size={16} /><span className="n pm-num">{attention.urgentRepairs.length}</span> repairs need action
            </button>
            <button className={`chip ${attention.expiringDocs.length ? "warn" : "ok"}`} onClick={() => setView("docs")}>
              <FileText size={16} /><span className="n pm-num">{attention.expiringDocs.length}</span> docs expiring
            </button>
          </div>

          {/* stat cards */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", margin: "18px 0" }}>
            <div className="card stat">
              <span className="eyebrow">Rent collected · this month</span>
              <div className="v pm-num">{money(collectedRent, ccy)} <small>/ {money(expectedRent, ccy)}</small></div>
            </div>
            <div className="card stat">
              <span className="eyebrow">Properties paid</span>
              <div className="v pm-num">{paidThis.length} <small>/ {active.length}</small></div>
            </div>
            <div className="card stat">
              <span className="eyebrow">Open repairs</span>
              <div className="v pm-num">{attention.openRepairs.length}</div>
            </div>
            <div className="card stat">
              <span className="eyebrow">HOA outstanding</span>
              <div className="v pm-num">{attention.hoaDue.length}</div>
            </div>
          </div>

          {/* per-property quick status */}
          <span className="eyebrow" style={{ marginLeft: 2 }}>This month by property</span>
          <div className="card" style={{ marginTop: 10 }}>
            {active.map((p) => {
              const st = rentStatus(p, thisMonth, data.rent);
              const open = data.repairs.filter((r) => r.propertyId === p.id && r.status !== "done").length;
              return (
                <div className="row" key={p.id}>
                  <span className="dot" style={{ background: p.color }} />
                  <div className="grow">
                    <div className="title trunc">{p.name}</div>
                    <div className="sub trunc">{p.tenantName || "No tenant"} · {money(p.monthlyRent, ccy)}/mo</div>
                  </div>
                  {open > 0 && <span className="bdg neutral"><Wrench size={11} /> {open}</span>}
                  <StatusBadge state={st.state === "na" ? "upcoming" : st.state} />
                </div>
              );
            })}
            {active.length === 0 && <div className="row"><span className="sub">No active leases this month.</span></div>}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Properties                                                         */
/* ------------------------------------------------------------------ */
function PropertiesView({ data, ccy, update }) {
  const [editing, setEditing] = useState(null); // property obj or {} for new
  const [selectedId, setSelectedId] = useState(null);
  const selected = data.properties.find((p) => p.id === selectedId);
  const save = (p) => {
    if (p.id) update({ properties: data.properties.map((x) => (x.id === p.id ? p : x)) });
    else update({ properties: [...data.properties, { ...p, id: uid(), color: PROP_COLORS[data.properties.length % PROP_COLORS.length] }] });
    setEditing(null);
  };
  const remove = (id) => {
    update({
      properties: data.properties.filter((p) => p.id !== id),
      rent: data.rent.filter((r) => r.propertyId !== id),
      hoa: data.hoa.filter((h) => h.propertyId !== id),
      repairs: data.repairs.filter((r) => r.propertyId !== id),
      docs: data.docs.filter((d) => d.propertyId !== id),
    });
    setEditing(null);
    setSelectedId(null);
  };

  if (selected) {
    return (
      <PropertyWorkspace
        property={selected}
        data={data}
        ccy={ccy}
        update={update}
        onBack={() => setSelectedId(null)}
        onEdit={() => setEditing(selected)}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Properties</h1><p>Tenants, rent, lease and HOA settings</p></div>
        <button className="btn" onClick={() => setEditing({ rentDueDay: 1, hoaFrequency: "monthly" })}><Plus size={16} /> Add</button>
      </div>

      {data.properties.length === 0 ? (
        <div className="card"><Empty icon={<Building2 size={26} />} title="No properties yet"
          text="Add a property with its tenant, rent and HOA details."
          action={<button className="btn" onClick={() => setEditing({ rentDueDay: 1, hoaFrequency: "monthly" })}><Plus size={16} /> Add property</button>} /></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
          {data.properties.map((p) => {
            const openRepairs = data.repairs.filter((r) => r.propertyId === p.id && r.status !== "done").length;
            const docs = data.docs.filter((d) => d.propertyId === p.id).length;
            const fin = propertyFinancials(data, p.id);
            return (
            <div className="card clickcard" key={p.id} style={{ padding: 18 }} onClick={() => setSelectedId(p.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span className="dot" style={{ background: p.color, width: 12, height: 12 }} />
                <b style={{ fontSize: 16, flex: 1 }} className="trunc">{p.name}</b>
                <button className="iconbtn" onClick={(e) => { e.stopPropagation(); setEditing(p); }} aria-label="Edit"><Pencil size={16} /></button>
              </div>
              <div className="sub" style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>{p.address || "No address"}</div>
              <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                <Line label="Tenant" val={p.tenantName || "—"} />
                {p.tenantContact && <Line label="Contact" val={p.tenantContact} />}
                <Line label="Rent" val={`${money(p.monthlyRent, ccy)} · due day ${p.rentDueDay || 1}`} />
                <Line label="Net" val={money(fin.net, ccy)} />
                {Number(p.hoaAmount) > 0 && <Line label="HOA" val={`${money(p.hoaAmount, ccy)} ${p.hoaFrequency || "monthly"}`} />}
                {(p.leaseStart || p.leaseEnd) && <Line label="Lease" val={`${fmtDate(p.leaseStart) || "?"} – ${fmtDate(p.leaseEnd) || "ongoing"}`} />}
              </div>
              <div className="legend" style={{ marginTop: 14 }}>
                <span><Wrench size={13} /> {openRepairs} open repairs</span>
                <span><FileText size={13} /> {docs} docs</span>
              </div>
            </div>
          );})}
        </div>
      )}

      {editing && <PropertyEditor property={editing} ccy={ccy} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
    </>
  );
}

function PropertyWorkspace({ property, data, ccy, update, onBack, onEdit }) {
  const [tab, setTab] = useState("overview");
  const [repairEditing, setRepairEditing] = useState(null);
  const [docEditing, setDocEditing] = useState(null);
  const [txEditing, setTxEditing] = useState(null);
  const thisMonth = monthKey(new Date());
  const st = rentStatus(property, thisMonth, data.rent);
  const repairs = data.repairs.filter((r) => r.propertyId === property.id);
  const docs = data.docs.filter((d) => d.propertyId === property.id);
  const txs = (data.transactions || []).filter((t) => t.propertyId === property.id);
  const fin = propertyFinancials(data, property.id);

  const saveRepair = (r) => {
    if (r.id) update({ repairs: data.repairs.map((x) => (x.id === r.id ? r : x)) });
    else update({ repairs: [{ ...r, id: uid(), propertyId: property.id, createdDate: todayISO() }, ...data.repairs] });
    setRepairEditing(null);
  };
  const removeRepair = (id) => { update({ repairs: data.repairs.filter((r) => r.id !== id) }); setRepairEditing(null); };
  const saveDoc = (d) => {
    if (d.id) update({ docs: data.docs.map((x) => (x.id === d.id ? d : x)) });
    else update({ docs: [{ ...d, id: uid(), propertyId: property.id, addedDate: todayISO() }, ...data.docs] });
    setDocEditing(null);
  };
  const removeDoc = (id) => { update({ docs: data.docs.filter((d) => d.id !== id) }); setDocEditing(null); };
  const saveTx = (t) => {
    if (t.id) update({ transactions: (data.transactions || []).map((x) => (x.id === t.id ? t : x)) });
    else update({ transactions: [{ ...t, id: uid(), propertyId: property.id }, ...(data.transactions || [])] });
    setTxEditing(null);
  };
  const removeTx = (id) => { update({ transactions: (data.transactions || []).filter((t) => t.id !== id) }); setTxEditing(null); };

  return (
    <>
      <button className="backline" onClick={onBack}><ArrowLeft size={16} /> Properties</button>
      <div className="page-h">
        <div>
          <h1>{property.name}</h1>
          <p>{property.address || "No address"} · {property.tenantName || "No tenant"}</p>
        </div>
        <button className="btn ghost" onClick={onEdit}><Pencil size={15} /> Edit property</button>
      </div>
      <div className="tabs">
        {[["overview", "Overview"], ["payments", "Payments"], ["repairs", "Repairs"], ["docs", "Documents"], ["accounting", "Accounting"]].map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginBottom: 16 }}>
            <div className="card stat"><span className="eyebrow">Rent status</span><div style={{ marginTop: 8 }}><StatusBadge state={st.state === "na" ? "upcoming" : st.state} /></div></div>
            <div className="card stat"><span className="eyebrow">Monthly rent</span><div className="v pm-num">{money(property.monthlyRent, ccy)}</div></div>
            <div className="card stat"><span className="eyebrow">Open repairs</span><div className="v pm-num">{repairs.filter((r) => r.status !== "done").length}</div></div>
            <div className="card stat"><span className="eyebrow">Net accounting</span><div className="v pm-num">{money(fin.net, ccy)}</div></div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
              <Line label="Tenant" val={property.tenantName || "—"} />
              <Line label="Contact" val={property.tenantContact || "—"} />
              <Line label="Lease" val={`${fmtDate(property.leaseStart) || "?"} – ${fmtDate(property.leaseEnd) || "ongoing"}`} />
              <Line label="HOA" val={Number(property.hoaAmount) > 0 ? `${money(property.hoaAmount, ccy)} ${property.hoaFrequency || "monthly"}` : "—"} />
              {property.notes && <Line label="Notes" val={property.notes} />}
            </div>
          </div>
        </>
      )}

      {tab === "payments" && (
        <>
          <div className="toolbar">
            <button className="btn" onClick={() => setTxEditing({ propertyId: property.id, direction: "in", date: todayISO(), category: "Other income" })}><Plus size={16} /> Add transaction</button>
          </div>
          <div className="card">
            {[...txs].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((t) => (
              <div className="row" key={t.id} style={{ cursor: "pointer" }} onClick={() => setTxEditing(t)}>
                <Banknote size={18} color="var(--muted)" />
                <div className="grow">
                  <div className="title trunc">{t.category || "Transaction"} {t.direction === "out" && <span className="bdg bad" style={{ marginLeft: 4 }}>Outbound</span>}</div>
                  <div className="sub trunc">{fmtDate(t.date)}{t.party ? ` · ${t.party}` : ""}{t.note ? ` · ${t.note}` : ""}</div>
                </div>
                <b className="pm-num" style={{ color: t.direction === "out" ? "var(--bad)" : "var(--good)" }}>{t.direction === "out" ? "-" : "+"}{money(t.amount, ccy)}</b>
              </div>
            ))}
            {txs.length === 0 && <Empty icon={<ReceiptText size={26} />} title="No property transactions" text="Add one-off income or expenses here. Rent and HOA are still tracked globally." />}
          </div>
        </>
      )}

      {tab === "repairs" && (
        <>
          <div className="toolbar"><button className="btn" onClick={() => setRepairEditing({ propertyId: property.id, status: "new", priority: "medium" })}><Plus size={16} /> Add repair</button></div>
          <div className="card">
            {repairs.map((r) => (
              <div className="row" key={r.id} style={{ cursor: "pointer" }} onClick={() => setRepairEditing(r)}>
                <Wrench size={18} color="var(--muted)" />
                <div className="grow"><div className="title trunc">{r.title}</div><div className="sub trunc">{r.handyman || "No repairman"}{r.scheduledDate ? ` · ${fmtDate(r.scheduledDate)}` : ""}{r.cost ? ` · ${money(r.cost, ccy)}` : ""}</div></div>
                <StatusBadge state={r.status} />
              </div>
            ))}
            {repairs.length === 0 && <Empty icon={<Wrench size={26} />} title="No repairs for this property" text="Track maintenance issues and repairman visits here." />}
          </div>
        </>
      )}

      {tab === "docs" && (
        <>
          <div className="toolbar"><button className="btn" onClick={() => setDocEditing({ type: "lease", propertyId: property.id })}><Plus size={16} /> Add document</button></div>
          <div className="card">
            {docs.map((d) => (
              <div className="row" key={d.id} style={{ cursor: "pointer" }} onClick={() => setDocEditing(d)}>
                <FileText size={18} color="var(--muted)" />
                <div className="grow"><div className="title trunc">{d.title}</div><div className="sub trunc">{DOC_TYPES.find((t) => t[0] === d.type)?.[1] || d.type}{d.expiryDate ? ` · expires ${fmtDate(d.expiryDate)}` : ""}</div></div>
                {d.link && <a href={d.link} target="_blank" rel="noreferrer" className="iconbtn" onClick={(e) => e.stopPropagation()}><ExternalLink size={16} /></a>}
              </div>
            ))}
            {docs.length === 0 && <Empty icon={<FileText size={26} />} title="No documents for this property" text="Attach leases, titles, inspections, insurance, and tax records." />}
          </div>
        </>
      )}

      {tab === "accounting" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginBottom: 16 }}>
            <div className="card stat"><span className="eyebrow">Income</span><div className="v pm-num">{money(fin.income, ccy)}</div></div>
            <div className="card stat"><span className="eyebrow">Expenses</span><div className="v pm-num">{money(fin.expenses, ccy)}</div></div>
            <div className="card stat"><span className="eyebrow">Net</span><div className="v pm-num">{money(fin.net, ccy)}</div></div>
          </div>
          <div className="card">
            {fin.rows.map((r) => (
              <div className="row" key={r.id}>
                <ReceiptText size={18} color="var(--muted)" />
                <div className="grow"><div className="title trunc">{r.label}</div><div className="sub trunc">{r.type}{r.date ? ` · ${fmtDate(r.date)}` : ""}{r.party ? ` · ${r.party}` : ""}</div></div>
                <b className="pm-num" style={{ color: r.amount < 0 ? "var(--bad)" : "var(--good)" }}>{r.amount < 0 ? "-" : "+"}{money(Math.abs(r.amount), ccy)}</b>
              </div>
            ))}
            {fin.rows.length === 0 && <Empty icon={<ReceiptText size={26} />} title="No accounting records yet" text="Rent, HOA, repair costs, and transactions will appear here." />}
          </div>
        </>
      )}

      {repairEditing && <RepairEditor repair={repairEditing} properties={data.properties} ccy={ccy} onSave={saveRepair} onDelete={removeRepair} onClose={() => setRepairEditing(null)} />}
      {docEditing && <DocEditor doc={docEditing} properties={data.properties} onSave={saveDoc} onDelete={removeDoc} onClose={() => setDocEditing(null)} />}
      {txEditing && <TransactionEditor tx={txEditing} properties={data.properties} ccy={ccy} onSave={saveTx} onDelete={removeTx} onClose={() => setTxEditing(null)} />}
    </>
  );
}
function Line({ label, val }) {
  return <div style={{ display: "flex", gap: 8 }}>
    <span style={{ color: "var(--muted)", minWidth: 64, fontSize: 13 }}>{label}</span>
    <span className="trunc" style={{ fontWeight: 500 }}>{val}</span>
  </div>;
}
function PropertyEditor({ property, ccy, onSave, onDelete, onClose }) {
  const [p, setP] = useState({ name: "", address: "", tenantName: "", tenantContact: "", monthlyRent: "", rentDueDay: 1, leaseStart: "", leaseEnd: "", hoaName: "", hoaAmount: "", hoaFrequency: "monthly", notes: "", ...property });
  const set = (k, v) => setP((o) => ({ ...o, [k]: v }));
  return (
    <Sheet title={property.id ? "Edit property" : "Add property"} onClose={onClose}
      footer={<>
        {property.id && <button className="btn danger" onClick={() => { if (confirm("Delete this property and all its records?")) onDelete(property.id); }}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => p.name && onSave(p)}>Save</button>
      </>}>
      <Field label="Property name"><input value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sosúa Beach 2B" /></Field>
      <Field label="Address"><input value={p.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city" /></Field>
      <div className="frow">
        <Field label="Tenant name"><input value={p.tenantName} onChange={(e) => set("tenantName", e.target.value)} /></Field>
        <Field label="Tenant contact"><input value={p.tenantContact} onChange={(e) => set("tenantContact", e.target.value)} placeholder="Phone / email" /></Field>
      </div>
      <div className="frow">
        <Field label={`Monthly rent (${ccy})`}><input type="number" value={p.monthlyRent} onChange={(e) => set("monthlyRent", e.target.value)} /></Field>
        <Field label="Rent due day"><input type="number" min="1" max="28" value={p.rentDueDay} onChange={(e) => set("rentDueDay", e.target.value)} /></Field>
      </div>
      <div className="frow">
        <Field label="Lease start"><input type="date" value={p.leaseStart} onChange={(e) => set("leaseStart", e.target.value)} /></Field>
        <Field label="Lease end"><input type="date" value={p.leaseEnd} onChange={(e) => set("leaseEnd", e.target.value)} /></Field>
      </div>
      <div className="frow">
        <Field label={`HOA amount (${ccy})`}><input type="number" value={p.hoaAmount} onChange={(e) => set("hoaAmount", e.target.value)} placeholder="0 = none" /></Field>
        <Field label="HOA frequency">
          <select value={p.hoaFrequency} onChange={(e) => set("hoaFrequency", e.target.value)}>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea value={p.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Payments (rent ledger + HOA)                                       */
/* ------------------------------------------------------------------ */
function PaymentsView({ data, ccy, update, months }) {
  const [tab, setTab] = useState("rent");
  const [cell, setCell] = useState(null); // {prop, mk, status}
  const [editingTx, setEditingTx] = useState(null);

  const saveRent = (rec) => {
    const others = data.rent.filter((r) => !(r.propertyId === rec.propertyId && r.period === rec.period));
    update({ rent: rec.status === "clear" ? others : [...others, rec] });
    setCell(null);
  };
  const saveTx = (t) => {
    if (t.id) update({ transactions: (data.transactions || []).map((x) => (x.id === t.id ? t : x)) });
    else update({ transactions: [{ ...t, id: uid() }, ...(data.transactions || [])] });
    setEditingTx(null);
  };
  const removeTx = (id) => { update({ transactions: (data.transactions || []).filter((t) => t.id !== id) }); setEditingTx(null); };

  return (
    <>
      <div className="page-h">
        <div><h1>Payments</h1><p>Global rent, HOA, incoming and outgoing payment tracking</p></div>
        <div className="seg">
          <button className={tab === "rent" ? "on" : ""} onClick={() => setTab("rent")}>Rent</button>
          <button className={tab === "hoa" ? "on" : ""} onClick={() => setTab("hoa")}>HOA</button>
          <button className={tab === "transactions" ? "on" : ""} onClick={() => setTab("transactions")}>Transactions</button>
        </div>
      </div>

      {data.properties.length === 0 ? (
        <div className="card"><Empty icon={<Banknote size={26} />} title="No properties yet" text="Add a property first to track payments." /></div>
      ) : tab === "rent" ? (
        <>
          <div className="card ledger">
            <table className="ltable">
              <thead><tr><th className="prop">Property</th>{months.map((m) => <th key={m}>{monthLabel(m)}</th>)}</tr></thead>
              <tbody>
                {data.properties.map((p) => (
                  <tr key={p.id}>
                    <td className="prop"><span className="dot" style={{ background: p.color, display: "inline-block", marginRight: 8 }} /><span className="trunc" style={{ fontWeight: 600 }}>{p.name}</span></td>
                    {months.map((mk) => {
                      const st = rentStatus(p, mk, data.rent);
                      const labels = { paid: "✓", partial: "½", overdue: "!", due: "·", upcoming: "", na: "" };
                      return <td key={mk}><button className={`cell ${st.state}`} disabled={st.state === "na"}
                        onClick={() => setCell({ prop: p, mk, st })}>{labels[st.state]}</button></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend">
            <span><i className="lg" style={{ background: "var(--good-bg)" }} /> Paid</span>
            <span><i className="lg" style={{ background: "var(--warn-bg)" }} /> Partial</span>
            <span><i className="lg" style={{ background: "var(--bad-bg)" }} /> Overdue</span>
            <span><i className="lg" style={{ background: "#fff", border: "1.5px dashed var(--line)" }} /> Due</span>
          </div>
        </>
      ) : tab === "hoa" ? (
        <HoaPanel data={data} ccy={ccy} update={update} />
      ) : null}

      {cell && <RentEditor cell={cell} ccy={ccy} onSave={saveRent} onClose={() => setCell(null)} />}
      {tab === "transactions" && (
        <TransactionsPanel data={data} ccy={ccy} onEdit={setEditingTx} onAdd={() => setEditingTx({ direction: "out", propertyId: data.properties[0]?.id || "", date: todayISO(), category: "Repair" })} />
      )}
      {editingTx && <TransactionEditor tx={editingTx} properties={data.properties} ccy={ccy} onSave={saveTx} onDelete={removeTx} onClose={() => setEditingTx(null)} />}
    </>
  );
}

function TransactionsPanel({ data, ccy, onEdit, onAdd }) {
  const [q, setQ] = useState("");
  const props = Object.fromEntries(data.properties.map((p) => [p.id, p]));
  const list = (data.transactions || [])
    .filter((t) => {
      const hay = `${t.category || ""} ${t.party || ""} ${t.note || ""} ${props[t.propertyId]?.name || ""}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const income = list.filter((t) => t.direction === "in").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const out = list.filter((t) => t.direction === "out").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginBottom: 16 }}>
        <div className="card stat"><span className="eyebrow">Inbound</span><div className="v pm-num">{money(income, ccy)}</div></div>
        <div className="card stat"><span className="eyebrow">Outbound</span><div className="v pm-num">{money(out, ccy)}</div></div>
        <div className="card stat"><span className="eyebrow">Net</span><div className="v pm-num">{money(income - out, ccy)}</div></div>
      </div>
      <div className="toolbar">
        <div className="searchbox"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search property, party, note…" /></div>
        <button className="btn" onClick={onAdd}><Plus size={16} /> Add transaction</button>
      </div>
      <div className="card">
        {list.map((t) => {
          const p = props[t.propertyId];
          return (
            <div className="row" key={t.id} style={{ cursor: "pointer" }} onClick={() => onEdit(t)}>
              <Banknote size={18} color="var(--muted)" />
              <div className="grow">
                <div className="title trunc">{t.category || "Transaction"} <span className={`bdg ${t.direction === "in" ? "good" : "bad"}`} style={{ marginLeft: 4 }}>{t.direction === "in" ? "Inbound" : "Outbound"}</span></div>
                <div className="sub trunc">{p?.name || "General"} · {fmtDate(t.date)}{t.party ? ` · ${t.party}` : ""}{t.note ? ` · ${t.note}` : ""}</div>
              </div>
              <b className="pm-num" style={{ color: t.direction === "out" ? "var(--bad)" : "var(--good)" }}>{t.direction === "out" ? "-" : "+"}{money(t.amount, ccy)}</b>
            </div>
          );
        })}
        {list.length === 0 && <Empty icon={<ReceiptText size={26} />} title="No transactions found" text="Track deposits, supplies, utilities, reimbursements, and other non-rent payments." action={<button className="btn" onClick={onAdd}><Plus size={16} /> Add transaction</button>} />}
      </div>
    </>
  );
}

function TransactionEditor({ tx, properties, ccy, onSave, onDelete, onClose }) {
  const [t, setT] = useState({ direction: "out", propertyId: "", date: todayISO(), amount: "", category: "", party: "", method: "", note: "", ...tx });
  const set = (k, v) => setT((o) => ({ ...o, [k]: v }));
  return (
    <Sheet title={tx.id ? "Edit transaction" : "Add transaction"} onClose={onClose}
      footer={<>
        {tx.id && <button className="btn danger" onClick={() => onDelete(tx.id)}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => t.amount && onSave({ ...t, amount: Number(t.amount) || 0 })}>Save</button>
      </>}>
      <Field label="Direction">
        <div className="seg" style={{ display: "flex" }}>
          <button className={t.direction === "in" ? "on" : ""} style={{ flex: 1 }} onClick={() => set("direction", "in")}>Inbound</button>
          <button className={t.direction === "out" ? "on" : ""} style={{ flex: 1 }} onClick={() => set("direction", "out")}>Outbound</button>
        </div>
      </Field>
      <div className="frow">
        <Field label="Property">
          <select value={t.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
            <option value="">General</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={t.date} onChange={(e) => set("date", e.target.value)} /></Field>
      </div>
      <div className="frow">
        <Field label={`Amount (${ccy})`}><input type="number" value={t.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <Field label="Category"><input value={t.category} onChange={(e) => set("category", e.target.value)} placeholder="Repair, deposit, utility…" /></Field>
      </div>
      <div className="frow">
        <Field label="Paid by / to"><input value={t.party} onChange={(e) => set("party", e.target.value)} placeholder="Tenant, repairman, vendor…" /></Field>
        <Field label="Method"><input value={t.method} onChange={(e) => set("method", e.target.value)} placeholder="Cash, bank transfer…" /></Field>
      </div>
      <Field label="Note"><textarea value={t.note} onChange={(e) => set("note", e.target.value)} /></Field>
    </Sheet>
  );
}

function RentEditor({ cell, ccy, onSave, onClose }) {
  const { prop, mk, st } = cell;
  const [status, setStatus] = useState(st.rec?.status || (st.state === "paid" || st.state === "partial" ? st.state : "paid"));
  const [paidAmount, setPaidAmount] = useState(st.rec?.paidAmount ?? prop.monthlyRent ?? "");
  const [paidDate, setPaidDate] = useState(st.rec?.paidDate || todayISO());
  const [note, setNote] = useState(st.rec?.note || "");
  return (
    <Sheet title={`${prop.name} · ${monthLabel(mk)}`} onClose={onClose}
      footer={<>
        {st.rec && <button className="btn danger" onClick={() => onSave({ propertyId: prop.id, period: mk, status: "clear" })}>Clear</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => onSave({ propertyId: prop.id, period: mk, status, paidAmount: Number(paidAmount) || 0, paidDate, note })}>Save</button>
      </>}>
      <Field label="Status">
        <div className="seg" style={{ display: "flex" }}>
          {["paid", "partial"].map((s) => <button key={s} className={status === s ? "on" : ""} style={{ flex: 1 }} onClick={() => setStatus(s)}>{s === "paid" ? "Paid in full" : "Partial"}</button>)}
        </div>
      </Field>
      <div className="frow">
        <Field label={`Amount received (${ccy})`}><input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></Field>
        <Field label="Date received"><input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
      </div>
      <Field label="Note (method, reference…)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank transfer" /></Field>
    </Sheet>
  );
}

function HoaPanel({ data, ccy, update }) {
  const withHoa = data.properties.filter((p) => Number(p.hoaAmount) > 0);
  const toggle = (p, pr) => {
    const exists = data.hoa.find((h) => h.propertyId === p.id && h.period === pr.key);
    if (exists) update({ hoa: data.hoa.filter((h) => !(h.propertyId === p.id && h.period === pr.key)) });
    else update({ hoa: [...data.hoa, { id: uid(), propertyId: p.id, period: pr.key, amount: Number(p.hoaAmount), paidDate: todayISO() }] });
  };
  if (withHoa.length === 0)
    return <div className="card"><Empty icon={<Banknote size={26} />} title="No HOA set up" text="Add an HOA amount on a property to track its dues here." /></div>;
  const now = new Date(new Date().toDateString());
  return (
    <div className="grid" style={{ gap: 14 }}>
      {withHoa.map((p) => {
        const periods = hoaPeriods(p.hoaFrequency || "monthly");
        return (
          <div className="card" key={p.id} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
              <span className="dot" style={{ background: p.color }} />
              <b style={{ fontSize: 15, flex: 1 }} className="trunc">{p.name}</b>
              <span className="sub" style={{ color: "var(--muted)", fontSize: 13 }}>{money(p.hoaAmount, ccy)} · {p.hoaFrequency || "monthly"}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {periods.map((pr) => {
                const paid = data.hoa.find((h) => h.propertyId === p.id && h.period === pr.key);
                const overdue = !paid && pr.due <= now;
                return (
                  <button key={pr.key} onClick={() => toggle(p, pr)}
                    className={`chip ${paid ? "ok" : overdue ? "bad" : "warn"}`}
                    style={{ padding: "8px 12px" }}>
                    {paid ? <Check size={14} /> : overdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
                    {pr.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="sub" style={{ color: "var(--muted)", fontSize: 12.5, marginLeft: 2 }}>Tap a period to mark it paid or unpaid.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Repairs                                                            */
/* ------------------------------------------------------------------ */
function RepairsView({ data, ccy, update }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("open");
  const save = (r) => {
    if (r.id) update({ repairs: data.repairs.map((x) => (x.id === r.id ? r : x)) });
    else update({ repairs: [{ ...r, id: uid(), createdDate: todayISO() }, ...data.repairs] });
    setEditing(null);
  };
  const remove = (id) => { update({ repairs: data.repairs.filter((r) => r.id !== id) }); setEditing(null); };
  const list = data.repairs
    .filter((r) => (filter === "open" ? r.status !== "done" : filter === "done" ? r.status === "done" : true))
    .sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));
  const propName = (id) => data.properties.find((p) => p.id === id);

  return (
    <>
      <div className="page-h">
        <div><h1>Repairs</h1><p>Maintenance requests & handyman visits</p></div>
        <button className="btn" onClick={() => setEditing({ status: "new", priority: "medium" })}><Plus size={16} /> New request</button>
      </div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {[["open", "Open"], ["done", "Done"], ["all", "All"]].map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card"><Empty icon={<Wrench size={26} />} title="Nothing here"
          text="Log a repair when a tenant reports an issue or you schedule a handyman."
          action={<button className="btn" onClick={() => setEditing({ status: "new", priority: "medium" })}><Plus size={16} /> New request</button>} /></div>
      ) : (
        <div className="card">
          {list.map((r) => {
            const p = propName(r.propertyId);
            return (
              <div className="row" key={r.id} style={{ cursor: "pointer" }} onClick={() => setEditing(r)}>
                <span className="dot" style={{ background: p?.color || "var(--line)" }} />
                <div className="grow">
                  <div className="title trunc">{r.title} {r.priority === "urgent" && <span className="bdg bad" style={{ marginLeft: 4 }}>Urgent</span>}</div>
                  <div className="sub trunc">{p?.name || "—"}{r.reportedBy ? ` · ${r.reportedBy}` : ""}{r.scheduledDate ? ` · ${fmtDate(r.scheduledDate)}` : ""}{r.cost ? ` · ${money(r.cost, ccy)}` : ""}</div>
                </div>
                <StatusBadge state={r.status} />
                <ChevronRight size={18} color="var(--muted)" />
              </div>
            );
          })}
        </div>
      )}

      {editing && <RepairEditor repair={editing} properties={data.properties} ccy={ccy} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
    </>
  );
}
function RepairEditor({ repair, properties, ccy, onSave, onDelete, onClose }) {
  const [r, setR] = useState({ title: "", propertyId: properties[0]?.id || "", description: "", reportedBy: "", priority: "medium", status: "new", scheduledDate: "", handyman: "", cost: "", ...repair });
  const set = (k, v) => setR((o) => ({ ...o, [k]: v }));
  return (
    <Sheet title={repair.id ? "Edit request" : "New request"} onClose={onClose}
      footer={<>
        {repair.id && <button className="btn danger" onClick={() => onDelete(repair.id)}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => r.title && onSave(r)}>Save</button>
      </>}>
      <Field label="What needs fixing"><input value={r.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. AC not cooling" /></Field>
      <div className="frow">
        <Field label="Property">
          <select value={r.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Reported by"><input value={r.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} placeholder="Tenant name" /></Field>
      </div>
      <Field label="Details"><textarea value={r.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <div className="frow">
        <Field label="Priority">
          <select value={r.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={r.status} onChange={(e) => set("status", e.target.value)}>
            <option value="new">New</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Handyman"><input value={r.handyman} onChange={(e) => set("handyman", e.target.value)} /></Field>
        <Field label="Scheduled date"><input type="date" value={r.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} /></Field>
      </div>
      <Field label={`Cost (${ccy})`}><input type="number" value={r.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Directory                                                          */
/* ------------------------------------------------------------------ */
function DirectoryView({ data, update }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const save = (c) => {
    if (c.id) update({ contacts: (data.contacts || []).map((x) => (x.id === c.id ? c : x)) });
    else update({ contacts: [{ ...c, id: uid() }, ...(data.contacts || [])] });
    setEditing(null);
  };
  const remove = (id) => { update({ contacts: (data.contacts || []).filter((c) => c.id !== id) }); setEditing(null); };
  const propertyById = (id) => data.properties.find((p) => p.id === id);
  const tenantRows = data.properties
    .filter((p) => p.tenantName || p.tenantContact)
    .map((p) => ({ id: `tenant-${p.id}`, type: "tenant", name: p.tenantName || "Unnamed tenant", phone: p.tenantContact || "", propertyId: p.id, derived: true }));
  const contacts = [...tenantRows, ...(data.contacts || [])]
    .filter((c) => filter === "all" || c.type === filter)
    .filter((c) => {
      const p = propertyById(c.propertyId);
      return `${c.name || ""} ${c.phone || ""} ${c.email || ""} ${c.company || ""} ${p?.name || ""}`.toLowerCase().includes(q.toLowerCase());
    });
  return (
    <>
      <div className="page-h">
        <div><h1>Directory</h1><p>Global tenant and repairman contacts</p></div>
        <button className="btn" onClick={() => setEditing({ type: "repairman" })}><Plus size={16} /> Add contact</button>
      </div>
      <div className="toolbar">
        <div className="seg">
          {[["all", "All"], ["tenant", "Tenants"], ["repairman", "Repairmen"]].map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="searchbox"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, phone, property…" /></div>
      </div>
      <div className="card">
        {contacts.map((c) => {
          const p = propertyById(c.propertyId);
          return (
            <div className="row" key={c.id} style={{ cursor: c.derived ? "default" : "pointer" }} onClick={() => !c.derived && setEditing(c)}>
              <Users size={18} color="var(--muted)" />
              <div className="grow">
                <div className="title trunc">{c.name || "Unnamed contact"} <span className={`bdg ${c.type === "tenant" ? "info" : "neutral"}`} style={{ marginLeft: 4 }}>{c.type === "tenant" ? "Tenant" : "Repairman"}</span></div>
                <div className="sub trunc">{p?.name || c.company || "General"}{c.phone ? ` · ${c.phone}` : ""}{c.email ? ` · ${c.email}` : ""}</div>
              </div>
              {c.derived ? <span className="bdg neutral">From property</span> : <ChevronRight size={18} color="var(--muted)" />}
            </div>
          );
        })}
        {contacts.length === 0 && <Empty icon={<Users size={26} />} title="No contacts found" text="Add repairmen here. Tenants also appear automatically from property records." action={<button className="btn" onClick={() => setEditing({ type: "repairman" })}><Plus size={16} /> Add contact</button>} />}
      </div>
      {editing && <ContactEditor contact={editing} properties={data.properties} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
    </>
  );
}

function ContactEditor({ contact, properties, onSave, onDelete, onClose }) {
  const [c, setC] = useState({ type: "repairman", name: "", phone: "", email: "", company: "", propertyId: "", notes: "", ...contact });
  const set = (k, v) => setC((o) => ({ ...o, [k]: v }));
  return (
    <Sheet title={contact.id ? "Edit contact" : "Add contact"} onClose={onClose}
      footer={<>
        {contact.id && <button className="btn danger" onClick={() => onDelete(contact.id)}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => c.name && onSave(c)}>Save</button>
      </>}>
      <Field label="Type">
        <select value={c.type} onChange={(e) => set("type", e.target.value)}>
          <option value="tenant">Tenant</option>
          <option value="repairman">Repairman</option>
        </select>
      </Field>
      <Field label="Name"><input value={c.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <div className="frow">
        <Field label="Phone"><input value={c.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email"><input value={c.email} onChange={(e) => set("email", e.target.value)} /></Field>
      </div>
      <div className="frow">
        <Field label="Company"><input value={c.company} onChange={(e) => set("company", e.target.value)} /></Field>
        <Field label="Linked property">
          <select value={c.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
            <option value="">General</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea value={c.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Documents                                                          */
/* ------------------------------------------------------------------ */
const DOC_TYPES = [["lease", "Lease"], ["insurance", "Insurance"], ["deed", "Deed / Title"], ["inspection", "Inspection"], ["tax", "Tax"], ["other", "Other"]];
function DocsView({ data, update }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const fileRef = useRef(null);
  const save = (d) => {
    if (d.id) update({ docs: data.docs.map((x) => (x.id === d.id ? d : x)) });
    else update({ docs: [{ ...d, id: uid(), addedDate: todayISO() }, ...data.docs] });
    setEditing(null);
  };
  const remove = (id) => { update({ docs: data.docs.filter((d) => d.id !== id) }); setEditing(null); };
  const propName = (id) => data.properties.find((p) => p.id === id);
  const sorted = [...data.docs]
    .filter((d) => {
      const p = propName(d.propertyId);
      const type = DOC_TYPES.find((t) => t[0] === d.type)?.[1] || d.type || "";
      return `${d.title || ""} ${type} ${p?.name || ""} ${d.note || ""}`.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => {
      const da = a.expiryDate ? daysUntil(a.expiryDate) : 99999, db = b.expiryDate ? daysUntil(b.expiryDate) : 99999;
      return da - db;
    });

  // Upload a file: store it and ask Claude to suggest the details, then open
  // the editor pre-filled so you only have to confirm.
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    const apiKey = data.settings?.aiKey;
    if (!apiKey) { alert("Add your Claude API key in Settings first to use auto-fill."); return; }
    if (!canAnalyze(file)) { alert("Auto-fill works on PDFs and images. For other files, use “Add” and paste a link."); return; }
    setBusy(true);
    // Run the upload and the AI suggestion together; tolerate either failing.
    const [up, ai] = await Promise.allSettled([
      uploadDocFile(file),
      suggestDocMeta({ apiKey, file, properties: data.properties }),
    ]);
    setBusy(false);
    if (up.status === "rejected" && ai.status === "rejected") {
      console.error(up.reason, ai.reason);
      alert("Couldn't process that document. Check your API key and that Firebase Storage is enabled.");
      return;
    }
    if (ai.status === "rejected") console.error("AI suggestion failed:", ai.reason);
    if (up.status === "rejected") console.error("Upload failed:", up.reason);
    const meta = ai.status === "fulfilled" ? ai.value : {};
    setEditing({
      title: meta.title || "",
      type: meta.type || "lease",
      propertyId: meta.propertyId || "",
      expiryDate: meta.expiryDate || "",
      link: up.status === "fulfilled" ? up.value : "",
    });
  };

  return (
    <>
      <div className="page-h">
        <div><h1>Documents</h1><p>Global document search across leases, insurance, titles and renewals</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => setEditing({ type: "lease", propertyId: data.properties[0]?.id || "" })}><Plus size={16} /> Add</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Sparkles size={16} /> Upload &amp; auto-fill</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="searchbox"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, type, property, note…" /></div>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{ display: "none" }} />
      <p className="sub" style={{ color: "var(--muted)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Upload a PDF or photo and Claude suggests the title, type, property and expiry — you just confirm. The file is saved to your own storage.
      </p>

      {sorted.length === 0 ? (
        <div className="card"><Empty icon={<FileText size={26} />} title="No documents tracked"
          text={data.docs.length ? "No documents match your search." : "Upload a lease, insurance policy or title and let Claude fill in the details — or add one manually."}
          action={<button className="btn" onClick={() => fileRef.current?.click()}><Sparkles size={16} /> Upload &amp; auto-fill</button>} /></div>
      ) : (
        <div className="card">
          {sorted.map((d) => {
            const p = propName(d.propertyId);
            const dl = d.expiryDate ? daysUntil(d.expiryDate) : null;
            return (
              <div className="row" key={d.id}>
                <FileText size={18} color="var(--muted)" />
                <div className="grow" style={{ cursor: "pointer" }} onClick={() => setEditing(d)}>
                  <div className="title trunc">{d.title} <span className="bdg neutral" style={{ marginLeft: 4 }}>{DOC_TYPES.find((t) => t[0] === d.type)?.[1] || d.type}</span></div>
                  <div className="sub trunc">{p?.name || "General"}{d.expiryDate ? ` · expires ${fmtDate(d.expiryDate)}` : ""}</div>
                </div>
                {dl !== null && dl <= 45 && <span className={`bdg ${dl < 0 ? "bad" : "warn"}`}>{dl < 0 ? "Expired" : `${dl}d`}</span>}
                {d.link && <a href={d.link} target="_blank" rel="noreferrer" className="iconbtn" onClick={(e) => e.stopPropagation()}><ExternalLink size={16} /></a>}
                <button className="iconbtn" onClick={() => setEditing(d)}><Pencil size={15} /></button>
              </div>
            );
          })}
        </div>
      )}
      {editing && <DocEditor doc={editing} properties={data.properties} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
      {busy && (
        <div className="scrim" style={{ alignItems: "center" }}>
          <div className="card" style={{ padding: "26px 30px", display: "flex", alignItems: "center", gap: 14, maxWidth: 320 }}>
            <Loader2 size={22} className="spin" color="var(--brand)" />
            <div>
              <div style={{ fontWeight: 600 }}>Reading your document…</div>
              <div className="sub" style={{ color: "var(--muted)", fontSize: 13 }}>Claude is filling in the details.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function DocEditor({ doc, properties, onSave, onDelete, onClose }) {
  const [d, setD] = useState({ title: "", type: "lease", propertyId: "", link: "", expiryDate: "", note: "", ...doc });
  const set = (k, v) => setD((o) => ({ ...o, [k]: v }));
  return (
    <Sheet title={doc.id ? "Edit document" : "Add document"} onClose={onClose}
      footer={<>
        {doc.id && <button className="btn danger" onClick={() => onDelete(doc.id)}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => d.title && onSave(d)}>Save</button>
      </>}>
      <Field label="Title"><input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 2025 lease – Unit 2B" /></Field>
      <div className="frow">
        <Field label="Type">
          <select value={d.type} onChange={(e) => set("type", e.target.value)}>{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field label="Property">
          <select value={d.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
            <option value="">General</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Link to file (auto-filled when you upload)"><input value={d.link} onChange={(e) => set("link", e.target.value)} placeholder="https://" /></Field>
      <Field label="Expiry / renewal date"><input type="date" value={d.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></Field>
      <Field label="Note"><textarea value={d.note} onChange={(e) => set("note", e.target.value)} /></Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */
function SettingsView({ data, update, setData, onSignOut, userEmail }) {
  const exportJSON = () => {
    // Never write the API key into a downloaded backup.
    const { aiKey, ...settings } = data.settings || {};
    const safe = { ...data, settings };
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `casa-ledger-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importJSON = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { setData({ ...BLANK, ...JSON.parse(reader.result) }); } catch { alert("Could not read that file."); } };
    reader.readAsText(file);
  };
  return (
    <>
      <div className="page-h"><div><h1>Settings</h1><p>Preferences and your data</p></div></div>
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 420 }}>
        <Field label="Currency">
          <select value={data.settings.currency} onChange={(e) => update({ settings: { ...data.settings, currency: e.target.value } })}>
            <option value="USD">US Dollar (USD)</option>
            <option value="DOP">Dominican Peso (DOP)</option>
            <option value="EUR">Euro (EUR)</option>
          </select>
        </Field>
      </div>
      <div className="card" style={{ padding: 18, maxWidth: 420, marginBottom: 16 }}>
        <span className="eyebrow">AI document assistant</span>
        <p className="sub" style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 14px" }}>
          Paste your Claude API key to enable “Upload &amp; auto-fill” on documents. It’s stored in your
          private database and shared between both of you. Get one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
        </p>
        <Field label="Claude API key">
          <input
            type="password"
            autoComplete="off"
            placeholder={data.settings?.aiKey ? "•••••••••••• (saved)" : "sk-ant-…"}
            value={data.settings?.aiKey || ""}
            onChange={(e) => update({ settings: { ...data.settings, aiKey: e.target.value } })}
          />
        </Field>
        {data.settings?.aiKey && (
          <button className="btn ghost sm" onClick={() => update({ settings: { ...data.settings, aiKey: "" } })}>
            <Trash2 size={14} /> Remove key
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 18, maxWidth: 420, marginBottom: 16 }}>
        <span className="eyebrow">Account</span>
        <p className="sub" style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 14px" }}>
          Signed in as <b>{userEmail || "—"}</b>. Both accounts share the same data.
        </p>
        <button className="btn ghost" onClick={onSignOut}><LogOut size={15} /> Sign out</button>
      </div>
      <div className="card" style={{ padding: 18, maxWidth: 420 }}>
        <span className="eyebrow">Your data</span>
        <p className="sub" style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 14px" }}>
          Everything is stored in your private Firebase (Firestore) database and synced live between both of you. Export a backup any time.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={exportJSON}><Download size={15} /> Export backup</button>
          <label className="btn ghost" style={{ cursor: "pointer" }}><Upload size={15} /> Import<input type="file" accept="application/json" onChange={importJSON} style={{ display: "none" }} /></label>
          <button className="btn danger" onClick={() => { if (confirm("Erase all data? This cannot be undone.")) setData(BLANK); }}><Trash2 size={15} /> Reset all</button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Root: auth gate — shows Login until signed in, then the Dashboard  */
/* ------------------------------------------------------------------ */
export function Root() {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    const unsub = onAuth((u) => setUser(u));
    return () => unsub();
  }, []);

  if (user === undefined) {
    return (
      <div className="pm-root"><style>{CSS}</style>
        <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }
  if (!user) return <Login />;
  return <Dashboard userEmail={user.email} onSignOut={() => signOutUser()} />;
}
