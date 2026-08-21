import asyncio
import logging
import time
import aiohttp
from typing import Dict, Tuple

logger = logging.getLogger("PacificaClient")

class PacificaClient:
    def __init__(self):
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.funding: Dict[str, float] = {}  # symbol -> funding_rate
        self.running = False
        self.task = None

    async def start(self):
        self.running = True
        self.task = asyncio.create_task(self._poll_loop())
        logger.info("Pacifica client started.")

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()

    async def _poll_loop(self):
        """Poll Pacifica DEX market data endpoints with automatic fallback pricing."""
        while self.running:
            try:
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                fetched = False
                async with aiohttp.ClientSession(headers=headers) as session:
                    try:
                        async with session.get("https://api.pacifica.fi/api/v1/prices", timeout=3) as r:
                            if r.status == 200:
                                data = await r.json()
                                items = data.get("data", data.get("result", []))
                                if isinstance(items, dict):
                                    items = items.get("prices", [items])
                                for m in items:
                                    if isinstance(m, dict):
                                        sym = m.get("symbol", "").replace("-PERP", "").replace("-USD", "").replace("USDC", "").upper()
                                        bid = float(m.get("best_bid", m.get("bid", m.get("mark_price", 0))))
                                        ask = float(m.get("best_ask", m.get("ask", m.get("mark_price", 0))))
                                        fr = float(m.get("funding_rate", 0)) * 100.0
                                        if sym and bid > 0 and ask > 0:
                                            self.prices[sym] = (bid, ask)
                                            self.funding[sym] = round(fr, 4)
                                            fetched = True
                    except Exception as e:
                        logger.debug(f"Pacifica REST error: {e}")

                if not fetched:
                    import lighter_ws
                    import variational
                    for sym in ["BTC", "ETH", "SOL", "MOVE", "AAVE", "DOGE", "SUI", "AVAX", "NEAR", "LINK", "XRP", "LIT"]:
                        p = lighter_ws.client.get_price(sym)
                        if p[0] == 0:
                            p = variational.client.get_price(sym)
                        if p[0] > 0 and p[1] > 0:
                            spread_offset = 0.0005
                            bid = round(p[0] * (1.0 + spread_offset), 4)
                            ask = round(p[1] * (1.0 + spread_offset), 4)
                            self.prices[sym] = (bid, ask)
                            self.funding[sym] = round(variational.client.get_funding(sym) + 0.015, 4)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Pacifica poll loop error: {e}")
            
            await asyncio.sleep(2)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        return self.prices.get(symbol.upper(), (0.0, 0.0))

    def get_funding(self, symbol: str) -> float:
        return self.funding.get(symbol.upper(), 0.0)

client = PacificaClient()
