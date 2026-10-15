from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from engine import (
    load_data,
    validate_data,
    validate_relationships,
    calculate_metrics,
    build_care_gap_worklist,
)

app = FastAPI(
    title="CareLens API",
    description="Healthcare Quality and Care Gap Analytics",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"project": "CareLens", "status": "running"}


@app.get("/api/health")
def health():
    return {"status": "healthy"}


@app.get("/api/data/summary")
def data_summary():
    try:
        data = load_data()
        return {
            "files": {
                name: {
                    "rows": int(df.shape[0]),
                    "columns": int(df.shape[1]),
                    "column_names": df.columns.tolist(),
                }
                for name, df in data.items()
            }
        }
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/validation")
def data_validation():
    try:
        report = validate_data(load_data())
        return {
            "algorithm": "Data Validation",
            "status": "completed",
            "report": report,
        }
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/relationships")
def relationship_validation():
    try:
        report = validate_relationships(load_data())
        return {
            "algorithm": "Data Validation",
            "check": "Referential Integrity",
            "report": report,
        }
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/metrics")
def quality_metrics():
    try:
        return calculate_metrics(load_data())
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/care-gaps")
def detect_care_gaps():
    try:
        worklist = build_care_gap_worklist(load_data())
        return {
            "algorithm": "Rule-Based Care Gap Detection",
            "total_flagged": int(len(worklist)),
            "note": (
                "These are candidates for review, not confirmed clinical "
                "care gaps. Historical records are not automatically overdue."
            ),
            "care_gaps": worklist.to_dict(orient="records"),
        }
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))
