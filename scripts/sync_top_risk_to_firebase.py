"""Export JunQuant v2 top-risk scores and optionally publish them to Firebase."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--engine-root",
        default="quant-engines/us-top-risk",
        help="Directory containing the us_market_dashboard package.",
    )
    parser.add_argument(
        "--history-limit",
        type=int,
        default=756,
        help="Maximum business-day observations saved to Firebase.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional JSON output path for inspection or debugging.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate JSON without writing to Firebase.",
    )
    return parser.parse_args()


def finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def risk_label(score: float) -> str:
    if score >= 0.85:
        return "极端风险"
    if score >= 0.75:
        return "短期高风险"
    if score >= 0.60:
        return "风险升温"
    if score >= 0.40:
        return "中性偏谨慎"
    return "正常或动量延续"


def build_payload(engine_root: Path, history_limit: int) -> dict[str, Any]:
    sys.path.insert(0, str(engine_root.resolve()))

    from us_market_dashboard.analyzers.risk_score_v2 import (  # pylint: disable=import-error
        compute_risk_score_v2,
        latest_v2_breakdown,
    )
    from us_market_dashboard.storage import db  # pylint: disable=import-error

    score_frame = compute_risk_score_v2()
    latest = latest_v2_breakdown()
    if score_frame.empty or not latest:
        raise RuntimeError(
            "No top-risk score is available. Run the upstream backfill/update pipeline first."
        )

    ndx_frame = db.load_prices("^NDX")
    ndx_close = ndx_frame["close"] if not ndx_frame.empty else None
    history_frame = score_frame.tail(max(1, history_limit)).copy()
    if ndx_close is not None:
        history_frame["ndx_close"] = ndx_close.reindex(history_frame.index).ffill()
        valid_ndx = history_frame["ndx_close"].dropna()
        ndx_base = finite_number(valid_ndx.iloc[0]) if not valid_ndx.empty else None
    else:
        history_frame["ndx_close"] = None
        ndx_base = None

    points: list[dict[str, Any]] = []
    for index, row in history_frame.iterrows():
        ndx_value = finite_number(row.get("ndx_close"))
        points.append(
            {
                "date": index.strftime("%Y-%m-%d"),
                "rawScore": finite_number(row.get("raw_score")),
                "confirmedScore": finite_number(row.get("confirmed_score")),
                "activeSignals": int(row.get("n_active", 0)),
                "ndxClose": ndx_value,
                "ndxNormalized": (
                    ndx_value / ndx_base * 100
                    if ndx_value is not None and ndx_base not in (None, 0)
                    else None
                ),
            }
        )

    confirmed_score = float(latest["confirmed_score"])
    generated_at = datetime.now(timezone.utc).isoformat()
    current = {
        "date": latest["date"],
        "rawScore": float(latest["raw_score"]),
        "confirmedScore": confirmed_score,
        "activeSignals": int(latest["n_active_signals"]),
        "subSignals": {
            "factorReversal": float(latest["sub_signals"]["factor_reversal"]),
            "soxReversal": float(latest["sub_signals"]["sox_reversal"]),
            "cftcExtreme": float(latest["sub_signals"]["cftc_extreme"]),
            "vixRising": float(latest["sub_signals"]["vix_rising"]),
            "leadingWeak": float(latest["sub_signals"]["leading_weak"]),
        },
        "riskLabel": risk_label(confirmed_score),
        "modelVersion": "junquant-v2",
        "source": "junquant-engine",
        "generatedAt": generated_at,
    }
    history = {
        "points": points,
        "modelVersion": "junquant-v2",
        "generatedAt": generated_at,
    }
    return {"current": current, "history": history}


def publish_to_firebase(payload: dict[str, Any]) -> None:
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is required unless --dry-run is used."
        ) from exc

    raw_credentials = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw_credentials:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.")

    app_id = os.environ.get("NEXT_PUBLIC_APP_ID", "default-app").strip() or "default-app"
    credential_data = json.loads(raw_credentials)
    if not firebase_admin._apps:  # pylint: disable=protected-access
        firebase_admin.initialize_app(credentials.Certificate(credential_data))

    client = firestore.client()
    collection_ref = (
        client.collection("artifacts")
        .document(app_id)
        .collection("public")
        .document("data")
        .collection("quant_us_top_risk")
    )

    batch = client.batch()
    batch.set(collection_ref.document("latest"), payload["current"], merge=True)
    batch.set(collection_ref.document("history"), payload["history"], merge=True)
    batch.commit()


def main() -> None:
    args = parse_args()
    engine_root = Path(args.engine_root)
    if not engine_root.exists():
        raise FileNotFoundError(f"Engine root not found: {engine_root}")

    payload = build_payload(engine_root, args.history_limit)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n", encoding="utf-8")

    if args.dry_run:
        print(rendered)
        return

    publish_to_firebase(payload)
    print(
        f"Published top-risk score for {payload['current']['date']} "
        f"with {len(payload['history']['points'])} history points."
    )


if __name__ == "__main__":
    main()

