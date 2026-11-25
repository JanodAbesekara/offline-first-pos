"use client";
import { useState, useEffect } from "react";
import { money } from "../lib/db";

const REASONS = [
  "Size / Fit Exchange",
  "Customer Changed Mind",
  "Defective / Damaged",
  "Void Cashier Mistake",
];

export default function ReturnModal({ sale, onClose, onConfirm }) {
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState(REASONS[0]);
  const [restock, setRestock] = useState(true);

  useEffect(() => {
    if (!sale) return;
    const init = {};
    for (const item of sale.items) {
      init[item.variant_id] = Math.max(0, item.qty - (item.returned_qty || 0));
    }
    setQtys(init);
  }, [sale]);

  if (!sale) return null;

  const selectedCount = Object.values(qtys).reduce((a, b) => a + b, 0);
  const selectedGross = sale.items.reduce(
    (sum, item) => sum + item.price * (qtys[item.variant_id] || 0),
    0,
  );
  const ratio = sale.subtotal > 0 ? selectedGross / sale.subtotal : 0;
  const estRefund = Math.round(sale.total * ratio);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Process Offline Return / Void</h3>
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
              {sale.receipt_no}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sale.items.map((item) => {
            const remaining = Math.max(0, item.qty - (item.returned_qty || 0));
            const val = qtys[item.variant_id] || 0;
            return (
              <div className="cart-item" key={item.variant_id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Sold: {item.qty} · Remaining: {remaining} · {money(item.price)}
                  </div>
                </div>
                <div className="qty-ctrl">
                  <button
                    className="qty-btn"
                    onClick={() =>
                      setQtys((p) => ({
                        ...p,
                        [item.variant_id]: Math.max(0, val - 1),
                      }))
                    }
                  >
                    −
                  </button>
                  <span className="mono" style={{ minWidth: 20, textAlign: "center", fontSize: 13 }}>
                    {val}
                  </span>
                  <button
                    className="qty-btn"
                    onClick={() =>
                      setQtys((p) => ({
                        ...p,
                        [item.variant_id]: Math.min(remaining, val + 1),
                      }))
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="divider" />

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          Return Reason
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: "100%", marginBottom: 10 }}
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
          />
          Restore returned items to local store inventory
        </label>

        <div className="summary-total" style={{ fontSize: 18 }}>
          <span>Estimated Refund</span>
          <span className="mono">{money(estRefund)}</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-danger"
            style={{ flex: 1 }}
            disabled={selectedCount === 0}
            onClick={() => onConfirm(sale, qtys, reason, restock)}
          >
            Confirm Return ({selectedCount} item{selectedCount === 1 ? "" : "s"})
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
