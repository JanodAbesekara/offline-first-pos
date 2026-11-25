"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  COLOR_HEX,
  addVariant,
  adjustVariantStock,
  checkout,
  db,
  hasSupabaseConfig,
  money,
  resetDemoCatalog,
  returnSale,
  seed,
  sync,
  totals,
} from "../lib/db";
import ReceiptModal from "../components/ReceiptModal";
import ReturnModal from "../components/ReturnModal";

const CATEGORIES = ["All", "Tops", "Shirts", "Dresses", "Trousers", "Accessories"];
const MANAGER_PIN = "1234";

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" />
    </svg>
  );
}

export default function POSPage() {
  const [theme, setTheme] = useState("light");
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("pos");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [cart, setCart] = useState([]);
  const [lastAddedId, setLastAddedId] = useState(null);
  const [dt, setDt] = useState("pct");
  const [dv, setDv] = useState(0);
  const [pinInput, setPinInput] = useState("");
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [method, setMethod] = useState("CASH");
  const [tend, setTend] = useState("");
  const [rcpt, setRcpt] = useState(null);
  const [returnTarget, setReturnTarget] = useState(null);
  const [rq, setRq] = useState("");
  const [rStatusFilter, setRStatusFilter] = useState("ALL");
  const [catalogFilter, setCatalogFilter] = useState("");
  const [oversoldOnly, setOversoldOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "Tops",
    color: "Black",
    size: "M",
    sku: "",
    barcode: "",
    price: "35.00",
    stock: "10",
  });
  const [toast, setToast] = useState("");
  const [expandedSeq, setExpandedSeq] = useState(null);

  const scanRef = useRef(null);

  const flash = (msg) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    setTheme(current);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pos-theme", next);
    } catch (_) {}
  };

  const runSync = async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await sync();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    seed();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const handleConnectivity = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) runSync();
    };
    handleConnectivity();
    window.addEventListener("online", handleConnectivity);
    window.addEventListener("offline", handleConnectivity);
    const interval = setInterval(runSync, 30000);
    return () => {
      window.removeEventListener("online", handleConnectivity);
      window.removeEventListener("offline", handleConnectivity);
      clearInterval(interval);
    };
  }, []);

  // Keyboard shortcuts for <10s checkout
  useEffect(() => {
    const onKey = (e) => {
      if (tab !== "pos") return;
      if ((e.key === "/" || e.key === "F2") && document.activeElement !== scanRef.current) {
        e.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const variants = useLiveQuery(() => db.variants.toArray(), [], []);
  const sales = useLiveQuery(
    () => db.sales.orderBy("created_at").reverse().toArray(),
    [],
    [],
  );
  const outbox = useLiveQuery(
    () => db.outbox.orderBy("seq").reverse().toArray(),
    [],
    [],
  );
  const pendingCount = outbox.filter((e) => e.status === "pending").length;
  const oversoldVariants = variants.filter((v) => v.stock < 0);

  const focusScanner = () => {
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  const addToCart = (v) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === v.id);
      if (existing) {
        return prev.map((i) => (i.id === v.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...v, qty: 1 }];
    });
    setLastAddedId(v.id);
    setQ("");
    focusScanner();
    flash(`Added ${v.name} (${v.color} / ${v.size})`);
  };

  const undoLastItem = () => {
    if (!cart.length) return;
    const targetId = lastAddedId || cart[cart.length - 1].id;
    setCart((prev) =>
      prev
        .map((i) => (i.id === targetId ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0),
    );
    focusScanner();
  };

  const filteredCatalog = variants.filter((v) => {
    if (cat !== "All" && v.category !== cat) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      `${v.name} ${v.color} ${v.size} ${v.sku} ${v.category}`.toLowerCase().includes(s) ||
      v.barcode === s
    );
  });

  const handleScanEnter = async (e) => {
    if (e.key !== "Enter") return;
    const s = q.trim().toLowerCase();
    if (!s) return;
    const exact = variants.find(
      (x) => x.sku.toLowerCase() === s || x.barcode === s,
    );
    if (exact) {
      addToCart(exact);
      return;
    }
    if (filteredCatalog.length === 1) {
      addToCart(filteredCatalog[0]);
    }
  };

  const T = totals(cart, dt, Number(dv) || 0);
  const requiresPin = T.discountPct > 20 && !pinUnlocked;
  const cashCents = Math.round((parseFloat(tend) || 0) * 100);
  const canPay =
    cart.length > 0 &&
    !requiresPin &&
    (method === "CARD" || cashCents >= T.total);

  const completeSale = async () => {
    if (!canPay) return;
    const sale = await checkout(cart, dt, Number(dv) || 0, method, cashCents);
    setRcpt(sale);
    setCart([]);
    setDv(0);
    setPinInput("");
    setPinUnlocked(false);
    setTend("");
    flash(`Sale ${sale.receipt_no} saved locally`);
    runSync();
    focusScanner();
  };

  const handleReturnConfirm = async (sale, qtys, reason, restock) => {
    const res = await returnSale(sale, qtys, reason, restock);
    setReturnTarget(null);
    if (res) {
      flash(`Return queued (${money(res.refund)})`);
      runSync();
    }
  };

  const handleCreateVariant = async (e) => {
    e.preventDefault();
    if (!newItem.name.trim() || !newItem.sku.trim()) return;
    try {
      await addVariant(newItem);
      flash(`Added ${newItem.name} (${newItem.sku.toUpperCase()})`);
      setNewItem({
        name: "",
        category: "Tops",
        color: "Black",
        size: "M",
        sku: "",
        barcode: "",
        price: "35.00",
        stock: "10",
      });
      setShowAddForm(false);
    } catch (err) {
      flash("SKU or Barcode already exists");
    }
  };

  const filteredReceipts = sales.filter((s) => {
    if (rStatusFilter !== "ALL" && s.status !== rStatusFilter) return false;
    const sQ = rq.trim().toLowerCase();
    if (!sQ) return true;
    return (
      s.receipt_no.toLowerCase().includes(sQ) ||
      s.items.some((i) => `${i.name} ${i.sku}`.toLowerCase().includes(sQ))
    );
  });

  const managedCatalog = variants.filter((v) => {
    if (oversoldOnly && v.stock >= 0) return false;
    const s = catalogFilter.trim().toLowerCase();
    if (!s) return true;
    return `${v.name} ${v.color} ${v.size} ${v.sku} ${v.barcode} ${v.category}`
      .toLowerCase()
      .includes(s);
  });

  const supabaseReady = hasSupabaseConfig();

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A//</div>
          <div>
            <div className="brand-title">Atelier Boutique POS</div>
            <div className="brand-sub">
              <span>Terminal T1</span>
              <span>·</span>
              <span>{variants.length} Variants Local</span>
            </div>
          </div>
        </div>

        <nav className="nav-pills" aria-label="POS Navigation">
          <button
            className={`nav-pill ${tab === "pos" ? "active" : ""}`}
            onClick={() => {
              setTab("pos");
              focusScanner();
            }}
          >
            Checkout
            {cart.length > 0 && (
              <span className="pill-count">
                {cart.reduce((a, b) => a + b.qty, 0)}
              </span>
            )}
          </button>
          <button
            className={`nav-pill ${tab === "cat" ? "active" : ""}`}
            onClick={() => setTab("cat")}
          >
            Catalog &amp; Stock
            {oversoldVariants.length > 0 && (
              <span className="pill-count warn">{oversoldVariants.length}</span>
            )}
          </button>
          <button
            className={`nav-pill ${tab === "ret" ? "active" : ""}`}
            onClick={() => setTab("ret")}
          >
            Receipts &amp; Returns
            <span className="pill-count">{sales.length}</span>
          </button>
          <button
            className={`nav-pill ${tab === "sync" ? "active" : ""}`}
            onClick={() => setTab("sync")}
          >
            Sync Queue
            {pendingCount > 0 && (
              <span className="pill-count warn">{pendingCount}</span>
            )}
          </button>
        </nav>

        <div className="topbar-actions">
          <button
            className={`status-badge ${
              !online ? "offline" : pendingCount > 0 ? "pending" : "online"
            }`}
            onClick={() => setTab("sync")}
            title="Inspect offline sync queue"
          >
            <span className="pulse-dot" />
            <span>
              {!online
                ? "Offline"
                : syncing
                  ? "Syncing..."
                  : "Online"}
              {pendingCount > 0 ? ` · ${pendingCount} Unsynced` : " · All synced"}
            </span>
          </button>

          <button
            className="theme-btn"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            title={`Switch to ${theme === "light" ? "Dark" : "Light"} theme`}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>
      </header>

      <div className="shell">
        {oversoldVariants.length > 0 && tab === "pos" && (
          <div className="alert-banner">
            <div>
              <strong>Negative Stock Alert ({oversoldVariants.length})</strong> — Offline
              oversell detected; paid receipts were preserved safely.{" "}
              <span className="mono">
                {oversoldVariants
                  .map((v) => `${v.sku} (${v.stock})`)
                  .join(", ")}
              </span>
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                setTab("cat");
                setOversoldOnly(true);
              }}
            >
              Reconcile Stock
            </button>
          </div>
        )}

        {/* TAB 1: CHECKOUT */}
        {tab === "pos" && (
          <main className="pos-grid">
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Apparel Scanner &amp; Quick Grid</h2>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Try <span className="mono">TEE-NV-L</span> or{" "}
                  <span className="mono">9300000000001</span>
                </span>
              </div>

              <div className="scan-wrap">
                <span className="scan-icon">
                  <BarcodeIcon />
                </span>
                <input
                  ref={scanRef}
                  autoFocus
                  className="scan-input"
                  placeholder="Scan barcode, type SKU (e.g. LIN-BK-M), or search apparel..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={handleScanEnter}
                />
                <span className="scan-kbd">/ · Enter</span>
              </div>

              <div className="chip-row">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={`chip ${cat === c ? "active" : ""}`}
                    onClick={() => {
                      setCat(c);
                      focusScanner();
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className="catalog-grid">
                {filteredCatalog.map((v) => {
                  const stockClass =
                    v.stock < 0
                      ? "stock-neg"
                      : v.stock <= 2
                        ? "stock-low"
                        : "stock-ok";
                  return (
                    <button
                      key={v.id}
                      className={`variant-card ${v.stock < 0 ? "oversold" : ""}`}
                      onClick={() => addToCart(v)}
                    >
                      <div>
                        <div className="variant-top">
                          <span className="swatch-wrap">
                            <span
                              className="swatch"
                              style={{
                                background: COLOR_HEX[v.color] || "#94a3b8",
                              }}
                            />
                            {v.color}
                          </span>
                          <span className="size-tag">{v.size}</span>
                        </div>
                        <div className="variant-name" style={{ marginTop: 8 }}>
                          {v.name}
                        </div>
                        <div className="variant-sku mono">{v.sku}</div>
                      </div>

                      <div className="variant-bottom">
                        <span className="price-tag tabular">{money(v.price)}</span>
                        <span className={`stock-pill tabular ${stockClass}`}>
                          {v.stock < 0 ? `Oversold ${v.stock}` : `Qty ${v.stock}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {filteredCatalog.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", padding: 28, textAlign: "center", color: "var(--muted)" }}>
                    No variants match &ldquo;{q}&rdquo;.
                  </div>
                )}
              </div>
            </section>

            <section className="panel panel-sticky">
              <div className="panel-head">
                <h2 className="panel-title">Current Order</h2>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!cart.length}
                    onClick={undoLastItem}
                  >
                    Undo Last
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!cart.length}
                    onClick={() => {
                      setCart([]);
                      focusScanner();
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {cart.length === 0 ? (
                <div
                  style={{
                    padding: "28px 12px",
                    textAlign: "center",
                    color: "var(--muted)",
                    border: "1px dashed var(--border)",
                    borderRadius: 12,
                  }}
                >
                  Scan a barcode or tap an apparel item to start checkout.
                </div>
              ) : (
                <div className="cart-list">
                  {cart.map((i) => (
                    <div className="cart-item" key={i.id}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {i.name} · {i.color} · {i.size}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                          {i.sku} · {money(i.price)} ea
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="qty-ctrl">
                          <button
                            className="qty-btn"
                            onClick={() =>
                              setCart((c) =>
                                c.map((x) =>
                                  x.id === i.id
                                    ? { ...x, qty: Math.max(1, x.qty - 1) }
                                    : x,
                                ),
                              )
                            }
                          >
                            −
                          </button>
                          <span
                            className="mono"
                            style={{ minWidth: 18, textAlign: "center", fontSize: 13 }}
                          >
                            {i.qty}
                          </span>
                          <button
                            className="qty-btn"
                            onClick={() =>
                              setCart((c) =>
                                c.map((x) =>
                                  x.id === i.id ? { ...x, qty: x.qty + 1 } : x,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                        </div>

                        <span
                          className="mono"
                          style={{ fontWeight: 700, minWidth: 58, textAlign: "right", fontSize: 13 }}
                        >
                          {money(i.price * i.qty)}
                        </span>

                        <button
                          className="qty-btn"
                          style={{ color: "var(--danger)" }}
                          onClick={() =>
                            setCart((c) => c.filter((x) => x.id !== i.id))
                          }
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="divider" />

              {/* Discount Controls */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Discount</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={dt}
                    onChange={(e) => {
                      setDt(e.target.value);
                      setPinUnlocked(false);
                    }}
                    style={{ padding: "6px 8px", fontSize: 13 }}
                  >
                    <option value="pct">%</option>
                    <option value="fix">$ fixed</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    style={{ width: 82, padding: "6px 8px", fontSize: 13 }}
                    value={dv}
                    onChange={(e) => {
                      setDv(e.target.value);
                      setPinUnlocked(false);
                    }}
                  />
                </div>
              </div>

              <div className="chip-row" style={{ margin: "8px 0 4px" }}>
                {[0, 5, 10, 15, 20].map((pct) => (
                  <button
                    key={pct}
                    className={`chip ${dt === "pct" && Number(dv) === pct ? "active" : ""}`}
                    onClick={() => {
                      setDt("pct");
                      setDv(pct);
                      setPinUnlocked(false);
                    }}
                  >
                    {pct === 0 ? "No Disc" : `${pct}%`}
                  </button>
                ))}
              </div>

              {requiresPin && (
                <div className="guardrail-box">
                  <span>
                    <strong>Manager Guardrail:</strong> Discount &gt;20% requires PIN (demo:{" "}
                    <span className="mono">1234</span>)
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      placeholder="PIN"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      style={{ width: 76, padding: "5px 8px", fontSize: 12 }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        if (pinInput === MANAGER_PIN) {
                          setPinUnlocked(true);
                          flash("Manager override approved");
                        } else {
                          flash("Incorrect PIN (try 1234)");
                        }
                      }}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}

              <div className="divider" />

              <div className="summary-row">
                <span>Subtotal</span>
                <span className="mono">{money(T.sub)}</span>
              </div>
              <div className="summary-row">
                <span>Discount</span>
                <span className="mono">-{money(T.d)}</span>
              </div>
              <div className="summary-row">
                <span>GST (10%)</span>
                <span className="mono">{money(T.tax)}</span>
              </div>
              <div className="summary-total">
                <span>Total</span>
                <span className="mono">{money(T.total)}</span>
              </div>

              <div className="divider" />

              <div className="segmented">
                <button
                  className={`seg-btn ${method === "CASH" ? "active" : ""}`}
                  onClick={() => setMethod("CASH")}
                >
                  Cash Payment
                </button>
                <button
                  className={`seg-btn ${method === "CARD" ? "active" : ""}`}
                  onClick={() => setMethod("CARD")}
                >
                  Card Terminal
                </button>
              </div>

              {method === "CASH" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button
                      className="chip"
                      disabled={!T.total}
                      onClick={() => setTend((T.total / 100).toFixed(2))}
                    >
                      Exact
                    </button>
                    {[20, 50, 100].map((amt) => (
                      <button
                        key={amt}
                        className="chip"
                        onClick={() => setTend(String(amt))}
                      >
                        ${amt}
                      </button>
                    ))}
                    <button
                      className="chip"
                      onClick={() =>
                        setTend(String(((parseFloat(tend) || 0) + 10).toFixed(2)))
                      }
                    >
                      +$10
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Cash tendered ($)"
                    value={tend}
                    onChange={(e) => setTend(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  {T.total > 0 && cashCents >= T.total && (
                    <div className="change-banner">
                      <span>Change Due</span>
                      <span className="mono">{money(cashCents - T.total)}</span>
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn btn-accent"
                style={{ width: "100%", marginTop: 12 }}
                disabled={!canPay}
                onClick={completeSale}
              >
                Complete Sale {T.total > 0 ? `· ${money(T.total)}` : ""}
              </button>
            </section>
          </main>
        )}

        {/* TAB 2: CATALOG & STOCK */}
        {tab === "cat" && (
          <section className="panel">
            <div className="panel-head" style={{ flexWrap: "wrap" }}>
              <div>
                <h2 className="panel-title">Product &amp; Variant Catalog</h2>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Manage sizes, colors, SKUs, barcodes, retail prices, and offline stock reconciliation
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAddForm((s) => !s)}
                >
                  {showAddForm ? "Close Form" : "+ Add Variant"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await resetDemoCatalog();
                    flash("Demo clothing catalog reset");
                  }}
                >
                  Reset Demo Seed
                </button>
              </div>
            </div>

            {oversoldVariants.length > 0 && (
              <div className="alert-banner">
                <div>
                  <strong>Oversold Reconciliation Required:</strong>{" "}
                  {oversoldVariants.length} variant(s) have negative stock from offline sales.
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOversoldOnly((v) => !v)}
                >
                  {oversoldOnly ? "Show All Variants" : "Filter Oversold Only"}
                </button>
              </div>
            )}

            {showAddForm && (
              <form
                onSubmit={handleCreateVariant}
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 10,
                }}
              >
                <input
                  required
                  placeholder="Product name (e.g. Denim Jacket)"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                />
                <select
                  value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                >
                  {CATEGORIES.filter((c) => c !== "All").map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  required
                  placeholder="Color (e.g. Navy)"
                  value={newItem.color}
                  onChange={(e) => setNewItem({ ...newItem, color: e.target.value })}
                />
                <input
                  required
                  placeholder="Size (S, M, L, 32)"
                  value={newItem.size}
                  onChange={(e) => setNewItem({ ...newItem, size: e.target.value })}
                />
                <input
                  required
                  placeholder="SKU (e.g. JKT-NV-M)"
                  value={newItem.sku}
                  onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                />
                <input
                  placeholder="Barcode (auto if blank)"
                  value={newItem.barcode}
                  onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })}
                />
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Price ($)"
                  value={newItem.price}
                  onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                />
                <input
                  required
                  type="number"
                  placeholder="Stock Qty"
                  value={newItem.stock}
                  onChange={(e) => setNewItem({ ...newItem, stock: e.target.value })}
                />
                <button type="submit" className="btn btn-accent btn-sm">
                  Save Variant
                </button>
              </form>
            )}

            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <input
                placeholder="Filter by product, SKU, barcode, color, size..."
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
              {oversoldOnly && (
                <button className="chip active" onClick={() => setOversoldOnly(false)}>
                  Oversold Only ✕
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Variant</th>
                    <th>SKU / Barcode</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Quick Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {managedCatalog.map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 700 }}>{v.name}</td>
                      <td>{v.category}</td>
                      <td>
                        <span className="swatch-wrap">
                          <span
                            className="swatch"
                            style={{ background: COLOR_HEX[v.color] || "#94a3b8" }}
                          />
                          {v.color} · {v.size}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        <div>{v.sku}</div>
                        <div style={{ color: "var(--muted)" }}>{v.barcode}</div>
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {money(v.price)}
                      </td>
                      <td>
                        <span
                          className={`stock-pill tabular ${
                            v.stock < 0
                              ? "stock-neg"
                              : v.stock <= 2
                                ? "stock-low"
                                : "stock-ok"
                          }`}
                        >
                          {v.stock}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => adjustVariantStock(v.id, -1, "ADJUST")}
                          >
                            -1
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => adjustVariantStock(v.id, 1, "ADJUST")}
                          >
                            +1
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => adjustVariantStock(v.id, 5, "RECEIVE")}
                          >
                            +5 Receive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TAB 3: RECEIPTS & RETURNS */}
        {tab === "ret" && (
          <section className="panel">
            <div className="panel-head" style={{ flexWrap: "wrap" }}>
              <div>
                <h2 className="panel-title">Receipts &amp; Offline Returns</h2>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Look up any past receipt offline, reprint, or process partial/full returns
                </div>
              </div>
              <div className="chip-row" style={{ margin: 0 }}>
                {["ALL", "COMPLETED", "PARTIAL_RETURN", "RETURNED"].map((st) => (
                  <button
                    key={st}
                    className={`chip ${rStatusFilter === st ? "active" : ""}`}
                    onClick={() => setRStatusFilter(st)}
                  >
                    {st.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <input
              placeholder="Search by receipt number, item name, or SKU..."
              value={rq}
              onChange={(e) => setRq(e.target.value)}
              style={{ width: "100%", marginBottom: 12 }}
            />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Time</th>
                    <th>Items</th>
                    <th>Method</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((s) => (
                    <tr key={s.id}>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {s.receipt_no}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {s.items.map((i) => `${i.qty}× ${i.sku}`).join(", ")}
                      </td>
                      <td>{s.method}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {money(s.total)}
                      </td>
                      <td>
                        <span
                          className={`stock-pill ${
                            s.status === "COMPLETED"
                              ? "stock-ok"
                              : s.status === "PARTIAL_RETURN"
                                ? "stock-low"
                                : "stock-neg"
                          }`}
                        >
                          {s.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setRcpt(s)}
                          >
                            View / Print
                          </button>
                          {s.status !== "RETURNED" && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => setReturnTarget(s)}
                            >
                              Return / Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredReceipts.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>
                        No receipts recorded yet. Complete a sale in Checkout to inspect it here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TAB 4: SYNC QUEUE */}
        {tab === "sync" && (
          <section className="panel">
            <div className="panel-head" style={{ flexWrap: "wrap" }}>
              <div>
                <h2 className="panel-title">Resilient Outbox Sync Queue</h2>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {supabaseReady
                    ? "Connected to Supabase RPC (apply_event) · Events push chronologically"
                    : "Local Offline Demo Mode (no Supabase env vars configured — events queue safely in IndexedDB)"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!online || syncing || !supabaseReady}
                  onClick={runSync}
                >
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await db.outbox.where("status").equals("sent").delete();
                    flash("Cleared sent history");
                  }}
                >
                  Clear Sent
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Type</th>
                    <th>Idempotency Key (event_id)</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((e) => (
                    <Fragment key={e.seq}>
                      <tr>
                        <td className="mono">#{e.seq}</td>
                        <td style={{ fontWeight: 700 }}>{e.type}</td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {e.event_id}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td>
                          <span
                            className={`stock-pill ${
                              e.status === "sent" ? "stock-ok" : "stock-low"
                            }`}
                          >
                            {e.status.toUpperCase()}
                          </span>
                          {e.last_error && (
                            <div style={{ fontSize: 11, color: "var(--danger)" }}>
                              {e.last_error}
                            </div>
                          )}
                        </td>
                        <td className="mono">{e.attempts || 0}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setExpandedSeq(expandedSeq === e.seq ? null : e.seq)
                            }
                          >
                            {expandedSeq === e.seq ? "Hide" : "Inspect"}
                          </button>
                        </td>
                      </tr>
                      {expandedSeq === e.seq && (
                        <tr>
                          <td colSpan={7}>
                            <pre
                              className="mono"
                              style={{
                                margin: 0,
                                padding: 10,
                                borderRadius: 8,
                                background: "var(--surface-2)",
                                fontSize: 11,
                                overflowX: "auto",
                              }}
                            >
                              {JSON.stringify(e.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {outbox.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>
                        Outbox is empty. Offline sales and returns appear here in chronological order.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <ReceiptModal receipt={rcpt} onClose={() => setRcpt(null)} />
      <ReturnModal
        sale={returnTarget}
        onClose={() => setReturnTarget(null)}
        onConfirm={handleReturnConfirm}
      />

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
