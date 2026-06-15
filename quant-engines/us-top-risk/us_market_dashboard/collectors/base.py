"""
Base collector - 所有采集器的基类
"""
import logging
import time
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class BaseCollector(ABC):
    """所有数据采集器的抽象基类"""

    name: str = "base"
    max_retries: int = 3
    retry_delay: int = 5

    def collect(self) -> Any:
        """带重试的采集封装"""
        last_err = None
        for attempt in range(1, self.max_retries + 1):
            try:
                logger.info(f"[{self.name}] collect attempt {attempt}/{self.max_retries}")
                result = self._collect()
                logger.info(f"[{self.name}] collect succeeded")
                return result
            except Exception as e:
                last_err = e
                logger.warning(f"[{self.name}] attempt {attempt} failed: {e}")
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay * attempt)
        logger.error(f"[{self.name}] all attempts failed: {last_err}")
        raise last_err

    @abstractmethod
    def _collect(self) -> Any:
        """子类实现具体采集逻辑"""
        ...
