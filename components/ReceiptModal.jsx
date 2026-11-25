"use client";
import { money } from "../lib/db";

export default function ReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <h3 className="panel-title">Digital Receipt</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div id="receipt" className="receipt-paper">
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.08em" }}>
              ATELIER BOUTIQUE POS
            </div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              Ready-to-Wear Apparel · Terminal {receipt.terminal_id || "T1"}
            </div>
          </div>

          <hr />
          <div className="receipt-line">
            <span>Receipt #</span>
            <span>{receipt.receipt_no}</span>
          </div>
          <div className="receipt-line">
            <span>Date</span>
            <span>{new Date(receipt.created_at).toLocaleString()}</span>
          </div>
          <hr />

          {receipt.items.map((item, idx) => (
            <div key={idx} style={{ marginBottom: 4 }}>
              <div className="receipt-line">
                <span>
                  {item.qty} × {item.name}
                </span>
                <span>{money(item.price * item.qty)}</span>
              </div>
              <div style={{ fontSize: 10.5, opacity: 0.7 }}>
                SKU {item.sku} @ {money(item.price)}
                {item.returned_qty > 0 ? ` · Returned: ${item.returned_qty}` : ""}
              </div>
            </div>
          ))}

          <hr />
          <div className="receipt-line">
            <span>Subtotal</span>
            <span>{money(receipt.subtotal)}</span>
          </div>
          {receipt.discount > 0 && (
            <div className="receipt-line">
              <span>Discount</span>
              <span>-{money(receipt.discount)}</span>
            </div>
          )}
          <div className="receipt-line">
            <span>GST (10%)</span>
            <span>{money(receipt.tax)}</span>
          </div>
          <div
            className="receipt-line"
            style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}
          >
            <span>TOTAL</span>
            <span>{money(receipt.total)}</span>
          </div>

          <hr />
          <div className="receipt-line">
            <span>Payment Method</span>
            <span>{receipt.method}</span>
          </div>
          {receipt.method === "CASH" && (
            <>
              <div className="receipt-line">
                <span>Tendered</span>
                <span>{money(receipt.tendered)}</span>
              </div>
              <div className="receipt-line">
                <span>Change Due</span>
                <span>{money(receipt.change)}</span>
              </div>
            </>
          )}
          {receipt.refunded_total > 0 && (
            <div className="receipt-line" style={{ fontWeight: 700, marginTop: 4 }}>
              <span>Refunded</span>
              <span>-{money(receipt.refunded_total)}</span>
            </div>
          )}

          {receipt.status !== "COMPLETED" && (
            <div className="receipt-stamp">{receipt.status.replace("_", " ")}</div>
          )}

          <div style={{ textAlign: "center", marginTop: 10, fontSize: 11 }}>
            Thank you for shopping with Atelier!
            <br />
            Offline-First Verified · ID {receipt.id.slice(0, 8)}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            className="btn btn-accent"
            style={{ flex: 1 }}
            onClick={() => window.print()}
          >
            Print Receipt
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
