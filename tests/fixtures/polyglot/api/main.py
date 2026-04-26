"""FastAPI HTTP layer — fixture only, not runnable."""

from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse

from .models import JobRequest, JobResponse, JobStatus
from .db import get_session, AsyncSession
from .queue import enqueue_job, fetch_job_status


app = FastAPI(title="polyglot-api", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/jobs", response_model=JobResponse)
async def create_job(
    body: JobRequest,
    session: AsyncSession = Depends(get_session),
) -> JobResponse:
    job_id = await enqueue_job(session, body.payload)
    return JobResponse(id=job_id, status=JobStatus.queued)


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
) -> JobResponse:
    status = await fetch_job_status(session, job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="job not found")
    return JobResponse(id=job_id, status=status)


@app.exception_handler(HTTPException)
async def http_exc_handler(request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
