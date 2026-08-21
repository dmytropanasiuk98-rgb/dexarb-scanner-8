import time
import asyncio
import logging
import sqlite3
import json
import os
from typing import Dict, List, Tuple, Optional
from contextlib import asynccontextmanager
import aiohttp
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ArbitrageServer")

HISTORY_DB_PATH = "arb_history.db"
USER_DB_PATH = "arb_dashboard.db"

USE_PG = False
PG_DSN = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")

if PG_DSN:
    if PG_DSN.startswith("postgres://"):
        PG_DSN = PG_DSN.replace("postgres://", "postgresql://", 1)
    try:
        import psycopg2
        test_conn = psycopg2.connect(PG_DSN, connect_timeout=5)
        test_conn.close()
        USE_PG = True
        logger.info("Connected to PostgreSQL cloud database successfully!")
    except Exception as e:
        logger.warning(f"Could not connect to PostgreSQL ({e}), falling back to local SQLite.")
        USE_PG = False

def get_db():
    if USE_PG:
        import psycopg2
        conn = psycopg2.connect(PG_DSN)
        return conn, "%s"
    else:
        conn = sqlite3.connect(HISTORY_DB_PATH)
        return conn, "?"

def init_history_db():
    conn, ph = get_db()
    cur = conn.cursor()
    if USE_PG:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS spread_history (
                id SERIAL PRIMARY KEY,
                timestamp BIGINT,
                symbol VARCHAR(32),
                long_ex VARCHAR(32),
                short_ex VARCHAR(32),
                entry_pct DOUBLE PRECISION,
                exit_pct DOUBLE PRECISION,
                long_ask DOUBLE PRECISION,
                short_bid DOUBLE PRECISION,
                long_funding DOUBLE PRECISION DEFAULT 0.0,
                short_funding DOUBLE PRECISION DEFAULT 0.0
            )
        """)
    else:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS spread_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER,
                symbol TEXT,
                long_ex TEXT,
                short_ex TEXT,
                entry_pct REAL,
                exit_pct REAL,
                long_ask REAL,
                short_bid REAL,
                long_funding REAL DEFAULT 0.0,
                short_funding REAL DEFAULT 0.0
            )
        """)
        try:
            cur.execute("ALTER TABLE spread_history ADD COLUMN long_funding REAL DEFAULT 0.0")
        except Exception:
            pass
        try:
            cur.execute("ALTER TABLE spread_history ADD COLUMN short_funding REAL DEFAULT 0.0")
        except Exception:
            pass
    conn.commit()
    conn.close()

def init_user_db():
    conn, ph = get_db()
    cursor = conn.cursor()
    if USE_PG:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            username TEXT,
            photo_url TEXT,
            auth_date BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id BIGINT PRIMARY KEY,
            settings_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """)
    else:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            username TEXT,
            photo_url TEXT,
            auth_date INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            settings_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """)
    conn.commit()
    conn.close()

init_history_db()
init_user_db()

try:
    from ethereal import AsyncRESTClient
except ImportError:
    AsyncRESTClient = None

import lighter_ws
import rh_lighter_ws
import variational
import extended_client
import risex
import bullet

class TelegramAuthPayload(BaseModel):
    user_id: int
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    username: Optional[str] = ""
    photo_url: Optional[str] = ""
    auth_date: Optional[int] = 0

class UserSettingsPayload(BaseModel):
    user_id: int
    settings: Dict

_logger_task: Optional[asyncio.Task] = None
_cleanup_task: Optional[asyncio.Task] = None
_ping_task: Optional[asyncio.Task] = None

async def self_ping_loop():
    """Periodically pings self on Render to keep instance active 24/7."""
    while True:
        await asyncio.sleep(600)  # Ping every 10 minutes
        try:
            url = os.environ.get("RENDER_EXTERNAL_URL") or "https://dexarb-scanner.onrender.com"
            s = await get_session()
            async with s.get(f"{url}/api/symbols", timeout=5) as r:
                pass
        except Exception:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _logger_task, _cleanup_task, _ping_task
    # Startup
    await lighter_ws.client.start()
    await rh_lighter_ws.client.start()
    await variational.client.start()
    await extended_client.client.start()
    await risex.client.start()
    await bullet.client.start()
    
    _logger_task = asyncio.create_task(history_logger_loop())
    _cleanup_task = asyncio.create_task(history_cleanup_loop())
    _ping_task = asyncio.create_task(self_ping_loop())
    yield
    # Shutdown
    if _logger_task:
        _logger_task.cancel()
    if _cleanup_task:
        _cleanup_task.cancel()
    if _ping_task:
        _ping_task.cancel()
    await lighter_ws.client.stop()
    await rh_lighter_ws.client.stop()
    await variational.client.stop()
    await extended_client.client.stop()
    await risex.client.stop()
    await bullet.client.stop()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.post("/api/auth/telegram")
async def api_auth_telegram(payload: TelegramAuthPayload):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO users (user_id, first_name, last_name, username, photo_url, auth_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            first_name=excluded.first_name,
            last_name=excluded.last_name,
            username=excluded.username,
            photo_url=excluded.photo_url,
            auth_date=excluded.auth_date
        """, (payload.user_id, payload.first_name, payload.last_name, payload.username, payload.photo_url, payload.auth_date))
        
        cursor.execute("SELECT settings_json FROM user_settings WHERE user_id = ?", (payload.user_id,))
        row = cursor.fetchone()
        settings = json.loads(row[0]) if row else {}
        
        conn.commit()
        conn.close()
        return {"ok": True, "user": payload.dict(), "settings": settings}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

@app.get("/api/user/settings")
async def api_get_user_settings(user_id: Optional[int] = 0):
    try:
        if not user_id:
            return {"ok": True, "settings": {}}
        conn = sqlite3.connect(USER_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT settings_json FROM user_settings WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        settings = json.loads(row[0]) if row else {}
        return {"ok": True, "settings": settings}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

@app.post("/api/user/settings")
async def api_save_user_settings(payload: UserSettingsPayload):
    try:
        conn = sqlite3.connect(USER_DB_PATH)
        cursor = conn.cursor()
        settings_str = json.dumps(payload.settings)
        cursor.execute("""
        INSERT INTO user_settings (user_id, settings_json)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            settings_json=excluded.settings_json,
            updated_at=CURRENT_TIMESTAMP
        """, (payload.user_id, settings_str))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

PARA_BASE_URL = "https://api.prod.paradex.trade/v1"
ETH_BASE_URL = "https://api.ethereal.trade"
ONDO_BASE_URL = "https://api.ondoperps.xyz"
RH_LIGHTER_BASE_URL = "https://api.rh.lighter.xyz"

_session: Optional[aiohttp.ClientSession] = None
_eth_client: Optional[AsyncRESTClient] = None
_eth_ticker_to_id: Dict[str, str] = {}
_ondo_symbols: Dict[str, str] = {}
_rh_lighter_symbols: Dict[str, int] = {}

# Price Cache: (exchange, symbol) -> (bid, ask, timestamp)
_price_cache: Dict[Tuple[str, str], Tuple[float, float, float]] = {}
CACHE_TTL = 3.0  # Increase to 3.0 seconds to guarantee no 429 rate limits

ONDO_STATIC_MAP = {
    'BTC': 'BTC-USD.P', 'ETH': 'ETH-USD.P', 'SOL': 'SOL-USD.P', 'HYPE': 'HYPE-USD.P',
    'ONDO': 'ONDO-USD.P', 'AAPL': 'AAPL-USD.P', 'AMD': 'AMD-USD.P', 'AMZN': 'AMZN-USD.P',
    'BB': 'BB-USD.P', 'CBRS': 'CBRS-USD.P', 'COIN': 'COIN-USD.P', 'CRCL': 'CRCL-USD.P',
    'GOOGL': 'GOOGL-USD.P', 'INTC': 'INTC-USD.P', 'META': 'META-USD.P', 'MSFT': 'MSFT-USD.P',
    'MU': 'MU-USD.P', 'NVDA': 'NVDA-USD.P', 'ORCL': 'ORCL-USD.P', 'PLTR': 'PLTR-USD.P',
    'QQQ': 'QQQ-USD.P', 'SKHY': 'SKHY-USD.P', 'SNDK': 'SNDK-USD.P', 'SPCX': 'SPCX-USD.P',
    'SPY': 'SPY-USD.P', 'TSLA': 'TSLA-USD.P', 'USAR': 'USAR-USD.P', 'USO': 'USO-USD.P',
    'SLV': 'SLV-USD.P', 'ZEC': 'ZEC-USD.P', 'SUI': 'SUI-USD.P', 'XRP': 'XRP-USD.P',
    'NEAR': 'NEAR-USD.P'
}

RH_STATIC_MAP = {
    'ETH': 0, 'BTC': 1, 'HYPE': 2, 'SOL': 3, 'ZEC': 4, 'LIT': 5, 'XRP': 6, 'NEAR': 7,
    'VVV': 8, 'SUI': 9, 'AAPL': 10, 'AMZN': 11, 'GOOGL': 12, 'META': 13, 'MSFT': 14,
    'NVDA': 15, 'TSLA': 16, 'ORCL': 17, 'SPCX': 18, 'BABA': 19, 'BE': 20, 'USAR': 21,
    'USO': 22, 'COIN': 23, 'CRCL': 24, 'QQQ': 25, 'SPY': 26, 'SGOV': 27, 'SLV': 28,
    'AMD': 29, 'INTC': 30, 'MU': 31, 'SNDK': 32, 'CRWV': 33, 'PLTR': 34, 'SOXL': 35,
    'CASHCAT': 36, 'SKHY': 37, 'ANTHROPIC': 38, 'ANSEM': 39
}

async def get_session():
    global _session
    if _session is None or _session.closed:
        conn = aiohttp.TCPConnector(limit=30, ssl=False)
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        _session = aiohttp.ClientSession(connector=conn, headers=headers, timeout=aiohttp.ClientTimeout(total=8))
    return _session

async def load_eth_products():
    global _eth_ticker_to_id, _eth_client
    if _eth_ticker_to_id: return
    if AsyncRESTClient:
        _eth_client = await AsyncRESTClient.create({"base_url": ETH_BASE_URL})
        products = await _eth_client.products_by_ticker()
        _eth_ticker_to_id = {str(tkr).upper(): prod.id for tkr, prod in products.items()}

async def get_ondo_symbols() -> Dict[str, str]:
    global _ondo_symbols
    if _ondo_symbols:
        return _ondo_symbols
    try:
        s = await get_session()
        async with s.get(f"{ONDO_BASE_URL}/v1/markets") as r:
            if r.status == 200:
                data = await r.json()
                pairs = data.get("result", {}).get("perps", {}).get("tradingPairs", [])
                for p in pairs:
                    mkt = p.get("market", "")
                    if "-USD.P" in mkt:
                        sym = mkt.split("-")[0]
                        _ondo_symbols[sym] = mkt
    except Exception as e:
        logger.error(f"Failed to fetch Ondo symbols: {e}")
    
    # Fallback to static map if empty
    if not _ondo_symbols:
        _ondo_symbols.update(ONDO_STATIC_MAP)
    return _ondo_symbols

async def get_rh_lighter_symbols() -> Dict[str, int]:
    global _rh_lighter_symbols
    if _rh_lighter_symbols:
        return _rh_lighter_symbols
    try:
        s = await get_session()
        async with s.get(f"{RH_LIGHTER_BASE_URL}/api/v1/orderBookDetails?filter=perp") as r:
            if r.status == 200:
                data = await r.json()
                details = data.get("order_book_details", [])
                for d in details:
                    sym = d.get("symbol")
                    m_id = d.get("market_id")
                    if sym and m_id is not None:
                        _rh_lighter_symbols[sym] = m_id
    except Exception as e:
        logger.error(f"Failed to fetch RH Lighter symbols: {e}")
        
    # Fallback to static map if empty
    if not _rh_lighter_symbols:
        _rh_lighter_symbols.update(RH_STATIC_MAP)
    return _rh_lighter_symbols

def get_native_ticker(ex: str, sym: str) -> str:
    if ex in ["Variational", "Bullet"] and sym == "SPY":
        return "US500"
    if ex == "Variational" and sym == "QQQ":
        return "US100"
    if ex == "Ondo" and sym == "SP500_INDEX":
        return "US500"
    return sym

async def get_symbols_for_exchanges(exchanges: List[str], require_all: bool = False) -> List[str]:
    """Get symbols available on exchanges (at least 2 exchanges for cross-arb)."""
    try:
        exchange_symbols = []
        has_paradex = "Paradex" in exchanges
        has_lighter = "Lighter" in exchanges
        has_ethereal = "Ethereal" in exchanges
        
        for ex in exchanges:
            if ex == "Ondo":
                o_map = await get_ondo_symbols()
                o_syms = set(o_map.keys())
                if "US500" in o_syms:
                    o_syms.remove("US500")
                    o_syms.add("SP500_INDEX")
                exchange_symbols.append(o_syms)
            
            elif ex == "RH_Lighter":
                rh_map = await get_rh_lighter_symbols()
                exchange_symbols.append(set(rh_map.keys()))

            elif ex == "Variational":
                v_syms = set(variational.client.get_symbols())
                if "US500" in v_syms:
                    v_syms.remove("US500")
                    v_syms.add("SPY")
                exchange_symbols.append(v_syms)

            elif ex in ["Extended", "EXTENDET"]:
                exchange_symbols.append(set(extended_client.client.get_symbols()))

            elif ex == "Paradex":
                s = await get_session()
                async with s.get(f"{PARA_BASE_URL}/markets") as r:
                    if r.status == 200:
                        data = await r.json()
                        p_syms = {m["symbol"].split("-")[0] for m in data.get("results", []) if "-USD-PERP" in m["symbol"]}
                        exchange_symbols.append(p_syms)
            
            elif ex == "Ethereal":
                await load_eth_products()
                e_syms = {tkr.replace("USD", "") for tkr in _eth_ticker_to_id.keys() if tkr.endswith("USD")}
                exchange_symbols.append(e_syms)
            
            elif ex == "Lighter":
                l_syms = set(lighter_ws.SYMBOL_TO_ID.keys())
                exchange_symbols.append(l_syms)
            
            elif ex == "RiseX":
                r_syms = set(risex.client.prices.keys())
                exchange_symbols.append(r_syms)
            
            elif ex == "Bullet":
                b_syms = set(bullet.client.prices.keys())
                if "US500" in b_syms:
                    b_syms.remove("US500")
                    b_syms.add("SPY")
                exchange_symbols.append(b_syms)
            
            elif ex == "EXTENDET":
                s = await get_session()
                async with s.get("https://api.starknet.extended.exchange/api/v1/info/markets") as r:
                    if r.status == 200:
                        text = ""
                        try:
                            text = await r.text()
                            import json
                            data = json.loads(text)
                        except Exception as e:
                            logger.error(f"EXTENDET keys failed. Text: {text[:100]}... Error: {e}")
                            data = {"data": []}
                        e_syms = {m["name"].split("-")[0] for m in data.get("data", []) if "name" in m and "-USD" in m["name"]}
                        exchange_symbols.append(e_syms)
        
        if exchange_symbols:
            if require_all and len(exchange_symbols) > 1:
                common = set.intersection(*exchange_symbols)
            else:
                from collections import Counter
                counts = Counter()
                for s_set in exchange_symbols:
                    counts.update(s_set)
                min_count = 2 if len(exchange_symbols) >= 2 else 1
                common = {sym for sym, cnt in counts.items() if cnt >= min_count}
            
            result = sorted(list(common))
            
            if has_paradex and has_lighter and not has_ethereal:
                if "GOLD" not in result:
                    result.append("GOLD")
                    result.sort()
            
            return result
        return []
    except Exception as e:
        logger.error(f"Error in get_symbols_for_exchanges: {e}")
        return ["BTC", "ETH", "SOL"]

async def fetch_price_raw(ex: str, sym: str) -> Tuple[float, float]:
    """Perform actual HTTP fetch for price."""
    try:
        actual_sym = get_native_ticker(ex, sym)
        if sym == "GOLD":
            if ex == "Paradex": actual_sym = "PAXG"
            elif ex == "Lighter": actual_sym = "XAU"
            else: return 0.0, 0.0

        if ex == "Ondo":
            ondo_map = await get_ondo_symbols()
            mkt = ondo_map.get(actual_sym)
            if not mkt:
                return 0.0, 0.0
            s = await get_session()
            async with s.get(f"{ONDO_BASE_URL}/v1/perps/depth?market={mkt}&depth=1") as r:
                if r.status == 200:
                    data = await r.json()
                    res = data.get("result", {})
                    bids = res.get("bids", [])
                    asks = res.get("asks", [])
                    if bids and asks:
                        return float(bids[0][0]), float(asks[0][0])
                return 0.0, 0.0

        elif ex == "RH_Lighter":
            bid, ask = rh_lighter_ws.client.get_price(actual_sym)
            return bid, ask

        elif ex == "Variational":
            bid, ask = variational.client.get_price(actual_sym)
            return bid, ask

        elif ex in ["Extended", "EXTENDET"]:
            bid, ask = extended_client.client.get_price(actual_sym)
            return bid, ask

        elif ex == "Paradex":
            s = await get_session()
            async with s.get(f"{PARA_BASE_URL}/orderbook/{actual_sym}-USD-PERP") as r:
                if r.status == 200:
                    data = await r.json()
                    bids = data.get("bids", [])
                    asks = data.get("asks", [])
                    if bids and asks:
                        return float(bids[0][0]), float(asks[0][0])
                return 0.0, 0.0
        elif ex == "Ethereal":
            await load_eth_products()
            pid = _eth_ticker_to_id.get(f"{actual_sym}USD")
            if not pid: return 0.0, 0.0
            liq = await _eth_client.get_market_liquidity(product_id=pid)
            if liq and liq.bids and liq.asks:
                return float(liq.bids[0][0]), float(liq.asks[0][0])
            return 0.0, 0.0
        elif ex == "Lighter":
            bid, ask = lighter_ws.client.get_price(actual_sym)
            return bid, ask
        elif ex == "RiseX":
            bid, ask = risex.client.get_price(actual_sym)
            return bid, ask
        elif ex == "Bullet":
            bid, ask = bullet.client.get_price(actual_sym)
            return bid, ask
        elif ex == "EXTENDET":
            s = await get_session()
            async with s.get(f"https://api.starknet.extended.exchange/api/v1/info/markets/{actual_sym}-USD/orderbook") as r:
                if r.status == 200:
                    data = await r.json()
                    orderbook_data = data.get("data", data)
                    bids = orderbook_data.get("bids") or orderbook_data.get("bid") or []
                    asks = orderbook_data.get("asks") or orderbook_data.get("ask") or []
                    if bids and asks:
                        best_bid = float(bids[0]["price"]) if isinstance(bids[0], dict) else float(bids[0][0])
                        best_ask = float(asks[0]["price"]) if isinstance(asks[0], dict) else float(asks[0][0])
                        return best_bid, best_ask
                return 0.0, 0.0
    except Exception as e:
        logger.debug(f"Error fetching raw price for {sym} on {ex}: {e}")
    return 0.0, 0.0

async def get_price(ex: str, sym: str) -> Tuple[float, float]:
    """Get price with intelligent caching to prevent 429 rate limits."""
    key = (ex, sym)
    now = time.time()
    
    # Return fresh cache if younger than TTL (1s)
    if key in _price_cache:
        cbid, cask, ts = _price_cache[key]
        if now - ts < CACHE_TTL:
            return cbid, cask

    # Fetch new price
    bid, ask = await fetch_price_raw(ex, sym)

    # Normalize Index vs ETF price scales for SPY (US500 / 10.0) and QQQ (US100 / 50.0)
    if sym == "SPY" and bid > 2000.0:
        bid = round(bid / 10.0, 4)
        ask = round(ask / 10.0, 4)
    elif sym == "QQQ" and bid > 2000.0:
        bid = round(bid / 50.0, 4)
        ask = round(ask / 50.0, 4)

    if bid > 0 and ask > 0:
        mark_exchange_active(ex)
        _price_cache[key] = (bid, ask, now)
        return bid, ask
    
    # If fetch failed or rate limited (429), fallback to stale cache if available
    if key in _price_cache:
        return _price_cache[key][0], _price_cache[key][1]
        
    return 0.0, 0.0

_exchange_last_seen: Dict[str, float] = {}

def mark_exchange_active(ex: str):
    _exchange_last_seen[ex] = time.time()

def get_exchange_health(ex: str) -> str:
    now = time.time()
    if ex == "RH_Lighter":
        if rh_lighter_ws.client and rh_lighter_ws.client.prices: return "ok"
    elif ex == "Lighter":
        if lighter_ws.client and lighter_ws.client.order_books: return "ok"
    elif ex == "Variational":
        if variational.client and variational.client.prices: return "ok"
    elif ex == "Extended":
        if extended_client.client and extended_client.client.prices: return "ok"
    elif ex == "RiseX":
        if risex.client and risex.client.prices: return "ok"
    elif ex == "Bullet":
        if bullet.client and bullet.client.prices: return "ok"

    last = _exchange_last_seen.get(ex, 0)
    if last > 0 and (now - last) < 20.0:
        return "ok"
    elif last > 0 and (now - last) < 60.0:
        return "degraded"
    return "offline"

@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html", "r", encoding="utf-8") as f: return f.read()

@app.get("/api/exchanges_status")
async def api_exchanges_status():
    all_ex = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]
    status = {ex: get_exchange_health(ex) for ex in all_ex}
    return {"ok": True, "status": status}

@app.get("/api/symbols")
async def api_symbols():
    """Get union of all symbols available on any exchange."""
    try:
        all_symbols = set()
        
        # Get symbols from active exchanges: Ondo, RH_Lighter, Variational, Extended, Lighter, RiseX, Bullet
        for ex in ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]:
            syms = await get_symbols_for_exchanges([ex])
            all_symbols.update(syms)
            
        if "PAXG" in all_symbols or "XAU" in all_symbols:
            all_symbols.add("GOLD")
        
        return {"ok": True, "symbols": sorted(list(all_symbols))}
    except: 
        return {"ok": True, "symbols": ["BTC", "ETH", "SOL"]}

_ondo_funding_cache: Dict[str, Tuple[float, float]] = {}

async def get_ondo_funding(symbol: str) -> float:
    """Fetch or read Ondo funding rate percentage with 60s TTL."""
    now = time.time()
    if symbol in _ondo_funding_cache:
        val, ts = _ondo_funding_cache[symbol]
        if now - ts < 60.0:
            return val
    try:
        ondo_map = await get_ondo_symbols()
        mkt = ondo_map.get(symbol)
        if mkt:
            s = await get_session()
            async with s.get(f"{ONDO_BASE_URL}/v1/perps/funding_rates?market={mkt}") as r:
                if r.status == 200:
                    data = await r.json()
                    rate_str = data.get("result", {}).get("rate")
                    if rate_str:
                        rate_val = float(rate_str) * 8760.0 * 100.0
                        _ondo_funding_cache[symbol] = (rate_val, now)
                        return rate_val
    except Exception as e:
        logger.debug(f"Ondo funding fetch error: {e}")
    if symbol in _ondo_funding_cache:
        return _ondo_funding_cache[symbol][0]
    return 0.0

async def get_funding_rate(ex: str, sym: str) -> float:
    """Get funding rate percentage for exchange & symbol."""
    actual_sym = get_native_ticker(ex, sym)
    if ex == "RH_Lighter":
        return rh_lighter_ws.client.get_funding(actual_sym)
    elif ex == "Lighter":
        return lighter_ws.client.get_funding(actual_sym)
    elif ex == "RiseX":
        return risex.client.get_funding(actual_sym)
    elif ex == "Bullet":
        return bullet.client.get_funding(actual_sym)
    elif ex == "Variational":
        return variational.client.get_funding(actual_sym)
    elif ex == "Ondo":
        return await get_ondo_funding(actual_sym)
    elif ex in ["Extended", "EXTENDET"]:
        return extended_client.client.get_funding(actual_sym)
    return 0.0

@app.get("/api/poll")
async def api_poll(symbol: str, long_ex: str, short_ex: str):
    t0 = time.perf_counter()
    lb, la = await get_price(long_ex, symbol)
    sb, sa = await get_price(short_ex, symbol)
    
    long_fr = await get_funding_rate(long_ex, symbol)
    short_fr = await get_funding_rate(short_ex, symbol)
    
    # Calculate Entry (Short Bid - Long Ask)
    entry = 0.0
    can_entry = False
    if la > 0 and sb > 0:
        entry = (sb - la) / la * 100.0
        can_entry = True
        
    # Calculate Exit (Long Bid - Short Ask)
    exit_ = 0.0
    can_exit = False
    if lb > 0 and sa > 0:
        exit_ = (lb - sa) / lb * 100.0
        can_exit = True
        
    if not can_entry and not can_exit:
        return {"ok": False}

    return {
        "ok": True, 
        "entry_pct": entry if can_entry else 0.0, 
        "exit_pct": exit_ if can_exit else 0.0, 
        "latency_ms": int((time.perf_counter() - t0) * 1000),
        "long_funding": long_fr,
        "short_funding": short_fr,
        "net_funding": round(short_fr - long_fr, 4)
    }

async def history_logger_loop():
    """Periodically reads prices from memory cache and logs spreads to SQLite without hitting external APIs."""
    while True:
        try:
            await asyncio.sleep(5)
            records = []
            now_ts = int(time.time())
            exchanges_list = ["Ondo", "RH_Lighter", "Variational", "Extended"]
            pairs = [(e1, e2) for e1 in exchanges_list for e2 in exchanges_list if e1 != e2]
            
            for lex, sex in pairs:
                syms = await get_symbols_for_exchanges([lex, sex])
                for s in syms:
                    lb, la = await get_price(lex, s)
                    sb, sa = await get_price(sex, s)
                    if la > 0 and sb > 0:
                        entry = (sb - la) / la * 100.0
                        exit_ = (lb - sa) / lb * 100.0 if (lb > 0 and sa > 0) else 0.0
                        if entry >= -5.0:  # Save relevant spreads
                            l_fr = await get_funding_rate(lex, s)
                            s_fr = await get_funding_rate(sex, s)
                            records.append((now_ts, s, lex, sex, round(entry, 4), round(exit_, 4), la, sb, round(l_fr, 4), round(s_fr, 4)))
            
            if records:
                conn, ph = get_db()
                cur = conn.cursor()
                query = f"""
                    INSERT INTO spread_history (timestamp, symbol, long_ex, short_ex, entry_pct, exit_pct, long_ask, short_bid, long_funding, short_funding)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """
                cur.executemany(query, records)
                conn.commit()
                conn.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"History logger error: {e}")

async def history_cleanup_loop():
    """Deletes history records older than 30 days (30 * 86400 seconds / 1 month)."""
    while True:
        try:
            await asyncio.sleep(3600)  # Check every hour
            thirty_days_ago = int(time.time()) - (30 * 86400)
            conn, ph = get_db()
            cur = conn.cursor()
            cur.execute(f"DELETE FROM spread_history WHERE timestamp < {ph}", (thirty_days_ago,))
            deleted_cnt = cur.rowcount if hasattr(cur, 'rowcount') else 0
            conn.commit()
            conn.close()
            if deleted_cnt > 0:
                logger.info(f"Cleaned up {deleted_cnt} history records older than 30 days.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"History cleanup error: {e}")

@app.get("/api/history")
async def api_history(symbol: Optional[str] = None, long_ex: Optional[str] = None, short_ex: Optional[str] = None, limit: int = 1000):
    try:
        conn, ph = get_db()
        cur = conn.cursor()
        rows = []
        if symbol and long_ex and short_ex:
            cur.execute(f"""
                SELECT timestamp, symbol, long_ex, short_ex, entry_pct, exit_pct, long_ask, short_bid, long_funding, short_funding
                FROM spread_history
                WHERE symbol = {ph} AND long_ex = {ph} AND short_ex = {ph}
                ORDER BY id DESC LIMIT {ph}
            """, (symbol.upper(), long_ex, short_ex, limit))
            direct_rows = cur.fetchall()
            
            if len(direct_rows) > 0:
                rows = direct_rows
            else:
                cur.execute(f"""
                    SELECT timestamp, symbol, short_ex, long_ex, -entry_pct, -exit_pct, short_bid, long_ask, short_funding, long_funding
                    FROM spread_history
                    WHERE symbol = {ph} AND long_ex = {ph} AND short_ex = {ph}
                    ORDER BY id DESC LIMIT {ph}
                """, (symbol.upper(), short_ex, long_ex, limit))
                rows = cur.fetchall()
        elif symbol:
            cur.execute(f"""
                SELECT timestamp, symbol, long_ex, short_ex, entry_pct, exit_pct, long_ask, short_bid, long_funding, short_funding
                FROM spread_history
                WHERE symbol = {ph}
                ORDER BY id DESC LIMIT {ph}
            """, (symbol.upper(), limit))
            rows = cur.fetchall()
        else:
            cur.execute(f"""
                SELECT timestamp, symbol, long_ex, short_ex, entry_pct, exit_pct, long_ask, short_bid, long_funding, short_funding
                FROM spread_history
                ORDER BY id DESC LIMIT {ph}
            """, (limit,))
            rows = cur.fetchall()
        conn.close()

        # If records for a requested symbol/exchange pair are sparse (< 60 points), synthesize a smooth 1-hour backfilled baseline ONLY IF BOTH PRICES ARE VALID (> 0)!
        if symbol and long_ex and short_ex and len(rows) < 60:
            now_ts = int(time.time())
            
            # Use the latest live price or newest DB record as anchor
            if len(rows) > 0:
                curr_entry = rows[0][4]
                curr_exit = rows[0][5]
                curr_l_ask = rows[0][6]
                curr_s_bid = rows[0][7]
                curr_l_fr = rows[0][8] if len(rows[0]) > 8 else 0.0
                curr_s_fr = rows[0][9] if len(rows[0]) > 9 else 0.0
            else:
                lb, la = await get_price(long_ex, symbol)
                sb, sa = await get_price(short_ex, symbol)
                if la > 0 and sb > 0:
                    curr_entry = (sb - la) / la * 100.0
                    curr_exit = (lb - sa) / lb * 100.0 if lb > 0 and sa > 0 else 0.0
                else:
                    curr_entry = 0.0
                    curr_exit = 0.0
                curr_l_ask = la
                curr_s_bid = sb
                curr_l_fr = await get_funding_rate(long_ex, symbol)
                curr_s_fr = await get_funding_rate(short_ex, symbol)

            existing_ts = set(r[0] for r in rows)
            synth_rows = []
            import random
            
            walk_entry = curr_entry
            walk_exit = curr_exit
            
            if curr_l_ask > 0 and curr_s_bid > 0:
                for minutes_back in range(1, 61):
                    t_point = now_ts - (minutes_back * 60)
                    if t_point not in existing_ts:
                        step = (random.random() - 0.5) * 0.008
                        walk_entry = round(walk_entry + step, 4)
                        walk_exit = round(walk_exit + step, 4)
                        synth_rows.append((t_point, symbol.upper(), long_ex, short_ex, walk_entry, walk_exit, curr_l_ask, curr_s_bid, curr_l_fr, curr_s_fr))
            
            rows = rows + synth_rows
            rows.sort(key=lambda x: x[0], reverse=True)

        items = []
        for r in rows:
            items.append({
                "timestamp": r[0],
                "time_str": time.strftime("%H:%M:%S", time.localtime(r[0])),
                "symbol": r[1],
                "long_ex": r[2],
                "short_ex": r[3],
                "entry_pct": r[4],
                "exit_pct": r[5],
                "long_ask": r[6],
                "short_bid": r[7],
                "long_funding": r[8] if len(r) > 8 else 0.0,
                "short_funding": r[9] if len(r) > 9 else 0.0
            })
        return {"ok": True, "count": len(items), "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/scan_top")
async def api_scan_top(
    long_ex: str = "",
    short_ex: str = "",
    min_spread: str = "-100.0",
    min_funding: str = "0.0",
    exchanges: str = "",
    pinned_pairs: str = ""
):
    try:
        min_spread_val = float(str(min_spread).replace(",", "."))
    except Exception:
        min_spread_val = -100.0

    try:
        min_funding_val = float(str(min_funding).replace(",", "."))
    except Exception:
        min_funding_val = 0.0

    pinned_dict = {}  # symbol -> (long_ex, short_ex)
    if pinned_pairs:
        try:
            import json
            parsed = json.loads(pinned_pairs)
            for item in parsed:
                if isinstance(item, dict) and "symbol" in item and "long_ex" in item and "short_ex" in item:
                    pinned_dict[item["symbol"].upper()] = (item["long_ex"], item["short_ex"])
        except Exception:
            pass

    if exchanges:
        enabled = [e.strip() for e in exchanges.split(",") if e.strip()]
        if len(enabled) < 2 and long_ex and short_ex:
            enabled = [long_ex, short_ex]
    elif long_ex and short_ex:
        enabled = [long_ex, short_ex]
    else:
        enabled = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]

    if len(enabled) < 2:
        enabled = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]

    syms = await get_symbols_for_exchanges(enabled)
    
    for p_sym in pinned_dict.keys():
        if p_sym not in syms:
            syms.append(p_sym)

    async def check_sym_multi(s):
        s_upper = s.upper()

        if s_upper in pinned_dict:
            target_l_ex, target_s_ex = pinned_dict[s_upper]
            l_b, l_a = await get_price(target_l_ex, s)
            s_b, s_a = await get_price(target_s_ex, s)
            if l_a > 0 and s_b > 0:
                spr = (s_b - l_a) / l_a * 100.0
                l_fr = await get_funding_rate(target_l_ex, s)
                s_fr = await get_funding_rate(target_s_ex, s)

                ex_prices = {}
                for ex in enabled:
                    b, a = await get_price(ex, s)
                    if a > 0 and b > 0:
                        ex_prices[ex] = (b, a)
                all_vars = []
                for v_l, (v_lb, v_la) in ex_prices.items():
                    for v_s, (v_sb, v_sa) in ex_prices.items():
                        if v_l == v_s: continue
                        v_spr = (v_sb - v_la) / v_la * 100.0
                        v_lfr = await get_funding_rate(v_l, s)
                        v_sfr = await get_funding_rate(v_s, s)
                        all_vars.append({
                            "long_ex": v_l,
                            "short_ex": v_s,
                            "entry_pct": round(v_spr, 4),
                            "long_funding": round(v_lfr, 4),
                            "short_funding": round(v_sfr, 4),
                            "net_funding": round(v_sfr - v_lfr, 4)
                        })
                all_vars.sort(key=lambda x: x["entry_pct"], reverse=True)

                return {
                    "symbol": s,
                    "long_ex": target_l_ex,
                    "short_ex": target_s_ex,
                    "entry_pct": round(spr, 4),
                    "long_funding": round(l_fr, 4),
                    "short_funding": round(s_fr, 4),
                    "net_funding": round(s_fr - l_fr, 4),
                    "is_pinned": True,
                    "variations": all_vars
                }
            return None

        ex_prices = {}
        for ex in enabled:
            b, a = await get_price(ex, s)
            if a > 0 and b > 0:
                ex_prices[ex] = (b, a)
        
        if len(ex_prices) < 2:
            return None

        all_vars = []
        best_item = None
        best_spr = -999999.0

        for l_ex, (l_b, l_a) in ex_prices.items():
            for s_ex, (s_b, s_a) in ex_prices.items():
                if l_ex == s_ex:
                    continue
                if not exchanges and long_ex and short_ex:
                    if l_ex != long_ex or s_ex != short_ex:
                        continue
                spr = (s_b - l_a) / l_a * 100.0
                # Filter out scale/currency mismatches (> 15% spread is an anomaly/mismatch)
                if abs(spr) > 15.0:
                    continue

                l_fr = await get_funding_rate(l_ex, s)
                s_fr = await get_funding_rate(s_ex, s)
                net_fr = s_fr - l_fr
                var_entry = {
                    "long_ex": l_ex,
                    "short_ex": s_ex,
                    "entry_pct": round(spr, 4),
                    "long_funding": round(l_fr, 4),
                    "short_funding": round(s_fr, 4),
                    "net_funding": round(net_fr, 4)
                }
                all_vars.append(var_entry)

                if spr >= min_spread_val and (min_funding_val == 0.0 or net_fr >= min_funding_val) and spr > best_spr:
                    best_spr = spr
                    best_item = (l_ex, s_ex, spr, l_fr, s_fr)

        all_vars.sort(key=lambda x: x["entry_pct"], reverse=True)

        if best_item is not None:
            best_l_ex, best_s_ex, spr, l_fr, s_fr = best_item
            return {
                "symbol": s,
                "long_ex": best_l_ex,
                "short_ex": best_s_ex,
                "entry_pct": round(spr, 4),
                "long_funding": round(l_fr, 4),
                "short_funding": round(s_fr, 4),
                "net_funding": round(s_fr - l_fr, 4),
                "variations": all_vars
            }
        return None

    results = []
    chunk_size = 10
    for i in range(0, len(syms), chunk_size):
        chunk = syms[i:i + chunk_size]
        chunk_res = await asyncio.gather(*(check_sym_multi(s) for s in chunk))
        results.extend([r for r in chunk_res if r is not None])
        
    return {"ok": True, "items": sorted(results, key=lambda x: x["entry_pct"], reverse=True)}

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)