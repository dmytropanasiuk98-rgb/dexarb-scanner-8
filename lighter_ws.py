import asyncio
import aiohttp
import json
import logging
import time
from typing import Dict, Tuple, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("LighterWS")

WS_URL = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true"

# Symbol to Market ID mapping from Lighter API
SYMBOL_TO_ID = {
    "0G": 84, "1000BONK": 18, "1000FLOKI": 19, "1000PEPE": 4, "1000SHIB": 17,
    "1000TOSHI": 81, "2Z": 88, "AAPL": 113, "AAVE": 27, "ADA": 39, "AERO": 65,
    "AI16Z": 22, "AMZN": 114, "APEX": 86, "APT": 31, "ARB": 50, "ASTER": 83,
    "AUDUSD": 106, "AVAX": 9, "AVNT": 82, "BCH": 58, "BERA": 20, "BMNR": 123,
    "BNB": 25, "BTC": 1, "CC": 101, "COIN": 109, "CRCL": 121, "CRO": 73,
    "CRV": 36, "DASH": 127, "DOGE": 3, "DOLO": 75, "DOT": 11, "DUSK": 125,
    "DYDX": 62, "EDEN": 89, "EIGEN": 49, "ENA": 29, "ETH": 0, "ETHFI": 64,
    "EURUSD": 96, "FARTCOIN": 21, "FF": 87, "FIL": 103, "FOGO": 124, "GBPUSD": 97,
    "GMX": 61, "GOOGL": 116, "GRASS": 52, "HBAR": 59, "HOOD": 108, "HYPE": 24,
    "ICP": 102, "IP": 34, "JUP": 26, "KAITO": 33, "LAUNCHCOIN": 54, "LDO": 46,
    "LINEA": 76, "LINK": 8, "LIT": 120, "LTC": 35, "MEGA": 94, "MET": 95,
    "META": 117, "MKR": 28, "MNT": 63, "MON": 91, "MORPHO": 68, "MSFT": 115,
    "MSTR": 122, "MYX": 80, "NEAR": 10, "NMR": 74, "NVDA": 110, "NZDUSD": 107,
    "ONDO": 38, "OP": 55, "PAXG": 48, "PENDLE": 37, "PENGU": 47, "PLTR": 111,
    "POL": 14, "POPCAT": 23, "PROVE": 57, "PUMP": 45, "PYTH": 78, "QQQ": 129,
    "RESOLV": 51, "RIVER": 126, "S": 40, "SEI": 32, "SKY": 79, "SOL": 2,
    "SPX": 42, "SPY": 128, "STABLE": 118, "STBL": 85, "STRK": 104, "SUI": 16,
    "SYRUP": 44, "TAO": 13, "TIA": 67, "TON": 12, "TRUMP": 15, "TRX": 43,
    "TSLA": 112, "UNI": 30, "USDCAD": 100, "USDCHF": 99, "USDJPY": 98, "USDKRW": 105,
    "USELESS": 66, "VIRTUAL": 41, "VVV": 69, "WIF": 5, "WLD": 6, "WLFI": 72,
    "XAG": 93, "XAU": 92, "XLM": 119, "XMR": 77, "XPL": 71, "XRP": 7,
    "YZY": 70, "ZEC": 90, "ZK": 56, "ZORA": 53, "ZRO": 60, "VR": 41, "PEPE": 4
}

class LighterClient:
    def __init__(self):
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.session: Optional[aiohttp.ClientSession] = None
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.order_books: Dict[str, Dict] = {}  # Alias for server compatibility
        self.funding_rates: Dict[str, float] = {}  # symbol -> funding_rate_pct
        self.running = False
        self._ready = False

    async def start(self):
        """Starts the background WebSocket task."""
        self.running = True
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False
        if self.ws:
            await self.ws.close()
        if self.session:
            await self.session.close()

    async def _connect_loop(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Origin": "https://app.lighter.xyz",
            "Accept-Language": "en-US,en;q=0.9"
        }
        while self.running:
            try:
                logger.info(f"Connecting to Lighter WS: {WS_URL}")
                async with self.session.ws_connect(WS_URL, headers=headers) as ws:
                    self.ws = ws
                    logger.info("Connected to Lighter DEX WS")
                    self._ready = True
                    
                    # Single subscription for all market stats
                    sub_msg = {"type": "subscribe", "channel": "market_stats/all"}
                    await ws.send_json(sub_msg)

                    async for msg in ws:
                        if not self.running: break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await self._handle_msg(json.loads(msg.data))
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            logger.error(f"Lighter WS Error: {ws.exception()}")
                            break
            except Exception as e:
                logger.error(f"Lighter Connection error: {e}")
                self._ready = False
                await asyncio.sleep(4)

    async def _handle_msg(self, data: dict):
        msg_type = data.get("type")
        if msg_type in ["subscribed/market_stats", "update/market_stats"]:
            stats = data.get("market_stats", {})
            if isinstance(stats, dict):
                for m_id, item in stats.items():
                    if isinstance(item, dict):
                        sym = item.get("symbol")
                        bid_str = item.get("best_bid_price") or item.get("mark_price") or item.get("last_trade_price")
                        ask_str = item.get("best_ask_price") or item.get("mark_price") or item.get("last_trade_price")
                        fr_str = item.get("current_funding_rate") or item.get("funding_rate")
                        if sym:
                            if bid_str and ask_str:
                                try:
                                    bid = float(bid_str)
                                    ask = float(ask_str)
                                    if bid > 0 and ask > 0:
                                        self.prices[sym] = (bid, ask)
                                        self.order_books[sym] = {"bids": {bid: 1}, "asks": {ask: 1}}
                                except ValueError:
                                    pass
                            if fr_str:
                                try:
                                    rate_val = float(fr_str)
                                    # current_funding_rate is hourly percentage rate (e.g. 0.0012 = 0.0012%/hr)
                                    # Convert to Annualized APR % = rate_val * 8760
                                    apr = rate_val * 8760.0
                                    self.funding_rates[sym] = round(apr, 4)
                                except ValueError:
                                    pass

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (best_bid, best_ask)"""
        s = symbol.upper()
        if s in self.prices:
            return self.prices[s]
        return 0.0, 0.0

    def get_funding(self, symbol: str) -> float:
        """Returns funding rate percentage for symbol"""
        s = symbol.upper()
        if s in self.funding_rates:
            return self.funding_rates[s]
        return 0.0

# Global instance
client = LighterClient()
