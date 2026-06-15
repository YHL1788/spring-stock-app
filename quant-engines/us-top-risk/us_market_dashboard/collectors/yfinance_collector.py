"""
Yahoo Finance Collector
拉取所有 ETF / 指数 / 期货的日频 OHLCV
"""
import logging
from typing import List, Optional

import pandas as pd

from us_market_dashboard.collectors.base import BaseCollector
from us_market_dashboard.config.settings import (
    FACTOR_PROXIES, INDICES, KEY_TICKERS, CTA_SIGNAL_ASSETS,
    CTA_SIGNAL_FALLBACKS, SG_CTA_PROXY, HISTORICAL_LOOKBACK,
    LEADING_TICKERS,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


class YFinanceCollector(BaseCollector):
    name = "yfinance"

    def __init__(self, symbols: Optional[List[str]] = None,
                 period: str = HISTORICAL_LOOKBACK,
                 incremental: bool = True):
        """
        symbols: 要拉取的 ticker 列表，为 None 则使用全部默认
        period:  yfinance period，初次回填用 '5y' / '10y'
        incremental: True 表示只拉最近 30 天（日常更新），False 拉全量
        """
        self.symbols = symbols or self._default_symbols()
        self.period = period
        self.incremental = incremental

    @staticmethod
    def _default_symbols() -> List[str]:
        s = set()
        for cfg in FACTOR_PROXIES.values():
            s.add(cfg["long"])
            s.add(cfg["short"])
        s.update(INDICES.keys())
        s.update(KEY_TICKERS)
        s.update(CTA_SIGNAL_ASSETS.values())
        for fallbacks in CTA_SIGNAL_FALLBACKS.values():
            s.update(fallbacks)
        s.add(SG_CTA_PROXY)
        # v2 评分系统所需的领先指标 ETF
        s.update(LEADING_TICKERS)
        return sorted(s)

    def _collect(self) -> dict:
        try:
            import yfinance as yf
        except ImportError:
            raise RuntimeError("yfinance not installed: pip install yfinance")

        results = {}
        period = "1mo" if self.incremental else self.period

        # 批量下载效率更高
        logger.info(f"Downloading {len(self.symbols)} symbols, period={period}")
        try:
            data = yf.download(
                tickers=" ".join(self.symbols),
                period=period,
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                threads=True,
                progress=False,
            )
        except Exception as e:
            logger.warning(f"Batch download failed: {e}, falling back to one-by-one")
            data = None

        rows_total = 0
        for symbol in self.symbols:
            df = self._extract_symbol(data, symbol)

            if df is None or df.empty:
                # 单独尝试
                try:
                    df = yf.Ticker(symbol).history(
                        period=period, auto_adjust=False
                    )
                    df = df.reset_index().rename(columns={"Date": "date"})
                except Exception as e:
                    logger.warning(f"  [{symbol}] download failed: {e}")
                    continue

            if df is None or df.empty:
                logger.warning(f"  [{symbol}] no data")
                continue

            # yfinance 返回的 Adj Close 列名固定
            df = df.copy()
            if "Date" in df.columns:
                df = df.rename(columns={"Date": "date"})
            elif "date" not in df.columns:
                df = df.reset_index()
                if "Date" in df.columns:
                    df = df.rename(columns={"Date": "date"})

            n = db.upsert_prices(df, symbol)
            results[symbol] = n
            rows_total += n
            logger.debug(f"  [{symbol}] upserted {n} rows")

        logger.info(f"YFinance collector total upserted {rows_total} rows across {len(results)} symbols")
        return results

    @staticmethod
    def _extract_symbol(batch_data, symbol: str) -> Optional[pd.DataFrame]:
        """从批量下载的多层列 DataFrame 中提取单个 symbol"""
        if batch_data is None or batch_data.empty:
            return None
        try:
            if isinstance(batch_data.columns, pd.MultiIndex):
                if symbol in batch_data.columns.levels[0]:
                    sub = batch_data[symbol].copy()
                else:
                    return None
            else:
                # 只下载了一只
                sub = batch_data.copy()
            sub = sub.dropna(how="all").reset_index()
            if "Date" in sub.columns:
                sub = sub.rename(columns={"Date": "date"})
            return sub
        except Exception as e:
            logger.debug(f"_extract_symbol error for {symbol}: {e}")
            return None
