"""Job-queue helpers; talks to the Go worker via Redis."""

import uuid
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from .models import JobStatus


async def enqueue_job(session: AsyncSession, payload: dict) -> str:
    job_id = str(uuid.uuid4())
    # Real impl would XADD to a Redis stream; fixture only.
    await session.execute(
        "INSERT INTO jobs(id, status, payload) VALUES(:id, :status, :payload)",
        {"id": job_id, "status": JobStatus.queued.value, "payload": str(payload)},
    )
    return job_id


async def fetch_job_status(session: AsyncSession, job_id: str) -> Optional[JobStatus]:
    row = await session.execute(
        "SELECT status FROM jobs WHERE id = :id",
        {"id": job_id},
    )
    result = row.fetchone()
    if result is None:
        return None
    return JobStatus(result[0])
