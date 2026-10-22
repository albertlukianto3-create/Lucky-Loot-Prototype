"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lucky Loot - Next.js (App Router) + Tailwind CSS + Framer Motion
 * Install: npm i framer-motion
 * Env    : NEXT_PUBLIC_API_URL=http://localhost:8000
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

async function api(path: string, opts: { method?: string; body?: any; token?: string | null } = {}) {
  const res = await fetch(API + path, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    let msg = "Terjadi kesalahan, coba lagi";
    if (data?.detail) {
      msg = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((d: any) => d.msg).join(", ") : msg;
    }
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

const fmt = (n: number) => (n ?? 0).toLocaleString("id-ID");
const idr = (n: number) => "Rp " + fmt(n);
const dt = (ts: number) => new Date(ts * 1000).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });

const RARITY: Record<string, string> = { common: "#94a3b8", uncommon: "#38bdf8", rare: "#a855f7", epic: "#ec4899", legendary: "#fbbf24", mythic: "#ef4444" };
const TIER_ICON: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇", platinum: "💠", ruby: "💎" };
const IW = 140;

const btnGold =
  "rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2.5 font-bold text-slate-950 shadow-[0_0_18px_rgba(251,191,36,.35)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const btnPurple =
  "rounded-lg bg-gradient-to-b from-purple-500 to-purple-700 px-4 py-2.5 font-bold text-white shadow-[0_0_18px_rgba(168,85,247,.4)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400/60 hover:text-amber-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400 focus:ring-1 focus:ring-amber-400";
const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5";

/* ------------------------------------------------------------------ */
/* AUTH                                                                */
/* ------------------------------------------------------------------ */
function AuthPanel({ onAuth }: { onAuth: (t: string, u: any) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<null | boolean>(null);

  useEffect(() => {
    setAvail(null);
    if (mode !== "register" || u.trim().length < 3) return;
    const h = setTimeout(async () => {
      try {
        const r = await api(`/api/auth/check-username?u=${encodeURIComponent(u.trim())}`);
        setAvail(r.available);
      } catch {}
    }, 400);
    return () => clearTimeout(h);
  }, [u, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api(`/api/auth/${mode}`, { body: { username: u.trim(), password: p } });
      onAuth(r.token, r.user);
    } catch (ex: any) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 px-4 py-10 lg:grid-cols-2">
      <div>
        <div className="text-5xl font-black tracking-tight sm:text-6xl">
          <span className="text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,.6)]">Lucky</span>{" "}
          <span className="text-purple-400 drop-shadow-[0_0_18px_rgba(168,85,247,.6)]">Loot</span>
        </div>
        <p className="mt-4 max-w-md text-slate-400">
          Buka case dari Bronze sampai Ruby, mainkan Roulette, Blackjack, dan Slot. Jual item jadi Coin , lalu tarik ke BCA, Mandiri, DANA, atau GoPay.
        </p>
        <div className="mt-6 grid max-w-md grid-cols-3 gap-2 text-center text-xs text-slate-300">
          {["5 tier case", "4 mini-game", "100 Coin  = Rp 10.000"].map((t) => (
            <div key={t} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-3">{t}</div>
          ))}
        </div>
      </div>
      <form onSubmit={submit} className={`${card} space-y-4 shadow-[0_0_40px_rgba(168,85,247,.15)]`}>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1">
          {(["register", "login"] as const).map((m) => (
            <button type="button" key={m} onClick={() => { setMode(m); setErr(""); }}
              className={`rounded-md py-2 text-sm font-bold ${mode === m ? "bg-purple-600 text-white" : "text-slate-400"}`}>
              {m === "register" ? "Daftar" : "Masuk"}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Username / ID</label>
          <input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} placeholder="contoh: raja_loot" autoComplete="username" maxLength={20} />
          {mode === "register" && avail === false && <p className="mt-1 text-sm text-red-400">Username sudah digunakan</p>}
          {mode === "register" && avail === true && <p className="mt-1 text-sm text-emerald-400">Username tersedia</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Password</label>
          <input className={inputCls} type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="minimal 6 karakter" autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </div>
        {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <button className={`${btnGold} w-full`} disabled={busy || u.trim().length < 3 || p.length < 6}>
          {busy ? "Memproses..." : mode === "register" ? "Buat akun" : "Masuk"}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CASE OPENING                                                        */
/* ------------------------------------------------------------------ */
function ItemTile({ it, tier }: { it: any; tier: string }) {
  const col = RARITY[it.rarity] || "#94a3b8";
  return (
    <div style={{ width: IW }} className="shrink-0 p-1.5">
      <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-slate-900 px-1 text-center"
        style={{ borderBottom: `4px solid ${col}`, boxShadow: `inset 0 -22px 26px -20px ${col}` }}>
        <div className="text-3xl">{TIER_ICON[tier] || "🎁"}</div>
        <div className="mt-1 w-full truncate text-[11px] font-semibold text-slate-200">{it.name}</div>
        <div className="text-xs font-bold text-amber-300">{fmt(it.value)} Coin </div>
      </div>
    </div>
  );
}

function CasesView({ ctx }: { ctx: any }) {
  const [cases, setCases] = useState<any>(null);
  const [tier, setTier] = useState("bronze");
  const [roll, setRoll] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api("/api/cases").then(setCases).catch((e) => ctx.notify(e.message, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api(`/api/cases/${tier}/open`, { body: {}, token: ctx.token });
      const W = boxRef.current?.offsetWidth || 600;
      const jitter = (Math.random() - 0.5) * (IW - 40);
      const target = -(r.win_index * IW + IW / 2 - W / 2 + jitter);
      ctx.setBalance(r.balance);
      setRoll({ ...r, target, tier, key: Date.now() });
    } catch (e: any) {
      ctx.notify(e.message, false);
      setBusy(false);
    }
  };

  if (!cases) return <p className="text-slate-400">Memuat case...</p>;
  const cur = cases[tier];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(cases).map(([k, v]: any) => (
          <button key={k} disabled={busy} onClick={() => setTier(k)}
            className={`rounded-xl border p-3 text-left transition ${tier === k ? "border-amber-400 bg-amber-400/10 shadow-[0_0_20px_rgba(251,191,36,.25)]" : "border-slate-800 bg-slate-900 hover:border-purple-500/60"}`}>
            <div className="text-2xl">{TIER_ICON[k]}</div>
            <div className="font-bold">{v.label}</div>
            <div className="text-sm text-amber-300">{fmt(v.price)} Coin </div>
          </button>
        ))}
      </div>

      <div className={`${card} overflow-hidden`}>
        <div ref={boxRef} className="relative h-36 overflow-hidden rounded-xl bg-slate-950">
          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-0.5 -translate-x-1/2 bg-amber-400 shadow-[0_0_14px_3px_rgba(251,191,36,.8)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-950" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-slate-950" />
          {roll ? (
            <motion.div key={roll.key} className="flex h-full items-center" initial={{ x: 0 }} animate={{ x: roll.target }}
              transition={{ duration: 6.5, ease: [0.12, 0.8, 0.15, 1] }}
              onAnimationComplete={() => { setResult(roll.item); setBusy(false); }}>
              {roll.tape.map((it: any, i: number) => <ItemTile key={i} it={it} tier={roll.tier} />)}
            </motion.div>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">Pilih case lalu tekan Buka Case</div>
          )}
        </div>
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <AnimatePresence mode="wait">
            {result && (
              <motion.div key={result.id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="rounded-lg border px-4 py-2 text-center" style={{ borderColor: RARITY[result.rarity] }}>
                Kamu mendapat <b style={{ color: RARITY[result.rarity] }}>{result.name}</b> senilai <b className="text-amber-300">{fmt(result.value)} Coin </b>
              </motion.div>
            )}
          </AnimatePresence>
          <button className={`${btnGold} w-full sm:w-auto sm:min-w-52`} disabled={busy} onClick={open}>
            {busy ? "Membuka..." : `Buka Case ${cur.label} (${fmt(cur.price)} Coin )`}
          </button>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-3 font-bold">Isi {cur.label} Case</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[...cur.items].sort((a: any, b: any) => b.value - a.value).map((it: any) => (
            <div key={it.name} className="rounded-lg bg-slate-950 p-2 text-center text-xs" style={{ borderBottom: `3px solid ${RARITY[it.rarity]}` }}>
              <div className="truncate font-semibold">{it.name}</div>
              <div className="text-amber-300">{fmt(it.value)} Coin </div>
              <div className="text-slate-500">{it.chance}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Komponen bantu taruhan                                              */
/* ------------------------------------------------------------------ */
function BetInput({ value, set, max }: { value: number; set: (n: number) => void; max: number }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate-400">Taruhan (10 - 5.000 Coin )</label>
      <input className={inputCls} type="number" min={10} max={5000} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} />
      <div className="mt-2 flex flex-wrap gap-2">
        {[10, 50, 100, 500].map((n) => <button key={n} type="button" className={btnGhost} onClick={() => set(n)}>{n}</button>)}
        <button type="button" className={btnGhost} onClick={() => set(Math.min(5000, max))}>Max</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ROULETTE                                                            */
/* ------------------------------------------------------------------ */
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const numColor = (n: number) => (n === 0 ? "#10b981" : RED_SET.has(n) ? "#ef4444" : "#334155");
const ROULETTE_BETS: [string, string][] = [
  ["red", "Merah x2"], ["black", "Hitam x2"], ["green", "Hijau 0 x36"], ["odd", "Ganjil x2"], ["even", "Genap x2"],
  ["low", "1-18 x2"], ["high", "19-36 x2"], ["dozen1", "1-12 x3"], ["dozen2", "13-24 x3"], ["dozen3", "25-36 x3"], ["number", "Angka x36"],
];

function RouletteView({ ctx }: { ctx: any }) {
  const [type, setType] = useState("red");
  const [num, setNum] = useState(7);
  const [amount, setAmount] = useState(50);
  const [spin, setSpin] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [res, setRes] = useState<any>(null);
  const [hist, setHist] = useState<number[]>([]);

  const play = async () => {
    setSpin(true);
    setRes(null);
    try {
      const body: any = { bet_type: type, amount };
      if (type === "number") body.number = num;
      const r = await api("/api/games/roulette", { body, token: ctx.token });
      const iv = setInterval(() => setShown(Math.floor(Math.random() * 37)), 70);
      setTimeout(() => {
        clearInterval(iv);
        setShown(r.number);
        setRes(r);
        setHist((h) => [r.number, ...h].slice(0, 12));
        ctx.setBalance(r.balance);
        setSpin(false);
      }, 2000);
    } catch (e: any) {
      ctx.notify(e.message, false);
      setSpin(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className={`${card} flex flex-col items-center justify-center gap-4`}>
        <motion.div animate={spin ? { rotate: 720 } : { rotate: 0 }} transition={{ duration: 2, ease: "easeOut" }}
          className="flex h-40 w-40 items-center justify-center rounded-full border-8 border-amber-400/70 shadow-[0_0_30px_rgba(251,191,36,.3)]"
          style={{ background: shown === null ? "#0f172a" : numColor(shown) }}>
          <span className="text-5xl font-black">{shown ?? "?"}</span>
        </motion.div>
        {res && (
          <div className={`text-lg font-bold ${res.win ? "text-emerald-400" : "text-red-400"}`}>
            {res.win ? `Menang +${fmt(res.payout)} Coin ` : "Kalah, coba lagi"}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-1.5">
          {hist.map((n, i) => (
            <span key={i} className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" style={{ background: numColor(n) }}>{n}</span>
          ))}
        </div>
      </div>
      <div className={`${card} space-y-4`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ROULETTE_BETS.map(([k, l]) => (
            <button key={k} disabled={spin} onClick={() => setType(k)}
              className={`rounded-lg border px-2 py-2.5 text-sm font-semibold ${type === k ? "border-amber-400 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
        {type === "number" && (
          <div>
            <label className="mb-1 block text-sm text-slate-400">Angka (0-36)</label>
            <input className={inputCls} type="number" min={0} max={36} value={num} onChange={(e) => setNum(Math.min(36, Math.max(0, Number(e.target.value) || 0)))} />
          </div>
        )}
        <BetInput value={amount} set={setAmount} max={ctx.me.Coin s} />
        <button className={`${btnPurple} w-full`} disabled={spin || amount < 10} onClick={play}>{spin ? "Memutar..." : "Putar Roulette"}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BLACKJACK                                                           */
/* ------------------------------------------------------------------ */
function PlayingCard({ c }: { c: any }) {
  if (c.hidden) return <div className="flex h-24 w-16 items-center justify-center rounded-lg border border-purple-500 bg-gradient-to-br from-purple-700 to-slate-900 text-2xl">?</div>;
  const red = c.s === "♥" || c.s === "♦";
  return (
    <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className={`flex h-24 w-16 flex-col justify-between rounded-lg bg-slate-100 p-1.5 text-lg font-bold ${red ? "text-red-600" : "text-slate-900"}`}>
      <span>{c.r}</span><span className="self-end text-2xl">{c.s}</span>
    </motion.div>
  );
}

const OUTCOME: Record<string, [string, string]> = {
  blackjack: ["Blackjack! Bayar 3:2", "text-amber-300"], win: ["Kamu menang", "text-emerald-400"],
  push: ["Seri, taruhan kembali", "text-slate-300"], lose: ["Dealer menang", "text-red-400"],
};

function BlackjackView({ ctx }: { ctx: any }) {
  const [g, setG] = useState<any>(null);
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/games/blackjack/state", { token: ctx.token }).then((r) => { if (r.active) setG(r); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = async (path: string, body?: any) => {
    setBusy(true);
    try {
      const r = await api(`/api/games/blackjack/${path}`, { method: "POST", body: body ?? undefined, token: ctx.token });
      setG(r);
      if (r.balance !== null && r.balance !== undefined) ctx.setBalance(r.balance);
    } catch (e: any) {
      ctx.notify(e.message, false);
    } finally {
      setBusy(false);
    }
  };

  const Hand = ({ title, cards, value }: any) => (
    <div>
      <div className="mb-2 text-sm text-slate-400">{title} <b className="text-slate-100">({value})</b></div>
      <div className="flex flex-wrap gap-2">{cards.map((c: any, i: number) => <PlayingCard key={i} c={c} />)}</div>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className={`${card} space-y-6 lg:col-span-2`}>
        {g ? (
          <>
            <Hand title="Dealer" cards={g.dealer} value={g.dealer_value} />
            <Hand title="Kamu" cards={g.player} value={g.player_value} />
            {!g.active && g.outcome && (
              <div className={`text-lg font-bold ${OUTCOME[g.outcome][1]}`}>
                {OUTCOME[g.outcome][0]} {g.payout > 0 && `(+${fmt(g.payout)} Coin )`}
              </div>
            )}
          </>
        ) : (
          <p className="py-10 text-center text-slate-500">Pasang taruhan untuk memulai. Dealer berhenti di 17, Blackjack bayar 3:2.</p>
        )}
      </div>
      <div className={`${card} space-y-4`}>
        {g?.active ? (
          <div className="grid grid-cols-3 gap-2">
            <button className={btnGold} disabled={busy} onClick={() => call("hit")}>Hit</button>
            <button className={btnPurple} disabled={busy} onClick={() => call("stand")}>Stand</button>
            <button className={btnGhost} disabled={busy || !g.can_double} onClick={() => call("double")}>Double</button>
          </div>
        ) : (
          <>
            <BetInput value={amount} set={setAmount} max={ctx.me.Coin s} />
            <button className={`${btnGold} w-full`} disabled={busy || amount < 10} onClick={() => call("start", { amount })}>Bagikan kartu</button>
          </>
        )}
        {g?.active && <p className="text-sm text-slate-400">Taruhan berjalan: <b className="text-amber-300">{fmt(g.bet)} Coin </b></p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SLOTS                                                               */
/* ------------------------------------------------------------------ */
const SYMS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];

function SlotsView({ ctx }: { ctx: any }) {
  const [reels, setReels] = useState(["🍒", "🔔", "7️⃣"]);
  const [spinning, setSpinning] = useState([false, false, false]);
  const [amount, setAmount] = useState(50);
  const [res, setRes] = useState<any>(null);
  const busy = spinning.some(Boolean);
  const spinningRef = useRef<boolean[]>([false, false, false]);

  const play = async () => {
    setRes(null);
    try {
      const r = await api("/api/games/slots", { body: { amount }, token: ctx.token });
      setSpinning([true, true, true]);
      const iv = setInterval(() => setReels((cur) => cur.map((s, i) => (spinningRef.current[i] ? SYMS[Math.floor(Math.random() * SYMS.length)] : s))), 80);
      spinningRef.current = [true, true, true];
      [900, 1400, 1900].forEach((ms, i) =>
        setTimeout(() => {
          spinningRef.current[i] = false;
          setSpinning((s) => s.map((v, j) => (j === i ? false : v)));
          setReels((cur) => cur.map((s, j) => (j === i ? r.reels[i] : s)));
          if (i === 2) { clearInterval(iv); setRes(r); ctx.setBalance(r.balance); }
        }, ms)
      );
    } catch (e: any) {
      ctx.notify(e.message, false);
    }
  };
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className={`${card} text-center`}>
        <div className="flex justify-center gap-3">
          {reels.map((s, i) => (
            <div key={i} className={`flex h-28 w-24 items-center justify-center rounded-xl border-2 bg-slate-950 text-5xl sm:h-32 sm:w-28 ${spinning[i] ? "border-purple-500" : "border-amber-400/70"}`}>{s}</div>
          ))}
        </div>
        <div className="mt-4 h-7 text-lg font-bold">
          {res && (res.payout > 0 ? <span className="text-emerald-400">Menang +{fmt(res.payout)} Coin (x{res.multiplier})</span> : <span className="text-red-400">Belum beruntung</span>)}
        </div>
      </div>
      <div className={`${card} space-y-4`}>
        <BetInput value={amount} set={setAmount} max={ctx.me.Coin s} />
        <button className={`${btnGold} w-full`} disabled={busy || amount < 10} onClick={play}>{busy ? "Berputar..." : "Putar Slot"}</button>
        <p className="text-xs text-slate-500">3 simbol sama: x5 sampai x150. Dua 🍒 x1, satu 🍒 x0,5.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* INVENTORY                                                           */
/* ------------------------------------------------------------------ */
function InventoryView({ ctx }: { ctx: any }) {
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => api("/api/inventory", { token: ctx.token }).then(setItems).catch((e) => ctx.notify(e.message, false)), [ctx]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sell = async (id: number) => {
    try {
      const r = await api(`/api/inventory/${id}/sell`, { body: {}, token: ctx.token });
      ctx.setBalance(r.balance);
      ctx.notify(`Item terjual +${fmt(r.sold)} Coin `);
      load();
    } catch (e: any) { ctx.notify(e.message, false); }
  };
  const sellAll = async () => {
    try {
      const r = await api("/api/inventory/sell-all", { body: {}, token: ctx.token });
      ctx.setBalance(r.balance);
      ctx.notify(`${r.count} item terjual +${fmt(r.sold)} Coin `);
      load();
    } catch (e: any) { ctx.notify(e.message, false); }
  };

  if (!items) return <p className="text-slate-400">Memuat inventory...</p>;
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-slate-400">{items.length} item, total nilai <b className="text-amber-300">{fmt(total)} Coin </b></p>
        <button className={btnGold} disabled={!items.length} onClick={sellAll}>Jual semua</button>
      </div>
      {!items.length && <div className={`${card} text-center text-slate-500`}>Inventory kosong. Buka case untuk mendapatkan item.</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl bg-slate-900 p-3 text-center" style={{ borderBottom: `4px solid ${RARITY[it.rarity]}` }}>
            <div className="text-3xl">{TIER_ICON[it.tier] || "🎁"}</div>
            <div className="truncate text-sm font-semibold">{it.name}</div>
            <div className="mb-2 text-sm text-amber-300">{fmt(it.value)} Coin </div>
            <button className={`${btnGhost} w-full`} onClick={() => sell(it.id)}>Jual</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KASIR                                                               */
/* ------------------------------------------------------------------ */
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-400/15 text-amber-300", approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300", credited: "bg-emerald-500/15 text-emerald-300",
};

function CashierView({ ctx }: { ctx: any }) {
  const [sub, setSub] = useState<"deposit" | "withdraw">("deposit");
  const [info, setInfo] = useState<any>(null);
  const [wds, setWds] = useState<any[]>([]);
  const [method, setMethod] = useState("BCA");
  const [acc, setAcc] = useState("");
  const [name, setName] = useState("");
  const [coins, setCoins] = useState(100);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api("/api/deposit/info", { token: ctx.token }));
      setWds(await api("/api/withdrawals", { token: ctx.token }));
    } catch (e: any) { ctx.notify(e.message, false); }
  }, [ctx]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/withdraw", { body: { method, account_number: acc, account_name: name, coins }, token: ctx.token });
      ctx.setBalance(r.balance);
      ctx.notify(`Permintaan withdraw ${idr(r.amount_idr)} dikirim, status Pending`);
      load();
    } catch (ex: any) { ctx.notify(ex.message, false); } finally { setBusy(false); }
  };

  if (!info) return <p className="text-slate-400">Memuat kasir...</p>;
  return (
    <div className="space-y-5">
      <div className="grid max-w-sm grid-cols-2 gap-1 rounded-lg bg-slate-900 p-1">
        {(["deposit", "withdraw"] as const).map((s) => (
          <button key={s} onClick={() => setSub(s)} className={`rounded-md py-2 text-sm font-bold ${sub === s ? "bg-purple-600" : "text-slate-400"}`}>{s === "deposit" ? "Deposit" : "Withdraw"}</button>
        ))}
      </div>

      {sub === "deposit" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className={`${card} space-y-3`}>
            <p className="text-slate-400">Rate: <b className="text-amber-300">{info.rate}</b></p>
            <div className="rounded-lg bg-slate-950 p-3">
              <div className="text-xs text-slate-500">Transfer ke</div>
              <div className="font-bold">BCA 7925409456</div>
              <div className="text-sm text-slate-400">a.n. Albert</div>
            </div>
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
              <div className="text-xs text-slate-400">Kode deposit kamu (tulis di berita/catatan transfer)</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-black tracking-wider text-amber-300">{info.code}</span>
                <button className={btnGhost} onClick={() => { navigator.clipboard?.writeText(info.code); ctx.notify("Kode disalin"); }}>Salin</button>
              </div>
            </div>
            <p className="text-sm text-slate-500">Coin masuk otomatis dalam beberapa menit setelah transfer terdeteksi. Tanpa kode, deposit perlu dicocokkan admin secara manual.</p>
          </div>
          <div className={card}>
            <h3 className="mb-3 font-bold">Riwayat deposit</h3>
            {!info.history.length && <p className="text-sm text-slate-500">Belum ada deposit.</p>}
            <div className="space-y-2">
              {info.history.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg bg-slate-950 px-3 py-2 text-sm">
                  <span>{idr(d.amount_idr)} <span className="text-amber-300">(+{fmt(d.coins)} Coin )</span></span>
                  <span className="text-xs text-slate-500">{dt(d.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={submit} className={`${card} space-y-3`}>
            <div className="grid grid-cols-4 gap-2">
              {["BCA", "Mandiri", "DANA", "GoPay"].map((m) => (
                <button type="button" key={m} onClick={() => setMethod(m)} className={`rounded-lg border px-1 py-2 text-xs font-bold sm:text-sm ${method === m ? "border-amber-400 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-900"}`}>{m}</button>
              ))}
            </div>
            <input className={inputCls} inputMode="numeric" placeholder={method === "DANA" || method === "GoPay" ? "Nomor HP e-wallet" : "Nomor rekening"} value={acc} onChange={(e) => setAcc(e.target.value.replace(/\D/g, ""))} />
            <input className={inputCls} placeholder="Nama pemilik" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <input className={inputCls} type="number" min={100} value={coins} onChange={(e) => setCoins(Number(e.target.value) || 0)} />
              <p className="mt-1 text-sm text-slate-400">Minimal 100 Coin. Kamu menerima <b className="text-amber-300">{idr(coins * 100)}</b>. Saldo: {fmt(ctx.me.coins)} Coin </p>
            </div>
            <button className={`${btnGold} w-full`} disabled={busy || coins < 100 || acc.length < 5 || name.trim().length < 2}>{busy ? "Mengirim..." : "Ajukan withdraw"}</button>
            <p className="text-xs text-slate-500">Coin ditahan dan status Pending sampai disetujui admin. Jika ditolak, Coin dikembalikan.</p>
          </form>
          <div className={card}>
            <h3 className="mb-3 font-bold">Riwayat withdraw</h3>
            {!wds.length && <p className="text-sm text-slate-500">Belum ada permintaan.</p>}
            <div className="space-y-2">
              {wds.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm">
                  <div>
                    <div>{idr(w.amount_idr)} ke {w.method}</div>
                    <div className="text-xs text-slate-500">{dt(w.created_at)}{w.note ? ` - ${w.note}` : ""}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[w.status]}`}>{w.status === "pending" ? "Pending" : w.status === "approved" ? "Disetujui" : "Ditolak"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ADMIN CONTROL CENTER                                                */
/* ------------------------------------------------------------------ */
function AdminView({ ctx }: { ctx: any }) {
  const [sub, setSub] = useState("overview");
  const [stats, setStats] = useState<any>(null);
  const [wds, setWds] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [cases, setCases] = useState<any>(null);
  const [tier, setTier] = useState("bronze");
  const [draft, setDraft] = useState<any>(null);
  const [adj, setAdj] = useState<Record<number, string>>({});
  const [assign, setAssign] = useState<Record<number, string>>({});
  const t = ctx.token;

  const load = useCallback(async () => {
    try {
      const [s, w, u, d, c] = await Promise.all([
        api("/api/admin/stats", { token: t }), api("/api/admin/withdrawals", { token: t }), api("/api/admin/users", { token: t }),
        api("/api/admin/deposits?status=unmatched", { token: t }), api("/api/admin/cases", { token: t }),
      ]);
      setStats(s); setWds(w); setUsers(u); setDeps(d); setCases(c);
    } catch (e: any) { ctx.notify(e.message, false); }
  }, [t, ctx]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cases) setDraft(JSON.parse(JSON.stringify({ price: cases[tier].price, items: cases[tier].items.map((i: any) => ({ name: i.name, value: i.value, weight: i.weight })) }))); }, [cases, tier]);

  const act = async (fn: () => Promise<any>, okMsg: string) => {
    try { await fn(); ctx.notify(okMsg); load(); } catch (e: any) { ctx.notify(e.message, false); }
  };

  const draftRtp = draft ? (() => {
    const tw = draft.items.reduce((s: number, i: any) => s + (Number(i.weight) || 0), 0);
    const ev = draft.items.reduce((s: number, i: any) => s + (Number(i.weight) || 0) * (Number(i.value) || 0), 0);
    return tw && draft.price ? ((ev / tw / draft.price) * 100).toFixed(1) : "0";
  })() : "0";

  const subs = [["overview", "Ringkasan"], ["withdraw", "Withdraw"], ["odds", "Odds Case"], ["users", "User"], ["deposits", "Deposit"]];
  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {subs.map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold ${sub === k ? "bg-purple-600" : "bg-slate-900 text-slate-400"}`}>
            {l}{k === "withdraw" && stats?.pending_withdrawals ? ` (${stats.pending_withdrawals})` : ""}{k === "deposits" && stats?.unmatched_deposits ? ` (${stats.unmatched_deposits})` : ""}
          </button>
        ))}
      </div>

      {sub === "overview" && stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[["User", fmt(stats.users)], ["Coin beredar", fmt(stats.coins_in_circulation)], ["Total deposit", idr(stats.deposit_idr_total)], ["Withdraw pending", `${stats.pending_withdrawals} (${idr(stats.pending_withdraw_idr)})`], ["Withdraw dibayar", idr(stats.paid_withdraw_idr)], ["Deposit tak cocok", fmt(stats.unmatched_deposits)]].map(([l, v]) => (
            <div key={l} className={card}><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-black text-amber-300">{v}</div></div>
          ))}
        </div>
      )}

      {sub === "withdraw" && (
        <div className="space-y-2">
          {!wds.length && <div className={`${card} text-slate-500`}>Belum ada permintaan withdraw.</div>}
          {wds.map((w) => (
            <div key={w.id} className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="text-sm">
                <div><b>{w.username}</b> - {idr(w.amount_idr)} ({fmt(w.coins)} Coin )</div>
                <div className="text-slate-400">{w.method} {w.account_number} a.n. {w.account_name}</div>
                <div className="text-xs text-slate-500">{dt(w.created_at)}</div>
              </div>
              {w.status === "pending" ? (
                <div className="flex gap-2">
                  <button className={btnGold} onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}/approve`, { body: {}, token: t }), "Withdraw disetujui")}>Approve</button>
                  <button className={btnGhost} onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}/reject`, { body: { note: "Ditolak admin" }, token: t }), "Withdraw ditolak, Coin dikembalikan")}>Tolak</button>
                </div>
              ) : <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[w.status]}`}>{w.status}</span>}
            </div>
          ))}
        </div>
      )}

      {sub === "odds" && cases && draft && (
        <div className={`${card} space-y-4`}>
          <div className="flex flex-wrap gap-2">
            {Object.keys(cases).map((k) => <button key={k} onClick={() => setTier(k)} className={`rounded-lg px-3 py-2 text-sm font-bold ${tier === k ? "bg-amber-400 text-slate-950" : "bg-slate-900 text-slate-300"}`}>{TIER_ICON[k]} {cases[k].label}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-400">Harga (Coin)</label>
            <input className={`${inputCls} w-32`} type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
            <span className="text-sm">RTP: <b className={Number(draftRtp) > 100 ? "text-red-400" : "text-emerald-400"}>{draftRtp}%</b></span>
          </div>
          <div className="space-y-2">
            {draft.items.map((it: any, i: number) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className={`${inputCls} col-span-5`} value={it.name} onChange={(e) => { const items = [...draft.items]; items[i] = { ...it, name: e.target.value }; setDraft({ ...draft, items }); }} />
                <input className={`${inputCls} col-span-3`} type="number" title="Nilai (Coin)" value={it.value} onChange={(e) => { const items = [...draft.items]; items[i] = { ...it, value: Number(e.target.value) }; setDraft({ ...draft, items }); }} />
                <input className={`${inputCls} col-span-3`} type="number" step="0.1" title="Bobot" value={it.weight} onChange={(e) => { const items = [...draft.items]; items[i] = { ...it, weight: Number(e.target.value) }; setDraft({ ...draft, items }); }} />
                <button className={`${btnGhost} col-span-1 px-0`} disabled={draft.items.length <= 2} onClick={() => setDraft({ ...draft, items: draft.items.filter((_: any, j: number) => j !== i) })}>x</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">Kolom: nama, nilai (Coin), bobot. Peluang = bobot / total bobot. Rarity otomatis dari urutan nilai.</p>
          <div className="flex flex-wrap gap-2">
            <button className={btnGhost} disabled={draft.items.length >= 12} onClick={() => setDraft({ ...draft, items: [...draft.items, { name: "Item baru", value: 10, weight: 1 }] })}>+ Tambah item</button>
            <button className={btnGold} onClick={() => act(() => api(`/api/admin/cases/${tier}`, { method: "PUT", body: draft, token: t }), "Odds disimpan")}>Simpan odds</button>
          </div>
        </div>
      )}

      {sub === "users" && (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className={`${card} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="text-sm"><b>{u.username}</b> {u.role === "admin" && <span className="ml-1 rounded bg-purple-600 px-1.5 text-xs">admin</span>}
                <div className="text-slate-400">{fmt(u.coins)} Coin- {u.deposit_code} - {dt(u.created_at)}</div></div>
              <div className="flex gap-2">
                <input className={`${inputCls} w-28`} type="number" placeholder="+/- Coin" value={adj[u.id] || ""} onChange={(e) => setAdj({ ...adj, [u.id]: e.target.value })} />
                <button className={btnGhost} disabled={!Number(adj[u.id])} onClick={() => act(() => api(`/api/admin/users/${u.id}/coins`, { body: { delta: Number(adj[u.id]), note: "manual" }, token: t }), "Saldo diperbarui").then(() => setAdj({ ...adj, [u.id]: "" }))}>Ubah saldo</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sub === "deposits" && (
        <div className="space-y-2">
          {!deps.length && <div className={`${card} text-slate-500`}>Tidak ada deposit yang belum cocok.</div>}
          {deps.map((d) => (
            <div key={d.id} className={`${card} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="text-sm"><b>{idr(d.amount_idr)}</b> (+{fmt(d.coins)} Coin ) {d.sender && <span className="text-slate-400">dari {d.sender}</span>}
                <div className="max-w-md truncate text-xs text-slate-500">{d.message}</div></div>
              <div className="flex gap-2">
                <input className={`${inputCls} w-36`} placeholder="username" value={assign[d.id] || ""} onChange={(e) => setAssign({ ...assign, [d.id]: e.target.value })} />
                <button className={btnGold} disabled={!(assign[d.id] || "").trim()} onClick={() => act(() => api(`/api/admin/deposits/${d.id}/assign`, { body: { username: assign[d.id] }, token: t }), "Deposit dikreditkan")}>Kreditkan</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FLOATING CS AI CHAT WIDGET (Riska)                                  */
/* ------------------------------------------------------------------ */
function ChatWidget({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([
    { role: "assistant", content: "Halo! Aku Riska, CS AI Lucky Loot. Ada yang bisa dibantu soal top-up, aturan game, atau kendala deposit dan withdraw?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open, busy]);

  const send = async (text: string) => {
    const m = text.trim();
    if (!m || busy) return;
    const next = [...msgs, { role: "user", content: m }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/api/chat", { body: { message: m, history: msgs.slice(-8) }, token });
      setMsgs([...next, { role: "assistant", content: r.reply }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "Maaf, Riska sedang gangguan. Coba lagi sebentar ya." }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-4 z-50 flex h-[70vh] max-h-[560px] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-purple-500/40 bg-slate-950 shadow-[0_0_40px_rgba(168,85,247,.35)] sm:w-96">
            <div className="flex items-center justify-between bg-gradient-to-r from-purple-700 to-purple-900 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 font-black text-slate-950">R</span>
                <div><div className="font-bold leading-tight">Riska</div><div className="flex items-center gap-1 text-xs text-purple-200"><span className="h-2 w-2 rounded-full bg-emerald-400" />CS AI online</div></div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Tutup chat" className="rounded-md px-2 py-1 text-xl hover:bg-white/10">×</button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "rounded-br-sm bg-amber-400 text-slate-950" : "rounded-bl-sm bg-slate-800 text-slate-100"}`}>{m.content}</div>
                </div>
              ))}
              {busy && <div className="text-sm text-slate-500">Riska sedang mengetik...</div>}
              <div ref={endRef} />
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 pb-2">
              {["Cara deposit", "Cara withdraw", "Deposit belum masuk", "Aturan game"].map((q) => (
                <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-amber-400">{q}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-800 p-3">
              <input className={inputCls} placeholder="Tulis pesan..." value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} />
              <button className={btnGold} disabled={busy || !input.trim()}>Kirim</button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen((o) => !o)} aria-label="Buka live chat CS"
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-800 text-2xl shadow-[0_0_24px_rgba(168,85,247,.6)] transition hover:scale-110 active:scale-95">
        {open ? "×" : "💬"}
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* ROOT                                                                */
/* ------------------------------------------------------------------ */
export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState("cases");
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);

  useEffect(() => { setToken(localStorage.getItem("ll_token")); setReady(true); }, []);

  const notify = useCallback((t: string, ok = true) => {
    setToast({ t, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);
  const logout = useCallback(() => {
    if (token) api("/api/auth/logout", { method: "POST", body: {}, token }).catch(() => {});
    localStorage.removeItem("ll_token");
    setToken(null); setMe(null); setTab("cases");
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setMe(await api("/api/me", { token })); } catch (e: any) { if (e.status === 401) logout(); }
  }, [token, logout]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => clearInterval(iv);
  }, [token, refresh]);

  const onAuth = (t: string, u: any) => { localStorage.setItem("ll_token", t); setToken(t); setMe(u); };
  const setBalance = useCallback((b: number) => setMe((m: any) => (m ? { ...m, coins: b } : m)), []);
  const ctx = { token, me, setBalance, notify, refresh };

  const tabs: [string, string][] = [["cases", "Case"], ["roulette", "Roulette"], ["blackjack", "Blackjack"], ["slots", "Slots"], ["inventory", "Inventory"], ["cashier", "Kasir"]];
  if (me?.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ backgroundImage: "radial-gradient(ellipse at top, rgba(88,28,135,.25), transparent 60%)" }}>
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="text-xl font-black sm:text-2xl"><span className="text-amber-300">Lucky</span> <span className="text-purple-400">Loot</span></div>
          {me && (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-sm font-bold text-amber-300 shadow-[0_0_14px_rgba(251,191,36,.25)]">Coin{fmt(me.coins)}</div>
              <span className="hidden text-sm text-slate-400 sm:inline">{me.username}</span>
              <button className={btnGhost} onClick={logout}>Keluar</button>
            </div>
          )}
        </div>
        {me && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold transition ${tab === k ? "bg-purple-600 text-white shadow-[0_0_14px_rgba(168,85,247,.5)]" : "text-slate-400 hover:text-slate-100"}`}>{l}</button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {!ready ? null : !token || !me ? (
          token ? <p className="py-20 text-center text-slate-500">Memuat akun...</p> : <AuthPanel onAuth={onAuth} />
        ) : (
          <>
            {tab === "cases" && <CasesView ctx={ctx} />}
            {tab === "roulette" && <RouletteView ctx={ctx} />}
            {tab === "blackjack" && <BlackjackView ctx={ctx} />}
            {tab === "slots" && <SlotsView ctx={ctx} />}
            {tab === "inventory" && <InventoryView ctx={ctx} />}
            {tab === "cashier" && <CashierView ctx={ctx} />}
            {tab === "admin" && me.role === "admin" && <AdminView ctx={ctx} />}
          </>
        )}
      </main>

      <footer className="px-4 pb-24 pt-6 text-center text-xs text-slate-600">Lucky Loot - prototype. Bermain bijak, hanya untuk 18+.</footer>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            className={`fixed left-1/2 top-20 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl ${toast.ok ? "border-emerald-500/50 bg-emerald-950 text-emerald-200" : "border-red-500/50 bg-red-950 text-red-200"}`}>
            {toast.t}
          </motion.div>
        )}
      </AnimatePresence>

      <ChatWidget token={token} />
    </div>
  );
}
