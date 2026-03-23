"""
FastAPI 백엔드 서버
유사량 산정 계산 API
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sys
import os

# sediment_transport.py를 같은 폴더에서 import
sys.path.insert(0, os.path.dirname(__file__))
from sediment_transport import InputData, run_all, formatSedimentInput

app = FastAPI(title="유사량 산정 API", version="1.0.0")

# CORS 설정 (React 개발서버에서 접근 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 요청 데이터 모델
# ============================================================

class InputDataModel(BaseModel):
    Title:   str     = "계산 예제"
    IUnit:   int     = 0
    ISize:   int     = 0
    ISide:   int     = 0
    B:       float   = 100.0
    D:       float   = 3.0
    Q:       float   = 300.0
    S:       float   = 0.0003
    T:       float   = 20.0
    Bedform: str     = "WAVE"
    D35:     float   = 0.3
    D50:     float   = 0.5
    D65:     float   = 0.7
    D90:     float   = 1.2
    Sg:      float   = 2.65
    Grd:     float   = 1.5
    Delta:   float   = 0.0
    Im:      List[float] = [0.0] * 8


class BatchCalculateRequest(BaseModel):
    inputs: List[InputDataModel]


# ============================================================
# 유틸 함수
# ============================================================

def to_input_data(model: InputDataModel) -> InputData:
    return InputData(
        Title   = model.Title,
        IUnit   = model.IUnit,
        ISize   = model.ISize,
        ISide   = model.ISide,
        B       = model.B,
        D       = model.D,
        Q       = model.Q,
        S       = model.S,
        T       = model.T,
        Bedform = model.Bedform,
        D35     = model.D35,
        D50     = model.D50,
        D65     = model.D65,
        D90     = model.D90,
        Sg      = model.Sg,
        Grd     = model.Grd,
        Delta   = model.Delta,
        Im      = model.Im,
    )


def clean_results(results: dict) -> dict:
    """결과에서 complex, inf, nan 처리"""
    cleaned = {}
    for k, v in results.items():
        if isinstance(v, dict):
            cleaned[k] = clean_results(v)
        elif isinstance(v, list):
            cleaned[k] = v
        elif isinstance(v, complex):
            cleaned[k] = -9999.0
        elif isinstance(v, float):
            import math
            if math.isnan(v) or math.isinf(v):
                cleaned[k] = -9999.0
            else:
                cleaned[k] = v
        else:
            cleaned[k] = v
    return cleaned


# ============================================================
# API 엔드포인트
# ============================================================

@app.get("/")
def root():
    return {"message": "유사량 산정 API 서버 실행 중"}


@app.post("/api/calculate")
def calculate(inp_model: InputDataModel):
    """단일 InputData 계산"""
    inp = to_input_data(inp_model)
    try:
        results = run_all(inp)
        results = clean_results(results)
        return {"status": "ok", "title": inp.Title, "results": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/calculate/batch")
def calculate_batch(req: BatchCalculateRequest):
    """여러 InputData 일괄 계산"""
    all_results = []
    for inp_model in req.inputs:
        inp = to_input_data(inp_model)
        try:
            results = run_all(inp)
            results = clean_results(results)
            all_results.append({
                "status" : "ok",
                "title"  : inp.Title,
                "results": results
            })
        except Exception as e:
            all_results.append({
                "status" : "error",
                "title"  : inp_model.Title,
                "message": str(e)
            })
    return {"status": "ok", "count": len(all_results), "data": all_results}


@app.post("/api/input_file")
def make_input_file(inp_model: InputDataModel):
    """Sediment.Dat 형식 인풋파일 텍스트 반환"""
    inp = to_input_data(inp_model)
    content = formatSedimentInput(inp)
    return {"status": "ok", "content": content}


# ============================================================
# 직접 실행
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
