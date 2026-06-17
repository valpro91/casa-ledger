import React, { useState } from "react";
import { Building2, LogIn } from "lucide-react";
import { signIn } from "./firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!email || !password) return;
    setBusy(true); setErr("");
    try {
      await signIn(email, password);
    } catch (e) {
      setErr("Wrong email or password.");
    }
    setBusy(false);
  };

  return (
    <div style={styles.wrap}>
      <style>{focusCss}</style>
      <div style={styles.card} className="casa-login">
        <div style={styles.logo}><Building2 size={22} color="#fff" /></div>
        <h1 style={styles.h1}>Casa Ledger</h1>
        <p style={styles.sub}>Sign in to manage your rentals</p>

        <label style={styles.label}>Email</label>
        <input
          style={styles.input} type="email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <label style={styles.label}>Password</label>
        <input
          style={styles.input} type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {err && <div style={styles.err}>{err}</div>}

        <button style={{ ...styles.btn, opacity: busy ? 0.7 : 1 }} onClick={submit} disabled={busy}>
          <LogIn size={16} /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

const focusCss = `
  .casa-login input:focus{border-color:#0E7C6B;box-shadow:0 0 0 3px rgba(14,124,107,.15);outline:none}
`;
const styles = {
  wrap: {
    minHeight: "100vh", display: "grid", placeItems: "center", padding: 20,
    background: "#EEF2EF",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  },
  card: {
    width: "100%", maxWidth: 380, background: "#fff", borderRadius: 18, padding: "34px 28px",
    border: "1px solid #E0E7E2", boxShadow: "0 8px 40px rgba(16,48,43,.10)",
  },
  logo: { width: 46, height: 46, borderRadius: 12, background: "#0E7C6B", display: "grid", placeItems: "center", marginBottom: 16 },
  h1: { margin: 0, fontSize: 22, fontWeight: 700, color: "#16241F", letterSpacing: "-.02em" },
  sub: { margin: "4px 0 22px", fontSize: 14, color: "#5E6F69" },
  label: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#5E6F69", margin: "0 0 6px" },
  input: {
    width: "100%", padding: "11px 12px", border: "1px solid #E0E7E2", borderRadius: 9,
    marginBottom: 14, fontSize: 15, boxSizing: "border-box", color: "#16241F", background: "#fff",
  },
  err: { background: "#FBE9E7", color: "#C5453B", fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 9, marginBottom: 14 },
  btn: {
    width: "100%", padding: "11px 14px", border: "none", borderRadius: 9, background: "#0E7C6B",
    color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  },
};
