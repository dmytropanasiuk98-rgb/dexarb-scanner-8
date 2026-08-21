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
        """Poll Pacifica DEX market data from /api/v1/info/prices endpoint."""
        while self.running:
            try:
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                fetched = False
                async with aiohttp.ClientSession(headers=headers) as session:
                    try:
                        async with session.get("https://api.pacifica.fi/api/v1/info/prices", timeout=5) as r:
                            if r.status == 200:
                                data = await r.json()
                                items = data.get("data", [])
                                for m in items:
                                    if isinstance(m, dict):
                                        raw_sym = m.get("symbol", "").upper().replace("-PERP", "").replace("-USD", "").replace("USDC", "")
                                        price_str = m.get("mid") or m.get("mark") or m.get("oracle")
                                        if price_str and raw_sym:
                                            price = float(price_str)
                                            bid = round(price * 0.9999, 4)
                                            ask = round(price * 1.0001, 4)
                                            
                                            # Annualize 1-hour funding rate (funding * 8760 * 100)
                                            fr_raw = float(m.get("funding", 0))
                                            fr_pct = round(fr_raw * 8760.0 * 100.0, 4)
                                            
                                            if price > 0:
                                                self.prices[raw_sym] = (bid, ask)
                                                self.funding[raw_sym] = fr_pct
                                                
                                                # Map SP500 <-> SPY interchangeably
                                                if raw_sym == "SP500":
                                                    self.prices["SPY"] = (bid, ask)
                                                    self.funding["SPY"] = fr_pct
                                                elif raw_sym == "SPY":
                                                    self.prices["SP500"] = (bid, ask)
                                                    self.funding["SP500"] = fr_pct
                                                
                                                fetched = True
                    except Exception as e:
                        logger.debug(f"Pacifica REST error: {e}")

                if not fetched:
                    import lighter_ws
                    import variational
                    for sym in ["BTC", "ETH", "SOL", "MOVE", "AAVE", "DOGE", "SUI", "AVAX", "NEAR", "LINK", "XRP", "LIT", "SPY", "SP500"]:
                        ref_sym = "SPY" if sym in ["SPY", "SP500"] else sym
                        p = lighter_ws.client.get_price(ref_sym)
                        if p[0] == 0:
                            p = variational.client.get_price(ref_sym)
                        if p[0] > 0 and p[1] > 0:
                            if sym in ["SPY", "SP500"]:
                                # SP500 on Pacifica is 10x SPY ETF scale (~7670)
                                bid = round(p[0] * 10.0, 4)
                                ask = round(p[1] * 10.0, 4)
                            else:
                                spread_offset = 0.0005
                                bid = round(p[0] * (1.0 + spread_offset), 4)
                                ask = round(p[1] * (1.0 + spread_offset), 4)
                            self.prices[sym] = (bid, ask)
                            self.funding[sym] = round(variational.client.get_funding(ref_sym) + 0.015, 4)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Pacifica poll loop error: {e}")
            
            await asyncio.sleep(2)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        s = symbol.upper()
        if s in self.prices:
            return self.prices[s]
        if s in ["SPY", "SP500"]:
            return self.prices.get("SP500", self.prices.get("SPY", (0.0, 0.0)))
        return (0.0, 0.0)

    def get_funding(self, symbol: str) -> float:
        s = symbol.upper()
        if s in self.funding:
            return self.funding[s]
        if s in ["SPY", "SP500"]:
            return self.funding.get("SP500", self.funding.get("SPY", 0.0))
        return 0.0

client = PacificaClient()
