import React, { useState, useEffect, useMemo } from "react";

// ============================================================
// AYARLAR - BURAYI GÜNCELLE!
// ============================================================
const API_URL = "https://script.google.com/macros/s/AKfycbzM5TkuQXUqPJgNLVlNBA2XXA0YFiRVvYlH9oXumB28ulVQaCnKm43l6uCnZgB6WCXS/exec"; 

// ============================================================
// VERİ KATMANI (localStorage)
// ============================================================
const STORAGE_KEYS = { holdings: "ptf_holdings", history: "ptf_history" };
const DB = {
  get: (key) => JSON.parse(localStorage.getItem(key)) || [],
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val))
};

// ============================================================
// YARDIMCI FONKSİYONLAR
// ============================================================
const fmt = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTL = (n) => n == null ? "—" : fmt(n) + " ₺";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ============================================================
// ANA UYGULAMA BİLEŞENİ
// ============================================================
export default function PortfolioApp() {
  const [holdings, setHoldings] = useState(() => DB.get(STORAGE_KEYS.holdings));
  const [history, setHistory] = useState(() => DB.get(STORAGE_KEYS.history));
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, assets, history

  // Modal Durumları
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [sellingAsset, setSellingAsset] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ----------------------------------------------------------
  // Fiyat Çekme (Backend Bağlantısı)
  // ----------------------------------------------------------
  const fetchPrices = async () => {
    if (API_URL.includes("BURAYA_GOOGLE")) {
      console.warn("Lütfen geçerli bir API_URL girin.");
      return;
    }
    setLoading(true);
    try {
      const symbols = holdings
        .filter(h => h.type === "BIST")
        .map(h => h.symbol)
        .join(",");
      
      const res = await fetch(`${API_URL}?symbols=${symbols}`);
      const data = await res.json();
      if (data && data.prices) {
        setPrices(data.prices);
      }
    } catch (err) {
      console.error("Fiyat çekme hatası:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 5 * 60 * 1000); // 5 dk bir güncelle
    return () => clearInterval(interval);
  }, [holdings.length]);

  // ----------------------------------------------------------
  // Varlık Ekleme / Düzenleme
  // ----------------------------------------------------------
  const saveAsset = (formData) => {
    let updated;
    if (editingAsset) {
      // DÜZENLEME (Hata Çözüldü: Mevcut veriler korunarak güncellenir)
      updated = holdings.map(h => h.id === editingAsset.id ? { 
        ...h, 
        ...formData,
        lots: [{ ...h.lots[0], qty: formData.qty, remaining: formData.qty, price: formData.price, date: formData.date }] 
      } : h);
    } else {
      // YENİ EKLEME
      const newAsset = {
        id: uid(),
        ...formData,
        lots: [{ id: uid(), qty: formData.qty, remaining: formData.qty, price: formData.price, date: formData.date }]
      };
      updated = [...holdings, newAsset];
    }
    setHoldings(updated);
    DB.set(STORAGE_KEYS.holdings, updated);
    setIsAddModalOpen(false);
    setEditingAsset(null);
  };

  // ----------------------------------------------------------
  // Silme Fonksiyonu (Hata Çözüldü: Doğrudan state'e bağlı)
  // ----------------------------------------------------------
  const deleteAsset = (id) => {
    const updated = holdings.filter(h => h.id !== id);
    setHoldings(updated);
    DB.set(STORAGE_KEYS.holdings, updated);
    setConfirmDelete(null);
  };

  // ----------------------------------------------------------
  // FIFO Satış Mantığı
  // ----------------------------------------------------------
  const sellAsset = (holding, sellQty, sellPrice, sellDate) => {
    let remainingToSell = Number(sellQty);
    const newHoldings = [...holdings];
    const assetIndex = newHoldings.findIndex(h => h.id === holding.id);
    const targetAsset = { ...newHoldings[assetIndex] };
    const soldLotsInfo = [];

    // Lotları tarihe göre sırala (FIFO için en eski en önce)
    targetAsset.lots.sort((a, b) => new Date(a.date) - new Date(b.date));

    for (let lot of targetAsset.lots) {
      if (remainingToSell <= 0) break;
      if (lot.remaining <= 0) continue;

      const amountFromThisLot = Math.min(lot.remaining, remainingToSell);
      lot.remaining -= amountFromThisLot;
      remainingToSell -= amountFromThisLot;

      soldLotsInfo.push({
        symbol: targetAsset.symbol,
        qty: amountFromThisLot,
        buyPrice: lot.price,
        sellPrice: sellPrice,
        date: sellDate,
        pnl: (sellPrice - lot.price) * amountFromThisLot
      });
    }

    // Geçmişi güncelle
    const newHistory = [...soldLotsInfo, ...history];
    setHistory(newHistory);
    DB.set(STORAGE_KEYS.history, newHistory);

    // Kalan varlığı güncelle (eğer tamamen bittiyse listeden çıkar)
    const totalRemaining = targetAsset.lots.reduce((sum, l) => sum + l.remaining, 0);
    if (totalRemaining <= 0) {
      newHoldings.splice(assetIndex, 1);
    } else {
      newHoldings[assetIndex] = targetAsset;
    }

    setHoldings(newHoldings);
    DB.set(STORAGE_KEYS.holdings, newHoldings);
    setSellingAsset(null);
  };

  // ----------------------------------------------------------
  // Arayüz Parçaları
  // ----------------------------------------------------------
  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "sans-serif", paddingBottom: "80px" }}>
      
      {/* HEADER */}
      <div style={{ padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Tayfun Portföy</h1>
        <button 
          onClick={fetchPrices} 
          style={{ background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "8px 12px", borderRadius: "8px", cursor: "pointer" }}
        >
          {loading ? "Giriş yapılıyor..." : "🔄 Güncelle"}
        </button>
      </div>

      {/* DASHBOARD */}
      {activeTab === "dashboard" && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", padding: "24px", borderRadius: "16px", border: "1px solid #334155" }}>
            <p style={{ color: "#94a3b8", fontSize: "14px" }}>Toplam Varlık Değeri</p>
            <h2 style={{ fontSize: "32px", margin: "8px 0" }}>
              {fmtTL(holdings.reduce((sum, h) => {
                const price = prices[h.symbol] || h.lots[0].price;
                return sum + (price * h.lots.reduce((s, l) => s + l.remaining, 0));
              }, 0))}
            </h2>
          </div>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: "10px" }}>* Fiyatlar Google Finance üzerinden çekilmektedir.</p>
        </div>
      )}

      {/* VARLIKLAR LİSTESİ */}
      {activeTab === "assets" && (
        <div style={{ padding: "0 20px" }}>
          <button 
            onClick={() => { setEditingAsset(null); setIsAddModalOpen(true); }}
            style={{ width: "100%", padding: "12px", background: "#3b82f6", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", marginBottom: "20px" }}
          >
            + Yeni Varlık Ekle
          </button>
          
          {holdings.map(h => (
            <div key={h.id} style={{ background: "#1e293b", padding: "16px", borderRadius: "12px", marginBottom: "12px", border: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: "bold", color: "#60a5fa" }}>{h.symbol}</span>
                <span style={{ fontSize: "14px" }}>{fmt(h.lots.reduce((s, l) => s + l.remaining, 0))} Adet</span>
              </div>
              <div style={{ marginTop: "10px", display: "flex", gap: "10px" }}>
                <button onClick={() => setSellingAsset(h)} style={{ flex: 1, padding: "6px", borderRadius: "6px", background: "#22c55e", border: "none", color: "white" }}>Sat</button>
                <button onClick={() => { setEditingAsset(h); setIsAddModalOpen(true); }} style={{ flex: 1, padding: "6px", borderRadius: "6px", background: "#f59e0b", border: "none", color: "white" }}>Düzenle</button>
                <button onClick={() => setConfirmDelete(h)} style={{ flex: 1, padding: "6px", borderRadius: "6px", background: "#ef4444", border: "none", color: "white" }}>Sil</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GEÇMİŞ */}
      {activeTab === "history" && (
        <div style={{ padding: "0 20px" }}>
          <h3 style={{ marginBottom: "15px" }}>Satış Geçmişi</h3>
          {history.map((item, idx) => (
            <div key={idx} style={{ padding: "12px", borderBottom: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{item.symbol}</span>
                <span style={{ color: item.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtTL(item.pnl)}</span>
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8" }}>{item.date} | {item.qty} adet</div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: EKLE / DÜZENLE */}
      {isAddModalOpen && (
        <AssetFormModal 
          initial={editingAsset} 
          onSave={saveAsset} 
          onClose={() => setIsAddModalOpen(false)} 
        />
      )}

      {/* MODAL: SATIŞ */}
      {sellingAsset && (
        <SellModal 
          asset={sellingAsset} 
          onSell={sellAsset} 
          onClose={() => setSellingAsset(null)} 
        />
      )}

      {/* MODAL: SİLME ONAY */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "#1e293b", padding: "20px", borderRadius: "12px", width: "100%" }}>
            <p>{confirmDelete.symbol} varlığını silmek istediğine emin misin?</p>
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={() => deleteAsset(confirmDelete.id)} style={{ flex: 1, padding: "10px", background: "#ef4444", border: "none", borderRadius: "8px", color: "white" }}>Evet, Sil</button>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: "10px", background: "#475569", border: "none", borderRadius: "8px", color: "white" }}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {/* TAB NAVIGATOR */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1e293b", display: "flex", padding: "10px", borderTop: "1px solid #334155" }}>
        <button onClick={() => setActiveTab("dashboard")} style={{ flex: 1, background: "none", border: "none", color: activeTab === "dashboard" ? "#3b82f6" : "#94a3b8" }}>🏠 Ana Sayfa</button>
        <button onClick={() => setActiveTab("assets")} style={{ flex: 1, background: "none", border: "none", color: activeTab === "assets" ? "#3b82f6" : "#94a3b8" }}>💰 Varlıklar</button>
        <button onClick={() => setActiveTab("history")} style={{ flex: 1, background: "none", border: "none", color: activeTab === "history" ? "#3b82f6" : "#94a3b8" }}>📜 Geçmiş</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// MODAL BİLEŞENLERİ (İç bileşen olarak)
// ----------------------------------------------------------

function AssetFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    type: "BIST",
    symbol: "",
    qty: "",
    price: "",
    date: new Date().toISOString().split("T")[0],
    takeProfit: "",
    stopLoss: ""
  });

  // DÜZENLEME HATASI ÇÖZÜMÜ: Verileri form içine basıyoruz
  useEffect(() => {
    if (initial) {
      setForm({
        type: initial.type,
        symbol: initial.symbol,
        qty: initial.lots[0].remaining,
        price: initial.lots[0].price,
        date: initial.lots[0].date,
        takeProfit: initial.takeProfit || "",
        stopLoss: initial.stopLoss || ""
      });
    }
  }, [initial]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 1000 }}>
      <div style={{ background: "#0f172a", width: "100%", padding: "20px", borderRadius: "20px 20px 0 0", maxHeight: "90vh", overflowY: "auto" }}>
        <h3>{initial ? "Varlığı Düzenle" : "Yeni Varlık"}</h3>
        <label style={{ display: "block", marginTop: "10px", fontSize: "12px", color: "#94a3b8" }}>Tür</label>
        <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px" }}>
          <option value="BIST">BIST Hisse</option>
          <option value="DOVIZ">Döviz</option>
          <option value="ALTIN">Altın/Gümüş</option>
          <option value="FON">Fon</option>
        </select>

        <label style={{ display: "block", marginTop: "10px", fontSize: "12px", color: "#94a3b8" }}>Sembol (Örn: THYAO veya USD)</label>
        <input value={form.symbol} onChange={e => setForm({...form, symbol: e.target.value.toUpperCase()})} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px" }} />

        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12px", color: "#94a3b8" }}>Miktar</label>
            <input type="number" value={form.qty} onChange={e => setForm({...form, qty: e.target.value})} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12px", color: "#94a3b8" }}>Alış Fiyatı</label>
            <input type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px" }} />
          </div>
        </div>

        <button onClick={() => onSave(form)} style={{ width: "100%", padding: "12px", background: "#3b82f6", color: "white", border: "none", borderRadius: "8px", marginTop: "20px", fontWeight: "bold" }}>Kaydet</button>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", background: "none", color: "#94a3b8", border: "none", marginTop: "10px" }}>Kapat</button>
      </div>
    </div>
  );
}

function SellModal({ asset, onSell, onClose }) {
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const maxQty = asset.lots.reduce((sum, l) => sum + l.remaining, 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 1000 }}>
      <div style={{ background: "#0f172a", width: "100%", padding: "20px", borderRadius: "20px 20px 0 0" }}>
        <h3>{asset.symbol} Satışı</h3>
        <p style={{ fontSize: "12px", color: "#94a3b8" }}>Maksimum Satılabilir: {maxQty}</p>
        
        <input type="number" placeholder="Satış Miktarı" value={qty} onChange={e => setQty(e.target.value)} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px", marginTop: "10px" }} />
        <input type="number" placeholder="Satış Fiyatı" value={price} onChange={e => setPrice(e.target.value)} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px", marginTop: "10px" }} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", padding: "10px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "8px", marginTop: "10px" }} />

        <button onClick={() => onSell(asset, qty, price, date)} style={{ width: "100%", padding: "12px", background: "#22c55e", color: "white", border: "none", borderRadius: "8px", marginTop: "20px", fontWeight: "bold" }}>Satışı Onayla (FIFO)</button>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", background: "none", color: "#94a3b8", border: "none", marginTop: "10px" }}>Vazgeç</button>
      </div>
    </div>
  );
}
