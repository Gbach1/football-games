import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://pppqqsqrlagleibijocb.supabase.co";
const SUPABASE_KEY = "sb_publishable_6FGM6dVyYJL8S-v_lJ-XSg_a8RZbvPV";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Supabase Realtime via WebSocket
function createRealtimeChannel(roomId, onPayload) {
  const wsUrl = SUPABASE_URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + SUPABASE_KEY + "&vsn=1.0.0";
  const ws = new WebSocket(wsUrl);
  let heartbeat;

  ws.onopen = () => {
    ws.send(JSON.stringify({ topic: "realtime:public:game_state:room_id=eq." + roomId, event: "phx_join", payload: {}, ref: "1" }));
    heartbeat = setInterval(() => ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" })), 20000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === "INSERT" || msg.event === "UPDATE") onPayload(msg.payload?.record || msg.payload?.new);
  };
  ws.onerror = () => {};
  return { close: () => { clearInterval(heartbeat); ws.close(); } };
}

// ═══════════════════════════════════════════════════════════════════
// SHARED DATA — loaded dynamically from Supabase
// ═══════════════════════════════════════════════════════════════════
let PLAYERS_DB = [];

async function loadPlayers() {
  if (PLAYERS_DB.length > 0) return PLAYERS_DB;
  try {
    // Load all players in pages of 1000
    let allPlayers = [];
    let page = 0;
    while (true) {
      const rows = await sbFetch(`players?select=*&limit=1000&offset=${page * 1000}`);
      if (!rows || rows.length === 0) break;
      allPlayers = allPlayers.concat(rows.map(p => ({
        name: p.name,
        clubs: p.clubs || [],
        league: p.league || [],
        position: p.position || [],
        country: p.country || "",
        trophies: p.trophies || [],
        photo: p.photo || null,
      })));
      if (rows.length < 1000) break;
      page++;
    }
    PLAYERS_DB = allPlayers;
    return PLAYERS_DB;
  } catch (e) {
    console.error("Kunne ikke hente spillere:", e);
    return [];
  }
}

const CATEGORIES = [
  { id: "pl", label: "Premier League", emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", check: (p) => p.league.includes("Premier League") },
  { id: "laliga", label: "LaLiga", emoji: "🇪🇸", check: (p) => p.league.includes("LaLiga") },
  { id: "bundesliga", label: "Bundesliga", emoji: "🇩🇪", check: (p) => p.league.includes("Bundesliga") },
  { id: "serie_a", label: "Serie A", emoji: "🇮🇹", check: (p) => p.league.includes("Serie A") },
  { id: "ligue1", label: "Ligue 1", emoji: "🇫🇷", check: (p) => p.league.includes("Ligue 1") },
  { id: "ucl", label: "UCL vinder", emoji: "🏆", check: (p) => p.trophies.includes("Champions League") },
  { id: "wc", label: "VM vinder", emoji: "🌍", check: (p) => p.trophies.includes("World Cup") },
  { id: "ballon", label: "Ballon d'Or", emoji: "🥇", check: (p) => p.trophies.includes("Ballon d'Or") },
  { id: "real", label: "Real Madrid", emoji: "⚪", check: (p) => p.clubs.includes("Real Madrid") },
  { id: "barca", label: "Barcelona", emoji: "🔵", check: (p) => p.clubs.includes("Barcelona") },
  { id: "manu", label: "Man. United", emoji: "🔴", check: (p) => p.clubs.includes("Manchester United") },
  { id: "mcity", label: "Man. City", emoji: "🩵", check: (p) => p.clubs.includes("Manchester City") },
  { id: "liverpool", label: "Liverpool", emoji: "❤️", check: (p) => p.clubs.includes("Liverpool") },
  { id: "juventus", label: "Juventus", emoji: "⚫", check: (p) => p.clubs.includes("Juventus") },
  { id: "bayern", label: "Bayern Munich", emoji: "🟥", check: (p) => p.clubs.includes("Bayern Munich") },
  { id: "dortmund", label: "Dortmund", emoji: "🟡", check: (p) => p.clubs.includes("Dortmund") },
  { id: "psg", label: "PSG", emoji: "🗼", check: (p) => p.clubs.includes("PSG") },
  { id: "gk", label: "Målmand", emoji: "🧤", check: (p) => p.position.includes("Goalkeeper") },
  { id: "def", label: "Forsvarsspiller", emoji: "🛡️", check: (p) => p.position.includes("Defender") },
  { id: "mid", label: "Midtbanespiller", emoji: "⚙️", check: (p) => p.position.includes("Midfielder") },
  { id: "fwd", label: "Angriber", emoji: "⚡", check: (p) => p.position.includes("Forward") },
];

function normalize(str) { return str.toLowerCase().replace(/[^a-z]/g, ""); }
function randCode() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function PlayerInput({ input, onChange, onSubmit, onCancel, error, suggestions }) {
  return (
    <div style={{ maxWidth: 420, margin: "12px auto 0", position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input autoFocus value={input} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && input) onSubmit(input); if (e.key === "Escape") onCancel(); }}
          placeholder="Spillerens navn..."
          style={{ flex: 1, background: "#0d1b2a", border: "2px solid #10b981", borderRadius: 10, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
        <button onClick={() => onSubmit(input)} style={{ background: "#10b981", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 800, color: "white", fontSize: 15 }}>✓</button>
        <button onClick={onCancel} style={{ background: "#1a2535", border: "none", borderRadius: 10, padding: "10px 12px", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>✕</button>
      </div>
      {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 5, paddingLeft: 4 }}>{error}</div>}
      {suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 44, background: "#0d1b2a", border: "1px solid #1e3045", borderRadius: 10, marginTop: 4, overflow: "hidden", zIndex: 30 }}>
          {suggestions.map(p => (
            <div key={p.name} onClick={() => onSubmit(p.name)}
              style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #0a1525" }}
              onMouseEnter={e => e.currentTarget.style.background = "#1a2535"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              {p.name} <span style={{ color: "#475569", fontSize: 11, marginLeft: 6 }}>{p.clubs.slice(-1)[0]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOBBY — opret/join rum
// ═══════════════════════════════════════════════════════════════════
function Lobby({ game, onJoined, onBack }) {
  const [mode, setMode] = useState(null); // "create" | "join"
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [playerNo, setPlayerNo] = useState(null);

  const gameLabel = game === "ttt" ? "Tiki-Taka-Toe" : "Possession Play";

  const createRoom = async () => {
    setLoading(true); setStatus("Opretter rum...");
    const newCode = randCode();
    try {
      const initialState = game === "ttt"
        ? { board: Array(9).fill(null), currentPlayer: 1, usedPlayers: [], rowCats: pickTTTCategories()[0].map(c=>c.id), colCats: pickTTTCategories()[1].map(c=>c.id), winner: null }
        : { hexes: buildHexGrid().map(h=>({...h, category: h.category.id})), currentPlayer: 1, usedPlayers: [], timers: {1:60,2:60}, gameOver: false };

      await sbFetch("rooms", { method: "POST", body: JSON.stringify({ id: newCode, game, status: "waiting", current_player: 1 }) });
      await sbFetch("game_state", { method: "POST", body: JSON.stringify({ room_id: newCode, state: initialState }) });

      setCode(newCode);
      setPlayerNo(1);
      setStatus("Venter på modstander...");
      setLoading(false);

      // Poll for opponent
      const poll = setInterval(async () => {
        const rows = await sbFetch(`rooms?id=eq.${newCode}&select=status`);
        if (rows?.[0]?.status === "playing") {
          clearInterval(poll);
          onJoined(newCode, 1);
        }
      }, 2000);
    } catch (e) {
      setStatus("Fejl: " + e.message); setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return;
    setLoading(true); setStatus("Finder rum...");
    try {
      const rooms = await sbFetch(`rooms?id=eq.${joinCode.toUpperCase()}&select=*`);
      if (!rooms?.length) { setStatus("Rum ikke fundet!"); setLoading(false); return; }
      if (rooms[0].status !== "waiting") { setStatus("Rummet er allerede fuldt!"); setLoading(false); return; }

      await sbFetch(`rooms?id=eq.${joinCode.toUpperCase()}`, { method: "PATCH", body: JSON.stringify({ status: "playing" }) });
      setPlayerNo(2);
      onJoined(joinCode.toUpperCase(), 2);
    } catch (e) {
      setStatus("Fejl: " + e.message); setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#060d18", color: "#f1f5f9", fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <button onClick={onBack} style={{ position: "absolute", top: 20, left: 20, background: "#0d1b2a", border: "1px solid #1e3045", borderRadius: 8, color: "#64748b", padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>← Menu</button>

      <div style={{ fontSize: 40, marginBottom: 12 }}>{game === "ttt" ? "⚽" : "🔷"}</div>
      <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 900, color: "#f1f5f9" }}>{gameLabel}</h2>
      <p style={{ color: "#475569", margin: "0 0 32px", fontSize: 13 }}>Online multiplayer</p>

      {!mode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}>
          <button onClick={() => { setMode("create"); createRoom(); }}
            style={{ background: "#0a1628", border: "2px solid #3b82f6", borderRadius: 14, padding: "18px 24px", cursor: "pointer", color: "#f1f5f9", fontSize: 16, fontWeight: 800 }}>
            🎮 Opret nyt rum
          </button>
          <button onClick={() => setMode("join")}
            style={{ background: "#071a12", border: "2px solid #10b981", borderRadius: 14, padding: "18px 24px", cursor: "pointer", color: "#f1f5f9", fontSize: 16, fontWeight: 800 }}>
            🔗 Tilslut med kode
          </button>
        </div>
      )}

      {mode === "create" && (
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          {code && (
            <>
              <p style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>Del denne kode med din ven:</p>
              <div style={{ background: "#0d1b2a", border: "2px solid #3b82f6", borderRadius: 16, padding: "20px 32px", marginBottom: 16 }}>
                <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: 8, color: "#3b82f6" }}>{code}</div>
              </div>
            </>
          )}
          <div style={{ color: "#475569", fontSize: 13 }}>{status}</div>
          {loading && !code && <div style={{ color: "#475569", fontSize: 13 }}>{status}</div>}
        </div>
      )}

      {mode === "join" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}>
          <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Indtast rumkode..."
            maxLength={5}
            style={{ background: "#0d1b2a", border: "2px solid #10b981", borderRadius: 10, padding: "12px 16px", color: "#f1f5f9", fontSize: 20, fontWeight: 800, letterSpacing: 6, textAlign: "center", outline: "none" }} />
          <button onClick={joinRoom} disabled={loading}
            style={{ background: "#10b981", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", color: "white", fontWeight: 800, fontSize: 15 }}>
            {loading ? "Finder..." : "Tilslut →"}
          </button>
          {status && <div style={{ color: status.includes("Fejl") || status.includes("ikke") ? "#ef4444" : "#64748b", fontSize: 13, textAlign: "center" }}>{status}</div>}
          <button onClick={() => { setMode(null); setStatus(""); }} style={{ background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: 13 }}>← Tilbage</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TIKI-TAKA-TOE CATEGORIES HELPER
// ═══════════════════════════════════════════════════════════════════
function pickTTTCategories() {
  const shuffled = [...CATEGORIES].sort(() => Math.random() - 0.5);
  return [shuffled.slice(0, 3), shuffled.slice(3, 6)];
}
function catById(id) { return CATEGORIES.find(c => c.id === id); }
function playerMatchesCell(player, rowCat, colCat) { return rowCat.check(player) && colCat.check(player); }

// ═══════════════════════════════════════════════════════════════════
// TIKI-TAKA-TOE (ONLINE)
// ═══════════════════════════════════════════════════════════════════
function TikiTakaToeOnline({ roomId, playerNo, onBack }) {
  const [gameState, setGameState] = useState(null);
  const [activeCell, setActiveCell] = useState(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const channelRef = useRef(null);

  const loadState = async () => {
    const rows = await sbFetch(`game_state?room_id=eq.${roomId}&order=id.desc&limit=1`);
    if (rows?.[0]) setGameState(rows[0].state);
  };

  useEffect(() => {
    loadState();
    channelRef.current = createRealtimeChannel(roomId, (record) => {
      if (record?.state) setGameState(record.state);
    });
    return () => channelRef.current?.close();
  }, [roomId]);

  const saveState = async (newState) => {
    await sbFetch("game_state", { method: "POST", body: JSON.stringify({ room_id: roomId, state: newState }) });
    setGameState(newState);
  };

  if (!gameState) return <div style={{ minHeight:"100vh", background:"#060d18", display:"flex", alignItems:"center", justifyContent:"center", color:"#475569", fontFamily:"Inter,sans-serif" }}>Forbinder...</div>;

  const { board, currentPlayer, usedPlayers, rowCats: rowCatIds, colCats: colCatIds, winner } = gameState;
  const rowCats = rowCatIds.map(catById).filter(Boolean);
  const colCats = colCatIds.map(catById).filter(Boolean);
  const isMyTurn = currentPlayer === playerNo;

  const WINNING_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  function checkWinner(b) {
    for (const [a,c,d] of WINNING_LINES) if (b[a]&&b[c]&&b[d]&&b[a].owner===b[c].owner&&b[c].owner===b[d].owner) return b[a].owner;
    if (b.every(Boolean)) return "draw";
    return null;
  }

  const handleCellClick = (idx) => {
    if (!isMyTurn || winner || board[idx]) return;
    setActiveCell(idx); setInput(""); setError(""); setSuggestions([]);
  };

  const handleInputChange = (val) => {
    setInput(val); setError("");
    if (val.length < 2) { setSuggestions([]); return; }
    setSuggestions(PLAYERS_DB.filter(p => p.name.toLowerCase().includes(val.toLowerCase()) && !usedPlayers.includes(p.name)).slice(0, 5));
  };

  const handleGuess = async (playerName) => {
    if (activeCell === null || !isMyTurn) return;
    const found = PLAYERS_DB.find(p => normalize(p.name) === normalize(playerName));
    if (!found) { setError("Spilleren findes ikke"); return; }
    if (usedPlayers.includes(found.name)) { setError("Allerede brugt!"); return; }
    if (!playerMatchesCell(found, rowCats[Math.floor(activeCell/3)], colCats[activeCell%3])) { setError(`${found.name} passer ikke her`); return; }

    const newBoard = [...board];
    newBoard[activeCell] = { name: found.name, owner: currentPlayer };
    const w = checkWinner(newBoard);
    const newState = { ...gameState, board: newBoard, usedPlayers: [...usedPlayers, found.name], currentPlayer: currentPlayer===1?2:1, winner: w };
    setActiveCell(null); setInput(""); setSuggestions([]); setError("");
    await saveState(newState);
  };

  const resetGame = async () => {
    const [rc, cc] = pickTTTCategories();
    await saveState({ board: Array(9).fill(null), currentPlayer: 1, usedPlayers: [], rowCats: rc.map(c=>c.id), colCats: cc.map(c=>c.id), winner: null });
  };

  const p1="#3b82f6", p2="#ef4444";
  const myColor = playerNo===1?p1:p2;

  return (
    <div style={{ minHeight:"100vh", background:"#060d18", color:"#f1f5f9", fontFamily:"'Inter',sans-serif", padding:"16px", boxSizing:"border-box" }}>
      <div style={{ display:"flex", alignItems:"center", marginBottom:14 }}>
        <button onClick={onBack} style={{ background:"#0d1b2a", border:"1px solid #1e3045", borderRadius:8, color:"#64748b", padding:"6px 12px", cursor:"pointer", fontSize:13 }}>← Menu</button>
        <h2 style={{ flex:1, textAlign:"center", margin:0, fontSize:17, fontWeight:800, color:"#3b82f6" }}>⚽ Tiki-Taka-Toe</h2>
        <div style={{ fontSize:11, color: myColor, fontWeight:700, background:"#0d1b2a", border:`1px solid ${myColor}`, borderRadius:8, padding:"4px 10px" }}>Du er {playerNo===1?"🔵":"🔴"}</div>
      </div>

      <div style={{ textAlign:"center", marginBottom:12 }}>
        {winner ? (
          <div style={{ background: winner==="draw"?"#0d1b2a":(winner===playerNo?"#071a12":"#1a0808"), border:`2px solid ${winner==="draw"?"#475569":winner===playerNo?"#10b981":"#ef4444"}`, borderRadius:14, padding:"12px 20px", maxWidth:360, margin:"0 auto 12px", display:"inline-block" }}>
            <div style={{ fontSize:20, fontWeight:900, color: winner==="draw"?"#94a3b8":winner===playerNo?"#10b981":"#ef4444" }}>
              {winner==="draw"?"🤝 Uafgjort!":winner===playerNo?"🏆 Du vinder!":"😔 Du tabte!"}
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center", marginTop:10 }}>
              <button onClick={resetGame} style={{ background:"#3b82f6", border:"none", borderRadius:8, color:"white", fontWeight:800, padding:"7px 18px", cursor:"pointer", fontSize:13 }}>Igen</button>
              <button onClick={onBack} style={{ background:"#0d1b2a", border:"1px solid #1e3045", borderRadius:8, color:"#94a3b8", padding:"7px 18px", cursor:"pointer", fontSize:13 }}>Menu</button>
            </div>
          </div>
        ) : (
          <span style={{ background: isMyTurn?"#071a12":"#0d1b2a", border:`1px solid ${isMyTurn?"#10b981":"#1e3045"}`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:600, color: isMyTurn?"#10b981":"#475569" }}>
            {isMyTurn ? (activeCell!==null?"Skriv et navn":"Din tur — vælg et felt") : "Venter på modstanderen..."}
          </span>
        )}
      </div>

      <div style={{ maxWidth:500, margin:"0 auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"90px 1fr 1fr 1fr", gap:4, marginBottom:4 }}>
          <div />
          {colCats.map(c => <div key={c.id} style={{ background:"#0d1b2a", borderRadius:8, padding:"7px 4px", textAlign:"center", fontSize:10, fontWeight:700, color:"#10b981", lineHeight:1.4 }}>{c.emoji} {c.label}</div>)}
        </div>
        {rowCats.map((rowCat, ri) => (
          <div key={rowCat.id} style={{ display:"grid", gridTemplateColumns:"90px 1fr 1fr 1fr", gap:4, marginBottom:4 }}>
            <div style={{ background:"#0d1b2a", borderRadius:8, padding:"7px 6px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#f59e0b", lineHeight:1.4, textAlign:"center" }}>{rowCat.emoji} {rowCat.label}</div>
            {colCats.map((colCat, ci) => {
              const idx=ri*3+ci, cell=board[idx], isActive=activeCell===idx;
              const validCount = PLAYERS_DB.filter(p=>playerMatchesCell(p,rowCat,colCat)).length;
              return (
                <div key={ci} onClick={()=>handleCellClick(idx)} style={{ background:cell?(cell.owner===1?"#0a1628":"#1a0808"):"#0d1b2a", border:`2px solid ${cell?(cell.owner===1?p1:p2):isActive?"#10b981":"#1e3045"}`, borderRadius:10, minHeight:70, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:cell||winner||!isMyTurn?"default":"pointer", transition:"all 0.15s", padding:6, textAlign:"center" }}>
                  {cell?(<><div style={{fontSize:16}}>{cell.owner===1?"🔵":"🔴"}</div><div style={{fontSize:9,color:"#94a3b8",marginTop:3,lineHeight:1.3}}>{cell.name}</div></>):(<div style={{fontSize:9,color:"#334155"}}>{validCount} mulige</div>)}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {activeCell!==null && !winner && isMyTurn && (
        <PlayerInput input={input} onChange={handleInputChange} onSubmit={handleGuess} onCancel={()=>{setActiveCell(null);setInput("");setError("");setSuggestions([]);}} error={error} suggestions={suggestions} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// POSSESSION PLAY (ONLINE)
// ═══════════════════════════════════════════════════════════════════
const HEX_ROWS = [3,4,5,6,5,4,3,1];

function buildHexGrid() {
  const shuffled=[...CATEGORIES].sort(()=>Math.random()-0.5);
  let catIdx=0,id=0;
  const hexes=[];
  HEX_ROWS.forEach((count,rowIdx)=>{
    for(let col=0;col<count;col++) hexes.push({id:id++,row:rowIdx,col,category:shuffled[catIdx++%shuffled.length].id,owner:null});
  });
  return hexes;
}

function getNeighborIds(hexes,hexId){
  const hex=hexes.find(h=>h.id===hexId); if(!hex) return [];
  const{row,col}=hex,rowCount=HEX_ROWS[row],prevCount=row>0?HEX_ROWS[row-1]:0,nextCount=row<HEX_ROWS.length-1?HEX_ROWS[row+1]:0;
  const n=[];
  if(col>0) n.push({row,col:col-1}); if(col<rowCount-1) n.push({row,col:col+1});
  const isWider=rowCount>prevCount,isNarrower=rowCount<prevCount;
  if(row>0){if(isWider){if(col-1>=0&&col-1<prevCount)n.push({row:row-1,col:col-1});if(col<prevCount)n.push({row:row-1,col});}else if(isNarrower){if(col<prevCount)n.push({row:row-1,col});if(col+1<prevCount)n.push({row:row-1,col:col+1});}else{if(col<prevCount)n.push({row:row-1,col});if(col-1>=0)n.push({row:row-1,col:col-1});}}
  if(row<HEX_ROWS.length-1){const bW=nextCount>rowCount,bN=nextCount<rowCount;if(bW){if(col<nextCount)n.push({row:row+1,col});if(col+1<nextCount)n.push({row:row+1,col:col+1});}else if(bN){if(col-1>=0&&col-1<nextCount)n.push({row:row+1,col:col-1});if(col<nextCount)n.push({row:row+1,col});}else{if(col<nextCount)n.push({row:row+1,col});if(col+1<nextCount)n.push({row:row+1,col:col+1});}}
  return n.map(({row:r,col:c})=>hexes.find(h=>h.row===r&&h.col===c)).filter(Boolean).map(h=>h.id);
}

const TURN_TIME=60;

function PossessionPlayOnline({roomId,playerNo,onBack}){
  const[gameState,setGameState]=useState(null);
  const[activeHex,setActiveHex]=useState(null);
  const[input,setInput]=useState("");
  const[suggestions,setSuggestions]=useState([]);
  const[error,setError]=useState("");
  const[flash,setFlash]=useState(null);
  const channelRef=useRef(null);
  const timerRef=useRef(null);

  const loadState=async()=>{
    const rows=await sbFetch(`game_state?room_id=eq.${roomId}&order=id.desc&limit=1`);
    if(rows?.[0]) setGameState(rows[0].state);
  };

  useEffect(()=>{
    loadState();
    channelRef.current=createRealtimeChannel(roomId,(record)=>{ if(record?.state) setGameState(record.state); });
    return()=>channelRef.current?.close();
  },[roomId]);

  useEffect(()=>{
    if(!gameState||gameState.gameOver) return;
    clearInterval(timerRef.current);
    if(gameState.currentPlayer!==playerNo) return;
    timerRef.current=setInterval(async()=>{
      setGameState(prev=>{
        if(!prev) return prev;
        const newTimers={...prev.timers,[prev.currentPlayer]:prev.timers[prev.currentPlayer]-1};
        if(newTimers[prev.currentPlayer]<=0){
          const ns={...prev,timers:newTimers,gameOver:true};
          sbFetch("game_state",{method:"POST",body:JSON.stringify({room_id:roomId,state:ns})});
          return ns;
        }
        return{...prev,timers:newTimers};
      });
    },1000);
    return()=>clearInterval(timerRef.current);
  },[gameState?.currentPlayer,gameState?.gameOver]);

  const saveState=async(newState)=>{
    await sbFetch("game_state",{method:"POST",body:JSON.stringify({room_id:roomId,state:newState})});
    setGameState(newState);
  };

  if(!gameState) return <div style={{minHeight:"100vh",background:"#060d18",display:"flex",alignItems:"center",justifyContent:"center",color:"#475569",fontFamily:"Inter,sans-serif"}}>Forbinder...</div>;

  const{hexes,currentPlayer,usedPlayers,timers,gameOver}=gameState;
  const isMyTurn=currentPlayer===playerNo&&!gameOver;
  const scores={1:hexes.filter(h=>h.owner===1).length,2:hexes.filter(h=>h.owner===2).length};
  const winner=gameOver?(scores[1]>scores[2]?1:scores[2]>scores[1]?2:"draw"):null;

  const handleHexClick=(hex)=>{
    if(!isMyTurn||hex.owner!==null) return;
    setActiveHex(hex.id);setInput("");setError("");setSuggestions([]);
  };

  const handleInputChange=(val)=>{
    setInput(val);setError("");
    if(val.length<2){setSuggestions([]);return;}
    setSuggestions(PLAYERS_DB.filter(p=>p.name.toLowerCase().includes(val.toLowerCase())&&!usedPlayers.includes(p.name)).slice(0,5));
  };

  const handleGuess=async(playerName)=>{
    if(activeHex===null||!isMyTurn) return;
    const hex=hexes.find(h=>h.id===activeHex);
    const cat=catById(hex.category);
    const found=PLAYERS_DB.find(p=>normalize(p.name)===normalize(playerName));
    if(!found){setError("Spilleren findes ikke");return;}
    if(usedPlayers.includes(found.name)){setError("Allerede brugt!");return;}
    if(!cat.check(found)){setError(`${found.name} passer ikke til "${cat.label}"`);return;}

    const neighborIds=getNeighborIds(hexes,activeHex);
    const claimedIds=[activeHex];
    const newHexes=hexes.map(h=>{
      if(h.id===activeHex) return{...h,owner:currentPlayer};
      if(neighborIds.includes(h.id)&&catById(h.category).check(found)){claimedIds.push(h.id);return{...h,owner:currentPlayer};}
      return h;
    });

    setFlash({hexIds:claimedIds,owner:currentPlayer});
    setTimeout(()=>setFlash(null),800);
    setActiveHex(null);setInput("");setSuggestions([]);setError("");

    const allDone=newHexes.every(h=>h.owner!==null);
    const newState={...gameState,hexes:newHexes,usedPlayers:[...usedPlayers,found.name],currentPlayer:currentPlayer===1?2:1,gameOver:allDone};
    await saveState(newState);
  };

  const resetGame=async()=>{
    await saveState({hexes:buildHexGrid().map(h=>({...h,category:h.category})),currentPlayer:1,usedPlayers:[],timers:{1:TURN_TIME,2:TURN_TIME},gameOver:false});
    setActiveHex(null);setInput("");setError("");setSuggestions([]);
  };

  const HEX_R=34,HEX_W=HEX_R*Math.sqrt(3),V_GAP=HEX_R*2*0.75;
  const maxW=Math.max(...HEX_ROWS)*(HEX_W+2);
  const svgH=HEX_ROWS.length*V_GAP+HEX_R*2;

  function hexCenter(row,col){
    const rw=HEX_ROWS[row]*HEX_W+(HEX_ROWS[row]-1)*2,mw=Math.max(...HEX_ROWS)*HEX_W+(Math.max(...HEX_ROWS)-1)*2;
    return{x:(mw-rw)/2+col*(HEX_W+2)+HEX_W/2+8,y:row*V_GAP+HEX_R+4};
  }
  function hexPoints(cx,cy){return Array.from({length:6},(_,i)=>{const a=(Math.PI/3)*i-Math.PI/6;return`${cx+HEX_R*Math.cos(a)},${cy+HEX_R*Math.sin(a)}`;}).join(" ");}
  function getHexFill(hex){
    if(flash?.hexIds.includes(hex.id)) return flash.owner===1?"#60a5fa":"#f87171";
    if(hex.id===activeHex) return"#0a2518";
    if(hex.owner===1) return"#0a1628";
    if(hex.owner===2) return"#1a0808";
    return"#0d1b2a";
  }
  function getHexStroke(hex){
    if(hex.id===activeHex) return"#10b981";
    if(hex.owner===1) return"#3b82f6";
    if(hex.owner===2) return"#ef4444";
    return"#1e3045";
  }

  const p1="#3b82f6",p2="#ef4444";
  const myColor=playerNo===1?p1:p2;
  const pct1=timers[1]/TURN_TIME,pct2=timers[2]/TURN_TIME;

  return(
    <div style={{minHeight:"100vh",background:"#060d18",color:"#f1f5f9",fontFamily:"'Inter',sans-serif",padding:"16px",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
        <button onClick={onBack} style={{background:"#0d1b2a",border:"1px solid #1e3045",borderRadius:8,color:"#64748b",padding:"6px 12px",cursor:"pointer",fontSize:13}}>← Menu</button>
        <h2 style={{flex:1,textAlign:"center",margin:0,fontSize:17,fontWeight:800,color:"#10b981"}}>🔷 Possession Play</h2>
        <div style={{fontSize:11,color:myColor,fontWeight:700,background:"#0d1b2a",border:`1px solid ${myColor}`,borderRadius:8,padding:"4px 10px"}}>Du er {playerNo===1?"🔵":"🔴"}</div>
      </div>

      <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:10,maxWidth:420,margin:"0 auto 10px"}}>
        {[1,2].map(p=>{
          const isActive=currentPlayer===p&&!gameOver,col=p===1?p1:p2,pct=p===1?pct1:pct2;
          return(<div key={p} style={{flex:1,background:isActive?(p===1?"#0a1628":"#1a0808"):"#0d1b2a",border:`2px solid ${isActive?col:"#1e3045"}`,borderRadius:12,padding:"8px 12px",transition:"all 0.2s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:10,color:"#475569",fontWeight:700}}>{p===playerNo?"DIG":"MODST."}</span>
              <span style={{fontSize:16,fontWeight:800,color:col}}>{scores[p]}</span>
            </div>
            <div style={{height:3,background:"#0a1220",borderRadius:4,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct*100}%`,background:pct>0.4?col:pct>0.2?"#f59e0b":"#ef4444",borderRadius:4,transition:"width 1s linear"}}/>
            </div>
            <div style={{textAlign:"right",fontSize:10,color:pct>0.2?"#475569":"#ef4444",marginTop:2,fontWeight:600}}>{timers[p]}s</div>
          </div>);
        })}
      </div>

      {!gameOver&&(
        <div style={{textAlign:"center",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:600,color:isMyTurn?"#10b981":"#475569",background:isMyTurn?"#071a12":"#0d1b2a",border:`1px solid ${isMyTurn?"#10b981":"#1e3045"}`,borderRadius:20,padding:"3px 12px"}}>
            {isMyTurn?(activeHex!==null?`Skriv spiller til "${catById(hexes.find(h=>h.id===activeHex)?.category)?.label}"`:"Din tur — tryk på en grå hex"):"Venter på modstanderen..."}
          </span>
        </div>
      )}

      {gameOver&&(
        <div style={{textAlign:"center",margin:"0 auto 10px",maxWidth:360,background:winner==="draw"?"#0d1b2a":(winner===playerNo?"#071a12":"#1a0808"),border:`2px solid ${winner==="draw"?"#475569":winner===playerNo?"#10b981":"#ef4444"}`,borderRadius:16,padding:"14px 20px"}}>
          <div style={{fontSize:22,fontWeight:900,color:winner==="draw"?"#94a3b8":winner===playerNo?"#10b981":"#ef4444"}}>
            {winner==="draw"?"🤝 Uafgjort!":winner===playerNo?"🏆 Du vinder!":"😔 Du tabte!"}
          </div>
          <div style={{fontSize:13,color:"#475569",marginTop:4}}>{scores[1]} – {scores[2]} hexes</div>
          <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:10}}>
            <button onClick={resetGame} style={{background:"#10b981",border:"none",borderRadius:8,color:"white",fontWeight:800,padding:"7px 18px",cursor:"pointer",fontSize:13}}>Igen</button>
            <button onClick={onBack} style={{background:"#0d1b2a",border:"1px solid #1e3045",borderRadius:8,color:"#94a3b8",padding:"7px 18px",cursor:"pointer",fontSize:13}}>Menu</button>
          </div>
        </div>
      )}

      <div style={{overflowX:"auto",textAlign:"center"}}>
        <svg width={maxW+16} height={svgH+8} style={{display:"inline-block"}}>
          {hexes.map(hex=>{
            const{x,y}=hexCenter(hex.row,hex.col);
            const cat=catById(hex.category);
            return(<g key={hex.id} onClick={()=>handleHexClick(hex)} style={{cursor:hex.owner!==null||gameOver||!isMyTurn?"default":"pointer"}}>
              <polygon points={hexPoints(x,y)} fill={getHexFill(hex)} stroke={getHexStroke(hex)} strokeWidth={hex.id===activeHex?2.5:1.5} style={{transition:"fill 0.25s"}}/>
              {hex.owner&&<circle cx={x} cy={y-9} r={4.5} fill={hex.owner===1?p1:p2}/>}
              <text x={x} y={y+(hex.owner?3:-2)} textAnchor="middle" fontSize={hex.owner?11:13} fill="#e2e8f0">{cat?.emoji}</text>
              <text x={x} y={y+(hex.owner?15:11)} textAnchor="middle" fontSize={7} fill={hex.owner?"#334155":"#64748b"} fontWeight="600">
                {cat?.label.length>10?cat.label.slice(0,9)+"…":cat?.label}
              </text>
            </g>);
          })}
        </svg>
      </div>

      {activeHex!==null&&!gameOver&&isMyTurn&&(
        <PlayerInput input={input} onChange={handleInputChange} onSubmit={handleGuess} onCancel={()=>{setActiveHex(null);setInput("");setError("");setSuggestions([]);}} error={error} suggestions={suggestions}/>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════════
function HomeScreen({onSelect, playerCount}){
  const games=[
    {id:"ttt",title:"Tiki-Taka-Toe",emoji:"⚽",desc:"Fodbold Tic Tac Toe — gæt spillere der passer i 3×3 gitteret",color:"#3b82f6",bg:"#0a1628",border:"#1d4ed8"},
    {id:"pp",title:"Possession Play",emoji:"🔷",desc:"Hexagonkamp — navngiv spillere, styr territoriet, stjæl nabofelter",color:"#10b981",bg:"#071a12",border:"#059669"},
  ];
  return(
    <div style={{minHeight:"100vh",background:"#060d18",color:"#f1f5f9",fontFamily:"'Inter',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 16px",boxSizing:"border-box"}}>
      <div style={{textAlign:"center",marginBottom:44}}>
        <div style={{fontSize:52,marginBottom:8}}>⚽</div>
        <h1 style={{fontSize:30,fontWeight:900,margin:0,letterSpacing:"-1px",color:"#f1f5f9"}}>Football Games</h1>
        <p style={{color:"#1e3a5f",margin:"8px 0 0",fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:700}}>Online multiplayer</p>
        {playerCount>0&&<p style={{color:"#10b981",margin:"6px 0 0",fontSize:12,fontWeight:600}}>⚽ {playerCount} spillere i databasen</p>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14,width:"100%",maxWidth:460}}>
        {games.map(g=>(
          <button key={g.id} onClick={()=>onSelect(g.id)}
            style={{background:g.bg,border:`2px solid ${g.border}`,borderRadius:18,padding:"20px 24px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:18,transition:"transform 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 32px ${g.color}25`;}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
            <div style={{fontSize:34,flexShrink:0}}>{g.emoji}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:800,color:g.color,marginBottom:4}}>{g.title}</div>
              <div style={{fontSize:12,color:"#334155",lineHeight:1.5}}>{g.desc}</div>
            </div>
            <div style={{color:"#1e3045",fontSize:20,flexShrink:0}}>›</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════
export default function App(){
  const[screen,setScreen]=useState("home");
  const[roomId,setRoomId]=useState(null);
  const[playerNo,setPlayerNo]=useState(null);
  const[playersLoaded,setPlayersLoaded]=useState(false);
  const[playerCount,setPlayerCount]=useState(0);

  useEffect(()=>{
    loadPlayers().then(players=>{
      setPlayerCount(players.length);
      setPlayersLoaded(true);
    });
  },[]);

  if(!playersLoaded) return(
    <div style={{minHeight:"100vh",background:"#060d18",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#f1f5f9",fontFamily:"'Inter',sans-serif",gap:16}}>
      <div style={{fontSize:48}}>⚽</div>
      <div style={{fontSize:18,fontWeight:700}}>Football Games</div>
      <div style={{color:"#475569",fontSize:13}}>Henter spillerdatabase...</div>
      <div style={{width:200,height:3,background:"#1e3045",borderRadius:4,overflow:"hidden",marginTop:8}}>
        <div style={{width:"60%",height:"100%",background:"#3b82f6",borderRadius:4,animation:"pulse 1.5s ease-in-out infinite"}}/>
      </div>
    </div>
  );

  const handleJoined=(game)=>(room,pNo)=>{
    setRoomId(room); setPlayerNo(pNo); setScreen(`play-${game}`);
  };

  if(screen==="lobby-ttt") return <Lobby game="ttt" onJoined={handleJoined("ttt")} onBack={()=>setScreen("home")}/>;
  if(screen==="lobby-pp")  return <Lobby game="pp"  onJoined={handleJoined("pp")}  onBack={()=>setScreen("home")}/>;
  if(screen==="play-ttt")  return <TikiTakaToeOnline  roomId={roomId} playerNo={playerNo} onBack={()=>setScreen("home")}/>;
  if(screen==="play-pp")   return <PossessionPlayOnline roomId={roomId} playerNo={playerNo} onBack={()=>setScreen("home")}/>;

  return <HomeScreen onSelect={g=>setScreen(`lobby-${g}`)} playerCount={playerCount}/>;
}
